// In-process port of apps/api/src/test/java/org/ceitba/api/web/news/PushTriggerIT.java:
// it needs FakePushGateway in place of FCM and to await the asynchronous,
// after-commit delivery (pendingPushes() = AsyncWork.awaitIdle).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mintJwt, seedStaff, seedUser } from '../../contract/support';
import { FakePushGateway, pushMessage } from '../../src/infra/push';
import { withTx } from '../../src/db/client';
import { firePushes, forResource, pendingPushes, type PushTrigger } from '../../src/features/news/pushTriggers';
import { testApp, type TestApp } from '../support/app';

let t: TestApp;
const gateway = new FakePushGateway();
let staffAuth: Record<string, string>;

beforeAll(async () => {
  t = await testApp({ overrides: { push: gateway } });
});
afterAll(async () => { await t.close(); });

async function createArticle(id: string, org: string | null, status: string) {
  const r = await t.request('POST', '/v1/articles', { headers: staffAuth, body: `{"id":"${id}","title":"Convocatoria abierta","excerpt":"e","body":["p"],
     "category":"General","organization":${org === null ? 'null' : `"${org}"`},"authors":["IT"],"status":"${status}"}` });
  expect(r.status).toBe(201);
}

const patch = (id: string, body: string) => t.request('PATCH', `/v1/articles/${id}`, { headers: staffAuth, body });

describe('PushTriggerIT', () => {
  beforeEach(async () => {
    await pendingPushes();
    await t.sql`TRUNCATE public."user", public.organizations, public.articles, public.news_events CASCADE`;
    gateway.calls.length = 0;
    gateway.outcomes.clear();
    await t.sql`INSERT INTO public.organizations (slug, name, full_name) VALUES ('it', 'IT', 'IT Branch')`;
    await t.sql`INSERT INTO public.organizations (slug, name, full_name) VALUES ('other', 'Other', 'Other Org')`;
    const alice = await seedUser(t.sql, 'alice@itba.edu.ar', { name: 'Alice' });
    const bob = await seedUser(t.sql, 'bob@itba.edu.ar', { name: 'Bob' });
    const carol = await seedUser(t.sql, 'carol@itba.edu.ar', { name: 'Carol' });
    for (const [u, org] of [[alice, 'it'], [bob, 'other'], [carol, 'it']] as const) {
      await t.sql`INSERT INTO public.user_follows (user_id, org_slug) VALUES (${u}, ${org})`;
    }
    for (const [token, u] of [['alice-phone', alice], ['alice-tablet', alice], ['bob-phone', bob]] as const) {
      await t.sql`INSERT INTO public.user_devices (token, user_id, platform) VALUES (${token}, ${u}, 'android')`;
    }
    await seedUser(t.sql, 'boss@itba.edu.ar', { name: 'Boss' });
    await seedStaff(t.sql, 'boss@itba.edu.ar');
    staffAuth = { Authorization: `Bearer ${await mintJwt({ email: 'boss@itba.edu.ar', name: 'Boss' })}` };
  });

  test('theFcmServiceIsWiredWhenAGatewayExists', () => {
    expect(t.deps.push).toBe(gateway);
  });

  test('publishingAnArticleTargetsOnlyTheOrgFollowersDevices', async () => {
    await createArticle('art-1', 'it', 'published');
    await pendingPushes();
    expect(gateway.calls).toHaveLength(1);
    const call = gateway.calls[0]!;
    expect([...call.tokens].sort()).toEqual(['alice-phone', 'alice-tablet']);
    expect(call.message.title).toBe('IT');
    expect(call.message.body).toBe('Convocatoria abierta');
    expect(call.message.data).toMatchObject({ type: 'article', id: 'art-1', org: 'it' });
  });

  test('aDraftDoesNotPushUntilItIsPublishedAndEditsDoNotRepush', async () => {
    await createArticle('art-2', 'it', 'draft');
    await pendingPushes();
    expect(gateway.calls).toHaveLength(0);
    expect((await patch('art-2', '{"status":"published"}')).status).toBe(200);
    await pendingPushes();
    expect(gateway.calls).toHaveLength(1);
    expect([...gateway.calls[0]!.tokens].sort()).toEqual(['alice-phone', 'alice-tablet']);
    expect((await patch('art-2', '{"title":"Convocatoria (actualizada)"}')).status).toBe(200);
    await pendingPushes();
    expect(gateway.calls).toHaveLength(1);
  });

  test('republishingAnArticleDoesNotPushAgain', async () => {
    await createArticle('art-4', 'it', 'published');
    await pendingPushes();
    expect(gateway.calls).toHaveLength(1);
    for (const status of ['draft', 'published']) expect((await patch('art-4', `{"status":"${status}"}`)).status).toBe(200);
    await pendingPushes();
    expect(gateway.calls).toHaveLength(1);
    const [r] = await t.sql`SELECT push_sent_at FROM public.articles WHERE id = 'art-4'`;
    expect(r!.push_sent_at).not.toBeNull();
  });

  test('publishingLogsThePushReachForTheOrg', async () => {
    await createArticle('art-5', 'it', 'published');
    await pendingPushes();
    const rows = await t.sql`SELECT targeted FROM public.push_log WHERE org_slug = 'it' AND kind = 'article' AND ref_id = 'art-5'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.targeted).toBe(2);
  });

  // The exact backfill statement of V27 (the test mirror is DDL-only).
  test('v27BackfillMarksPublishedArticlesAsAnnounced', async () => {
    await t.sql`INSERT INTO public.articles (id, title, excerpt, category, status, created_at)
      VALUES ('old-dated', 't', 'e', 'news', 'published', '2024-01-01T00:00:00Z'),
             ('old-undated', 't', 'e', 'news', 'published', NULL),
             ('old-draft', 't', 'e', 'news', 'draft', '2024-01-01T00:00:00Z')`;
    const file = join(import.meta.dir, '../../../api/src/main/resources/db/migration/V27__article_push_sent_at.sql');
    const src = readFileSync(file, 'utf8');
    const start = src.indexOf('UPDATE "public"."articles"');
    expect(start).toBeGreaterThanOrEqual(0);
    await t.sql.unsafe(src.slice(start));
    const at = async (id: string) => (await t.sql`SELECT push_sent_at FROM public.articles WHERE id = ${id}`)[0]!.push_sent_at;
    expect((await at('old-dated') as Date).toISOString()).toBe('2024-01-01T00:00:00.000Z');
    expect(await at('old-undated')).not.toBeNull();
    expect(await at('old-draft')).toBeNull();
  });

  test('anArticleWithoutOrganizationDoesNotPush', async () => {
    await createArticle('art-3', null, 'published');
    await pendingPushes();
    expect(gateway.calls).toHaveLength(0);
  });

  test('creatingANewsEventPushesToFollowers', async () => {
    const r = await t.request('POST', '/v1/news/events', { headers: staffAuth, body: `{"id":"ev-1","title":"Charla de bienvenida","eventDate":"2026-10-01",
       "startTime":"18:00","endTime":"19:00","location":"Aula 101","category":"Cultura","organization":"other"}` });
    expect(r.status).toBe(201);
    await pendingPushes();
    expect(gateway.calls).toHaveLength(1);
    expect(gateway.calls[0]!.tokens).toEqual(['bob-phone']);
    expect(gateway.calls[0]!.message.data).toMatchObject({ type: 'event', id: 'ev-1' });
  });

  test('aFailedRequestSendsNothing', async () => {
    const r = await t.request('POST', '/v1/articles', { headers: staffAuth, body: `{"title":"t","excerpt":"e","body":["p"],"category":"General",
       "organization":"missing-org","authors":["IT"],"status":"published"}` });
    expect(r.status).toBe(404);
    await pendingPushes();
    expect(gateway.calls).toHaveLength(0);
  });

  // Triggers collected in a rolled-back transaction are never fired; a committed one is.
  test('triggersArePublishedOnlyAfterCommit', async () => {
    const trigger: PushTrigger = { kind: 'orgFollowers', orgSlug: 'it', message: forResource('IT', 'x', 'article', 'rb') };
    const run = async (rollback: boolean) => {
      const pushes: PushTrigger[] = [];
      try {
        await withTx(t.deps.db, async () => {
          pushes.push(trigger);
          if (rollback) throw new Error('rollback');
        });
        firePushes(t.deps, pushes);
      } catch { /* rolled back: nothing published */ }
    };
    await run(true);
    await pendingPushes();
    expect(gateway.calls).toHaveLength(0);
    await run(false);
    await pendingPushes();
    expect(gateway.calls).toHaveLength(1);
    expect(gateway.calls[0]!.message.data.id).toBe('rb');
    void pushMessage;
  });

  test('deadTokensReportedByFcmAreDeleted', async () => {
    gateway.outcomes.set('alice-tablet', 'UNREGISTERED');
    await createArticle('art-4', 'it', 'published');
    await pendingPushes();
    expect((await t.sql`SELECT 1 FROM public.user_devices WHERE token = 'alice-tablet'`).length).toBe(0);
    expect((await t.sql`SELECT 1 FROM public.user_devices WHERE token = 'alice-phone'`).length).toBe(1);
  });
});
