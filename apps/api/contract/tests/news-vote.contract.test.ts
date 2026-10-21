// Ports apps/api/src/test/java/org/ceitba/api/web/news/VoteIT.java
// (@TestPropertySource rate-limit.trust-forwarded-for=true). The tests that call
// VoteService directly (concurrency, legacy fingerprints) go through HTTP here: the
// voter's IP is the X-Forwarded-For entry the proxy saw, its UA the User-Agent header.
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, test } from 'bun:test';
import { TEST_JWT_SECRET, useServer } from '../support';
import { ContentHmac, VOTE_FINGERPRINTS } from '../../src/features/crypto/logic/contentHmac';
import { seedArticle, wipeNews } from '../../test/news/support/fixtures';

const api = useServer({ env: { RATE_LIMIT_TRUST_FORWARDED_FOR: 'true' } });
const hmac = new ContentHmac(TEST_JWT_SECRET, null);

const IP = '198.51.100.42';
const UA = 'Mozilla/5.0 (test)';
const hmacFingerprint = () => hmac.signHex(VOTE_FINGERPRINTS, `${IP}|${UA}`);
const legacyFingerprint = () => createHash('sha256').update(`${IP}|${UA}`, 'utf8').digest('hex');
const voter = { 'X-Forwarded-For': IP, 'User-Agent': UA };
const cast = (type: string, headers: Record<string, string> = voter) => api.post('/v1/articles/v-art/votes', { headers, body: `{"type":"${type}"}` });
const stored = async () => (await api.db`SELECT fingerprint, created_at FROM public.vote_records ORDER BY fingerprint`);

async function seedLegacyUpVote(createdAt: string | null) {
  await api.db`INSERT INTO public.vote_records (article_id, fingerprint, vote_type, created_at)
               VALUES ('v-art', ${legacyFingerprint()}, 'up', ${createdAt ?? null}::timestamptz)`;
  await api.db`INSERT INTO public.article_votes (article_id, up_count, down_count, updated_at) VALUES ('v-art', 1, 0, now())`;
}

describe('VoteIT', () => {
  beforeEach(async () => {
    await wipeNews(api.db);
    await seedArticle(api.db, { id: 'v-art', title: 'Votable', excerpt: 'e', body: [], category: 'tech', authors: ['A'] });
  });

  test('getCountsReturnsZerosForNewArticle', async () => {
    const r = await api.get('/v1/articles/v-art/votes');
    expect(r.status).toBe(200);
    expect(r.text).toBe('{"up":0,"down":0}');
  });

  test('getCountsReflectsExistingAggregate', async () => {
    await api.db`INSERT INTO public.article_votes (article_id, up_count, down_count, updated_at) VALUES ('v-art', 2, 0, now())`;
    const r = await api.get('/v1/articles/v-art/votes');
    expect(r.status).toBe(200);
    expect(r.text).toBe('{"up":2,"down":0}');
    // Counts of an unknown article are zeros too (no 404 on reads).
    expect((await api.get('/v1/articles/nope/votes')).text).toBe('{"up":0,"down":0}');
  });

  test('castUpVoteIncrementsCount', async () => {
    const r = await api.post('/v1/articles/v-art/votes', { body: '{"type":"up"}' });
    expect(r.status).toBe(200);
    expect(r.text).toBe('{"up":1,"down":0}');
  });

  test('castingTheSameVoteTwiceIsIdempotent', async () => {
    expect((await api.post('/v1/articles/v-art/votes', { body: '{"type":"up"}' })).json.up).toBe(1);
    const r = await api.post('/v1/articles/v-art/votes', { body: '{"type":"up"}' });
    expect(r.status).toBe(200);
    expect(r.json.up).toBe(1);
  });

  test('changingVoteTypeRetractsOldAndAppliesNew', async () => {
    expect((await api.post('/v1/articles/v-art/votes', { body: '{"type":"up"}' })).json.up).toBe(1);
    const r = await api.post('/v1/articles/v-art/votes', { body: '{"type":"down"}' });
    expect(r.status).toBe(200);
    expect(r.text).toBe('{"up":0,"down":1}');
  });

  test('invalidVoteTypeReturns400', async () => {
    const r = await api.post('/v1/articles/v-art/votes', { body: '{"type":"sideways"}' });
    expect(r.status).toBe(400);
    expect(r.json.message).toBe("type: type must be 'up' or 'down'");
  });

  test('voteOnUnknownArticleReturns404', async () => {
    const r = await api.post('/v1/articles/nope/votes', { body: '{"type":"up"}' });
    expect(r.status).toBe(404);
    expect(r.json.message).toBe("Article with identifier 'nope' not found");
  });

  test('retractVoteDecrements', async () => {
    expect((await api.post('/v1/articles/v-art/votes', { body: '{"type":"up"}' })).json.up).toBe(1);
    const d = await api.delete('/v1/articles/v-art/votes');
    expect(d.status).toBe(204);
    expect(d.text).toBe('');
    expect((await api.get('/v1/articles/v-art/votes')).json.up).toBe(0);
  });

  test('retractWithNoPriorVoteReturns404', async () => {
    const r = await api.delete('/v1/articles/v-art/votes');
    expect(r.status).toBe(404);
    expect(r.json.message).toBe("VoteRecord with identifier 'v-art' not found");
    expect((await api.delete('/v1/articles/nope/votes')).json.message).toBe("Article with identifier 'nope' not found");
  });

  test('spoofedLeftMostForwardedForDoesNotCreateExtraVotes', async () => {
    for (const spoofed of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) {
      const r = await api.post('/v1/articles/v-art/votes', { headers: { 'X-Forwarded-For': `${spoofed}, 198.51.100.7` }, body: '{"type":"up"}' });
      expect(r.status).toBe(200);
      expect(r.json.up).toBe(1);
    }
  });

  test('concurrentVotesFromDistinctClientsAreAllCounted', async () => {
    const clients = 16;
    const rs = await Promise.all(Array.from({ length: clients }, (_, i) =>
      cast('up', { 'X-Forwarded-For': `198.51.100.${i}`, 'User-Agent': 'UA' })));
    for (const r of rs) expect(r.status).toBe(200);
    const [agg] = await api.db`SELECT up_count FROM public.article_votes WHERE article_id = 'v-art'`;
    expect(agg!.up_count).toBe(clients);
  });

  test('newVotesAreStoredUnderTheHmacFingerprint', async () => {
    expect((await cast('up')).status).toBe(200);
    const fps = (await stored()).map((r) => r.fingerprint);
    expect(fps).toEqual([hmacFingerprint()]);
    expect(fps).not.toContain(legacyFingerprint());
  });

  test('legacyVoteIsRecognizedAndRekeyedOnRecast', async () => {
    const [{ t }] = await api.db`SELECT (date_trunc('microseconds', now() - interval '10 days'))::text AS t` as unknown as [{ t: string }];
    await seedLegacyUpVote(t);
    const r = await cast('up');
    expect(r.json.up).toBe(1);
    const rows = await stored();
    expect(rows.map((x) => x.fingerprint)).toEqual([hmacFingerprint()]);
    const [{ same }] = await api.db`SELECT created_at = ${t}::timestamptz AS same FROM public.vote_records` as unknown as [{ same: boolean }];
    expect(same).toBe(true);
    expect((await cast('up')).json.up).toBe(1);
  });

  test('legacyVoteIsRetractedWhenTheVoterSwitchesType', async () => {
    await seedLegacyUpVote(null);
    const r = await cast('down');
    expect(r.json.up).toBe(0);
    expect(r.json.down).toBe(1);
    expect((await stored()).map((x) => x.fingerprint)).toEqual([hmacFingerprint()]);
  });

  test('legacyVoteCanBeRetracted', async () => {
    await seedLegacyUpVote(null);
    expect((await api.delete('/v1/articles/v-art/votes', { headers: voter })).status).toBe(204);
    expect((await api.get('/v1/articles/v-art/votes')).json.up).toBe(0);
    expect(await stored()).toHaveLength(0);
  });
});
