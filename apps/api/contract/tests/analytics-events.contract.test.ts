// Ports apps/api/src/test/java/org/ceitba/api/web/analytics/AnalyticsIT.java.
// MockMvc's setRemoteAddr("203.0.113.9") becomes X-Forwarded-For from the
// loopback peer (RATE_LIMIT_TRUST_FORWARDED_FOR defaults to true; ClientIp.resolve).
import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { ANALYTICS_IP_HASHES, ContentHmac } from '../../src/features/crypto/logic/contentHmac';
import { bearer, mintJwt, seedStaff, TEST_JWT_SECRET, useServer, type As } from '../support';

const api = useServer();
let staff: As;

beforeAll(async () => {
  await seedStaff(api.db, 'boss@itba.edu.ar');
  staff = bearer(await mintJwt({ email: 'boss@itba.edu.ar', name: 'Boss' }));
});

const ingest = (body: unknown, headers: Record<string, string> = {}) => api.post('/v1/analytics/events', { body, headers });

describe('AnalyticsIT', () => {
  beforeEach(async () => {
    await api.db`DELETE FROM public.analytics_events`;
    await api.db`DELETE FROM public.articles`;
    await api.db`INSERT INTO public.articles (id, title, excerpt, category) VALUES ('a1', 'Article', 'e', 'tech')`;
  });

  test('ingestBatchReturns202', async () => {
    const r = await ingest({ events: [
      { type: 'article_view', sessionId: 's1', timestamp: 1746316800000, articleId: 'a1' },
      { type: 'page_view', sessionId: 's1', timestamp: 1746316860000, path: '/' },
    ] });
    expect(r.status).toBe(202);
    expect(r.text).toBe('');
    const rows = await api.db`SELECT type, ts::text AS ts, article_id, path FROM public.analytics_events ORDER BY id`;
    expect(rows.map((x) => [x.type, new Date(x.ts).toISOString(), x.article_id, x.path])).toEqual([
      ['article_view', '2025-05-04T00:00:00.000Z', 'a1', null], ['page_view', '2025-05-04T00:01:00.000Z', null, '/'],
    ]);
  });

  test('ingestPersistsEvents', async () => {
    expect((await ingest({ events: [{ type: 'page_view', sessionId: 's2' }] })).status).toBe(202);
    const r = await api.get('/v1/analytics/summary?days=1', { as: staff });
    expect(r.status).toBe(200);
    expect(r.json.uniqueVisitors).toBe(1);
  });

  test('ingestStoresAKeyedHashOfTheClientIp', async () => {
    expect((await ingest({ events: [{ type: 'page_view', sessionId: 's-hmac' }] }, { 'X-Forwarded-For': '203.0.113.9' })).status).toBe(202);
    const [row] = await api.db`SELECT ip_hash FROM public.analytics_events WHERE session_id = 's-hmac'`;
    const unkeyed = createHash('sha256').update('203.0.113.9').digest('hex');
    expect(row!.ip_hash).toBe(ContentHmac.fromJwtSecret(TEST_JWT_SECRET).signHex(ANALYTICS_IP_HASHES, '203.0.113.9'));
    expect(row!.ip_hash).not.toBe(unkeyed);
  });

  test('ingestWithInvalidTypeStillReturns202AndSkipsInvalid', async () => {
    expect((await ingest({ events: [{ type: 'unknown_event', sessionId: 's3', timestamp: 1746316800000 }] })).status).toBe(202);
  });

  test('ingestEmptyEventArrayReturns400', async () => {
    const r = await ingest({ events: [] });
    expect(r.status).toBe(400);
    expect(r.json.message).toBe('events: Batch must contain between 1 and 50 events');
  });

  test('ingestBatchExceeding50EventsIsRejected', async () => {
    const events = Array.from({ length: 51 }, () => ({ type: 'page_view', sessionId: 's', timestamp: 1746316800000 }));
    expect((await ingest({ events })).status).toBe(400);
  });

  // Not in the IT: the other constraints.
  test('missingFieldsAreValidationErrors', async () => {
    expect((await ingest({})).json.message).toBe('events: must not be null');
    expect((await ingest({ events: [{ type: 'page_view' }] })).json.message).toBe('events[0].sessionId: must not be null');
    expect((await ingest({ events: [{ type: 'x', sessionId: 's', eventId: 'e'.repeat(65) }] })).json.message).toBe('events[0].eventId: size must be between 0 and 64');
  });

  test('summaryRequiresAuth', async () => {
    expect((await api.get('/v1/analytics/summary')).status).toBe(401);
  });

  test('summaryForbiddenForRegularUser', async () => {
    expect((await api.get('/v1/analytics/summary', { as: bearer(await mintJwt({ email: 'u@itba.edu.ar' })) })).status).toBe(403);
  });

  test('staffCanAccessSummary', async () => {
    const r = await api.get('/v1/analytics/summary', { as: staff });
    expect(r.status).toBe(200);
    expect(typeof r.json.totalArticleViews).toBe('number');
    expect(typeof r.json.uniqueVisitors).toBe('number');
    for (const k of ['topArticles', 'categoryViews', 'dailyViews', 'voteBreakdown']) expect(Array.isArray(r.json[k])).toBe(true);
  });

  test('summaryCountsArticleViews', async () => {
    expect((await ingest({ events: [{ type: 'article_view', sessionId: 's4', articleId: 'a1' }, { type: 'article_view', sessionId: 's5', articleId: 'a1' }] })).status).toBe(202);
    const r = await api.get('/v1/analytics/summary?days=1', { as: staff });
    expect(r.status).toBe(200);
    expect(r.json.totalArticleViews).toBe(2);
    expect(r.json.uniqueVisitors).toBe(2);
  });

  // Not in the IT: the full summary shape.
  test('summaryShapeIsByteExact', async () => {
    await ingest({ events: [{ type: 'article_view', sessionId: 's4', articleId: 'a1', timestamp: Date.now() }, { type: 'category_filter', sessionId: 's4', category: 'tech' }] });
    await api.db`INSERT INTO public.article_votes (article_id, up_count, down_count) VALUES ('a1', 2, 1)`;
    const r = await api.get('/v1/analytics/summary?days=2', { as: staff });
    const day = r.json.dailyViews[0].date;
    expect(r.text).toBe(`{"totalArticleViews":1,"uniqueVisitors":1,"topArticles":[{"articleId":"a1","title":"Article","views":1}],"categoryViews":[{"category":"tech","views":1}],"dailyViews":[{"date":"${day}","views":1}],"voteBreakdown":[{"articleId":"a1","title":"Article","up":2,"down":1}]}`);
    expect((await api.get('/v1/analytics/summary?days=x', { as: staff })).status).toBe(400);
  });
});
