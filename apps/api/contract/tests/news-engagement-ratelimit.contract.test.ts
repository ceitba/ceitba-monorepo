// Comment quotas (docs/NEWSLETTER-ENGAGEMENT.md "Limits"): per user on new comments.
import { beforeEach, describe, expect, test } from 'bun:test';
import { useServer } from '../support';
import { as, seedArticle, wipeNews } from '../../test/news/support/fixtures';

const api = useServer({ env: { RATE_LIMIT_ENABLED: 'true', RATE_LIMIT_ARTICLE_COMMENTS_CAPACITY: '2', RATE_LIMIT_ARTICLE_COMMENTS_PERIOD: '1h' } });

describe('ArticleCommentQuota', () => {
  beforeEach(async () => {
    await wipeNews(api.db);
    await seedArticle(api.db, { id: 'q-art', title: 'T', excerpt: 'e', body: [], category: 'tech', authors: ['A'] });
  });

  test('aUserPastTheQuotaGets429_othersStillComment', async () => {
    const me = await as('busy@itba.edu.ar');
    for (const n of [1, 2]) expect((await api.post('/v1/articles/q-art/comments', { as: me, body: { body: `c${n}` } })).status).toBe(201);
    const r = await api.post('/v1/articles/q-art/comments', { as: me, body: { body: 'c3' } });
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).not.toBeNull();
    expect((await api.post('/v1/articles/q-art/comments', { as: await as('calm@itba.edu.ar'), body: { body: 'hola' } })).status).toBe(201);
  });
});
