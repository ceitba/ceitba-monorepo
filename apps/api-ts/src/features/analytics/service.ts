// service/news/AnalyticsService (ingest + staff summary), used by web/analytics/AnalyticsController.

import { sql } from 'drizzle-orm';
import type { Deps } from '../../deps';
import { withTx } from '../../db/client';
import { msToMicros, systemNowMicros, toPgTimestamp } from '../../lib/time';
import { ANALYTICS_IP_HASHES, ContentHmac } from '../crypto/logic/contentHmac';

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

type Row = Record<string, unknown>;

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
        await tx.execute(sql`INSERT INTO public.analytics_events (type, session_id, ts, article_id, event_id, category, path, ip_hash)
          VALUES (${e.type}, ${e.sessionId}, ${ts}, ${e.articleId}, ${e.eventId}, ${e.category}, ${e.path}, ${ipHash})`);
      }
    });
  }

  /** @Transactional(readOnly = true). `since` = OffsetDateTime.now().minusDays(days). */
  summary(days: number): Promise<Summary> {
    const since = toPgTimestamp(systemNowMicros() - days * 86_400_000_000);
    return withTx(this.deps.db, async (tx) => {
      const q = async (s: ReturnType<typeof sql>) => (await tx.execute(s)) as unknown as Row[];
      const [views] = await q(sql`SELECT COUNT(*) AS n FROM public.analytics_events WHERE type = 'article_view' AND ts >= ${since}::timestamptz`);
      const [visitors] = await q(sql`SELECT COUNT(DISTINCT session_id) AS n FROM public.analytics_events WHERE ts >= ${since}::timestamptz`);
      const top = await q(sql`
        SELECT ae.article_id, a.title, COUNT(*) AS views FROM public.analytics_events ae JOIN public.articles a ON a.id = ae.article_id
        WHERE ae.type = 'article_view' AND ae.ts >= ${since}::timestamptz AND ae.article_id IS NOT NULL
        GROUP BY ae.article_id, a.title ORDER BY views DESC LIMIT 10`);
      const cats = await q(sql`
        SELECT ae.category, COUNT(*) AS views FROM public.analytics_events ae
        WHERE ae.type = 'category_filter' AND ae.ts >= ${since}::timestamptz AND ae.category IS NOT NULL
        GROUP BY ae.category ORDER BY views DESC`);
      const daily = await q(sql`
        SELECT date_trunc('day', ts)::date::text AS day, COUNT(*) AS views FROM public.analytics_events
        WHERE type = 'article_view' AND ts >= ${since}::timestamptz GROUP BY 1 ORDER BY 1`);
      // voteRepo.findAll() + articleRepo.findById per row (title falls back to the id).
      const votes = await q(sql`SELECT v.article_id, v.up_count, v.down_count, a.title FROM public.article_votes v
        LEFT JOIN public.articles a ON a.id = v.article_id`);
      return {
        totalArticleViews: Number(views!.n),
        uniqueVisitors: Number(visitors!.n),
        topArticles: top.map((r) => ({ articleId: r.article_id as string, title: r.title as string, views: Number(r.views) })),
        categoryViews: cats.map((r) => ({ category: r.category as string, views: Number(r.views) })),
        dailyViews: daily.map((r) => ({ date: r.day as string, views: Number(r.views) })),
        voteBreakdown: votes
          .map((v) => ({ articleId: v.article_id as string, title: (v.title as string | null) ?? (v.article_id as string), up: Number(v.up_count), down: Number(v.down_count) }))
          .filter((s) => s.up + s.down > 0),
      };
    }, { readOnly: true });
  }
}
