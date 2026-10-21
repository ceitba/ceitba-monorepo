// service/news/AnalyticsService (ingest + staff summary), used by web/analytics/AnalyticsController.

import type { Deps } from '../../deps';
import { withTx } from '../../db/client';
import { msToMicros, systemNowMicros, toPgTimestamp } from '../../lib/time';
import { ANALYTICS_IP_HASHES, ContentHmac } from '../crypto/logic/contentHmac';
import * as repo from './repo';

export interface EventPayload {
  type: string; sessionId: string; timestamp: number | null; articleId: string | null; eventId: string | null; category: string | null; path: string | null;
}

export interface Summary {
  totalArticleViews: number;
  uniqueVisitors: number;
  topArticles: { articleId: string; title: string; views: number }[];
  categoryViews: { category: string; views: number }[];
  dailyViews: { date: string; views: number }[];
  voteBreakdown: { articleId: string; title: string; up: number; down: number }[];
}

export class AnalyticsService {
  private hmac: ContentHmac | null = null;
  constructor(private readonly deps: Deps) {}

  /** HMAC-SHA256(clientIp) under the analytics key, never the IP itself. */
  ipHash(clientIp: string | null): string {
    this.hmac ??= new ContentHmac(this.deps.config.auth.jwt.secret, this.deps.config.auth.contentHmacSecret);
    return this.hmac.signHex(ANALYTICS_IP_HASHES, clientIp ?? '');
  }

  ingestBatch(events: EventPayload[], clientIp: string | null): Promise<void> {
    const ipHash = this.ipHash(clientIp);
    return withTx(this.deps.db, async (tx) => {
      for (const e of events) {
        // Instant.ofEpochMilli(timestamp), else OffsetDateTime.now().
        const ts = toPgTimestamp(e.timestamp !== null ? msToMicros(e.timestamp) : systemNowMicros());
        await repo.insertEvent(tx, {
          type: e.type, sessionId: e.sessionId, ts, articleId: e.articleId, eventId: e.eventId, category: e.category, path: e.path, ipHash,
        });
      }
    });
  }

  /** @Transactional(readOnly = true). `since` = OffsetDateTime.now().minusDays(days). */
  summary(days: number): Promise<Summary> {
    const since = toPgTimestamp(systemNowMicros() - days * 86_400_000_000);
    return withTx(this.deps.db, async (tx) => {
      const totalArticleViews = await repo.countArticleViewsSince(tx, since);
      const uniqueVisitors = await repo.countVisitorsSince(tx, since);
      const topArticles = await repo.topArticlesSince(tx, since);
      const categoryViews = await repo.categoryViewsSince(tx, since);
      const dailyViews = await repo.dailyViewsSince(tx, since);
      // voteRepo.findAll() + articleRepo.findById per row (title falls back to the id).
      const votes = await repo.allVotes(tx);
      return {
        totalArticleViews,
        uniqueVisitors,
        topArticles,
        categoryViews,
        dailyViews,
        voteBreakdown: votes
          .map((v) => ({ articleId: v.articleId, title: v.title ?? v.articleId, up: v.up, down: v.down }))
          .filter((s) => s.up + s.down > 0),
      };
    }, { readOnly: true });
  }
}
