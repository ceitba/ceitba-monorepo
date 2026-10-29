// service/kb/KbSearchService: semantic search over the subject wikis
// (docs/SUBJECT-WIKI.md "Embeddings"). Every query costs an embedding call, so
// it has a per-user quota (rate-limit.user-rules.wiki-search). Not
// transactional: KbEmbeddingService.search embeds over HTTP, then reads in its
// own read-only transaction.

import type { Deps } from '../../deps';
import { ValidationError } from '../../http/errors';
import { javaDouble } from '../../lib/json';
import { javaIsBlank, javaStrip } from '../../lib/javaCompat';
import type { KbSearchResponse } from './dto';
import type { KbEmbeddingService } from './embeddingService';

export const RATE_RULE = 'wiki-search';
export const DEFAULT_LIMIT = 8;
export const MAX_LIMIT = 20;
export const MAX_QUERY_LENGTH = 500;

export class KbSearchService {
  constructor(private readonly embeddings: KbEmbeddingService, private readonly deps: Pick<Deps, 'userRateLimiter'>) {}

  async search(user: { id: string }, query: string | null, subjectId: string | null, limit: number | null): Promise<KbSearchResponse> {
    const q = query == null ? '' : javaStrip(query);
    if (q.length === 0) throw new ValidationError('q', query, 'is required');
    if (q.length > MAX_QUERY_LENGTH) throw new ValidationError('q', `${q.length} characters`, `must be at most ${MAX_QUERY_LENGTH} characters`);
    const subject = subjectId == null || javaIsBlank(subjectId) ? null : javaStrip(subjectId);
    const k = limit == null ? DEFAULT_LIMIT : Math.max(1, Math.min(limit, MAX_LIMIT));
    this.deps.userRateLimiter.consume(RATE_RULE, user.id);
    const hits = await this.embeddings.search(q, subject, k);
    return {
      query: q,
      results: hits.map((h) => ({
        pageId: h.pageId, subjectId: h.subjectId, slug: h.slug, title: h.title, heading: h.heading, anchor: h.anchor,
        content: h.content, score: javaDouble(Math.round((1 - h.distance) * 1000) / 1000),
      })),
    };
  }
}
