// Ports apps/api/src/test/java/org/ceitba/api/web/user/MeSchedulesIT.java.
// /v1/me/schedules: CRUD, the 5-per-user cap, primary-schedule rules (V22) and
// ownership (another user's schedule is a 404, never a 403). The V22 backfill
// test runs the statement read from the Java migration file, like the IT.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'bun:test';
import { bearer, mintJwt, seedUser, useServer } from '../support';
import { MIGRATIONS_DIR } from '../../src/config/sections/db';

const api = useServer();
const ALICE = 'alice@itba.edu.ar';
const BOB = 'bob@itba.edu.ar';
const V22 = join(MIGRATIONS_DIR, 'V22__saved_schedules_primary.sql');

const as = async (email: string) => bearer(await mintJwt({ email, name: email }));
const body = (name: string) => `{"name":"${name}","careerId":"S","plan":"S10-Rev23",
             "payload":{"commissions":["93.41-A"],"options":{"hideSaturday":true}}}`;

async function create(email: string, name: string) {
  const r = await api.post('/v1/me/schedules', { as: await as(email), body: body(name) });
  expect(r.status).toBe(201);
  return r.json;
}

async function primaryCount(email: string): Promise<number> {
  const [r] = await api.db`SELECT count(*)::int AS n FROM public.saved_schedules s JOIN public."user" u ON u.id = s.user_id
                           WHERE u.email = ${email} AND s.is_primary`;
  return r!.n as number;
}

function v22Backfill(): string {
  const sql = readFileSync(V22, 'utf8');
  const start = sql.indexOf('UPDATE saved_schedules s');
  expect(start).toBeGreaterThanOrEqual(0);
  return sql.slice(start);
}

describe('MeSchedulesIT', () => {
  beforeEach(async () => {
    await api.db`TRUNCATE public."user" CASCADE`;
    await seedUser(api.db, ALICE, { name: 'Alice' });
    await seedUser(api.db, BOB, { name: 'Bob' });
  });

  test('crudRoundTripKeepsPayloadOpaque', async () => {
    const a = await as(ALICE);
    const created = await api.post('/v1/me/schedules', { as: a, body: body('Plan A') });
    expect(created.status).toBe(201);
    const id = created.json.id as string;
    // The entity before flush: no timestamps yet; isPrimary is written last (renamed component).
    expect(created.text).toBe(`{"id":"${id}","name":"Plan A","careerId":"S","plan":"S10-Rev23","payload":{"commissions":["93.41-A"],"options":{"hideSaturday":true}},"createdAt":null,"updatedAt":null,"isPrimary":true}`);

    let r = await api.get(`/v1/me/schedules/${id}`, { as: a });
    expect(r.status).toBe(200);
    expect(r.json.name).toBe('Plan A');
    expect(r.json.careerId).toBe('S');
    expect(r.json.plan).toBe('S10-Rev23');
    expect(r.json.payload.commissions[0]).toBe('93.41-A');
    expect(r.json.isPrimary).toBe(true);
    expect(r.json.primary).toBeUndefined();
    // jsonb order (shorter keys first).
    expect(r.text).toContain('"payload":{"options":{"hideSaturday":true},"commissions":["93.41-A"]}');

    r = await api.put(`/v1/me/schedules/${id}`, { as: a, body: '{"name":"Plan B","payload":{"anything":[1,2,3]}}' });
    expect(r.status).toBe(200);
    expect(r.json.name).toBe('Plan B');
    expect(r.json.careerId).toBeNull();
    expect(r.json.payload.anything[2]).toBe(3);
    expect(r.json.isPrimary).toBe(true);

    r = await api.get('/v1/me/schedules', { as: a });
    expect(r.status).toBe(200);
    expect(r.json).toHaveLength(1);

    expect((await api.delete(`/v1/me/schedules/${id}`, { as: a })).status).toBe(204);
    expect((await api.get(`/v1/me/schedules/${id}`, { as: a })).status).toBe(404);
  });

  test('payloadKeepsJacksonKeyOrderAndNumberTypes', async () => {
    const a = await as(ALICE);
    const c = await api.post('/v1/me/schedules', { as: a, body: '{"name":"A","payload":{"10":1,"2":1.0,"b":1.5e-7,"a":[1E2,100000000000000000000],"z":{"y":1,"x":2}}}' });
    expect(c.status).toBe(201);
    expect(c.text).toContain('"payload":{"10":1,"2":1.0,"b":1.5E-7,"a":[100.0,100000000000000000000],"z":{"y":1,"x":2}}');
    const g = await api.get(`/v1/me/schedules/${c.json.id}`, { as: a });
    expect(g.text).toContain('"payload":{"2":1.0,"a":[100.0,100000000000000000000],"b":1.5E-7,"z":{"x":2,"y":1},"10":1}');
  });

  test('rejectsInvalidBodies', async () => {
    const a = await as(ALICE);
    let r = await api.post('/v1/me/schedules', { as: a, body: '{"name":"","payload":{}}' });
    expect(r.status).toBe(400);
    expect(r.json.message).toBe('name: must not be blank');
    r = await api.post('/v1/me/schedules', { as: a, body: '{"name":"x"}' });
    expect(r.status).toBe(400);
    expect(r.json.message).toBe('payload: must not be null');
    r = await api.post('/v1/me/schedules', { as: a, body: '{"name":"x","payload":[]}' });
    expect(r.status).toBe(400);
    expect(r.json.message).toBe('Malformed or invalid request body');
  });

  test('requiresAuthentication', async () => {
    expect((await api.get('/v1/me/schedules')).status).toBe(401);
  });

  test('sixthScheduleIsConflict', async () => {
    for (let i = 1; i <= 5; i++) await create(ALICE, `S${i}`);
    const r = await api.post('/v1/me/schedules', { as: await as(ALICE), body: body('S6') });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe('ResourceAlreadyExists');
    expect(r.json.message).toBe("SavedSchedule with identifier 'Saved schedule limit reached (max 5). Delete one first.' already exists");
    // The cap is per user.
    await create(BOB, "Bob's");
  });

  test('firstScheduleIsPrimaryAndLaterOnesAreNot', async () => {
    const first = await create(ALICE, 'First');
    const second = await create(ALICE, 'Second');
    expect(first.isPrimary).toBe(true);
    expect(second.isPrimary).toBe(false);
    // Another user's first schedule is primary too (index is per user).
    expect((await create(BOB, "Bob's")).isPrimary).toBe(true);
  });

  test('onlyAPayloadChangeMovesPayloadUpdatedAt', async () => {
    const a = await as(ALICE);
    const id = (await create(ALICE, 'First')).id as string;
    await api.db`UPDATE public.saved_schedules SET payload_updated_at = now() - interval '200 days'`;
    const [{ p: before }] = await api.db`SELECT payload_updated_at::text AS p FROM public.saved_schedules` as unknown as [{ p: string }];

    // Rename with the same payload, and a primary toggle.
    const current = await api.get(`/v1/me/schedules/${id}`, { as: a });
    const payload = JSON.stringify(current.json.payload);
    expect((await api.put(`/v1/me/schedules/${id}`, { as: a, body: `{"name":"Renamed","payload":${payload}}` })).status).toBe(200);
    expect((await api.put(`/v1/me/schedules/${id}/primary`, { as: a })).status).toBe(200);
    let [{ p }] = await api.db`SELECT payload_updated_at::text AS p FROM public.saved_schedules` as unknown as [{ p: string }];
    expect(p).toBe(before);

    expect((await api.put(`/v1/me/schedules/${id}`, { as: a, body: '{"name":"Renamed","payload":{"changed":true}}' })).status).toBe(200);
    [{ p }] = await api.db`SELECT payload_updated_at::text AS p FROM public.saved_schedules` as unknown as [{ p: string }];
    const [{ after }] = await api.db`SELECT payload_updated_at > ${before}::timestamptz AS after FROM public.saved_schedules` as unknown as [{ after: boolean }];
    expect(after).toBe(true);
    void p;
  });

  test('makePrimaryMovesTheFlagAndIsIdempotent', async () => {
    const a = await as(ALICE);
    const first = (await create(ALICE, 'First')).id as string;
    const second = (await create(ALICE, 'Second')).id as string;

    let r = await api.put(`/v1/me/schedules/${second}/primary`, { as: a });
    expect(r.status).toBe(200);
    expect(r.json.id).toBe(second);
    expect(r.json.isPrimary).toBe(true);
    // saveAndFlush of the changed entity: updatedAt is the in-memory now (JVM zone).
    expect(r.json.updatedAt).toMatch(/-03:00$/);
    expect(r.json.createdAt).toMatch(/Z$/);
    r = await api.put(`/v1/me/schedules/${second}/primary`, { as: a });
    expect(r.status).toBe(200);
    expect(r.json.isPrimary).toBe(true);
    // Nothing changed this time: the values as loaded.
    expect(r.json.updatedAt).toMatch(/Z$/);

    expect((await api.get(`/v1/me/schedules/${first}`, { as: a })).json.isPrimary).toBe(false);
    expect(await primaryCount(ALICE)).toBe(1);
  });

  test('deletingThePrimaryPromotesNone', async () => {
    const a = await as(ALICE);
    const first = (await create(ALICE, 'First')).id as string;
    const second = (await create(ALICE, 'Second')).id as string;

    expect((await api.delete(`/v1/me/schedules/${first}`, { as: a })).status).toBe(204);
    expect((await api.get(`/v1/me/schedules/${second}`, { as: a })).json.isPrimary).toBe(false);
    expect(await primaryCount(ALICE)).toBe(0);

    // Not the user's first schedule any more, so it is not auto-promoted.
    expect((await create(ALICE, 'Third')).isPrimary).toBe(false);
    expect((await api.put(`/v1/me/schedules/${second}/primary`, { as: a })).status).toBe(200);
    expect(await primaryCount(ALICE)).toBe(1);
  });

  // The app's one-time local-schedules upload may POST in parallel.
  test('concurrentFirstCreatesAllSucceedWithOnePrimary', async () => {
    const a = await as(ALICE);
    const n = 5;
    const results = await Promise.all(Array.from({ length: n }, (_, i) => api.post('/v1/me/schedules', { as: a, body: body(`Parallel ${i}`) })));
    for (const r of results) expect(r.status).toBe(201);
    const [{ c }] = await api.db`SELECT count(*)::int AS c FROM public.saved_schedules s JOIN public."user" u ON u.id = s.user_id
                                 WHERE u.email = ${ALICE}` as unknown as [{ c: number }];
    expect(c).toBe(n);
    expect(await primaryCount(ALICE)).toBe(1);
  });

  test('v22BackfillMakesEachUsersLatestScheduleThePrimary', async () => {
    const [{ id: alice }] = await api.db`SELECT id FROM public."user" WHERE email = ${ALICE}` as unknown as [{ id: string }];
    const [{ id: bob }] = await api.db`SELECT id FROM public."user" WHERE email = ${BOB}` as unknown as [{ id: string }];
    const legacy = async (userId: string, updatedAt: string) => {
      const [r] = await api.db`INSERT INTO public.saved_schedules (user_id, name, payload, is_primary, updated_at)
                               VALUES (${userId}, 'legacy', '{}'::jsonb, FALSE, ${updatedAt}::timestamptz) RETURNING id`;
      return r!.id as string;
    };
    const aliceOld = await legacy(alice, '2024-01-01T00:00:00Z');
    const aliceLatest = await legacy(alice, '2024-03-01T00:00:00Z');
    const aliceMid = await legacy(alice, '2024-02-01T00:00:00Z');
    const bobOnly = await legacy(bob, '2023-06-01T00:00:00Z');

    await api.db.unsafe(v22Backfill());
    const ids = async (primary: boolean) => (await api.db`SELECT id FROM public.saved_schedules WHERE is_primary = ${primary}`).map((r) => r.id as string).sort();
    expect(await ids(true)).toEqual([aliceLatest, bobOnly].sort());
    expect(await ids(false)).toEqual([aliceOld, aliceMid].sort());
    // Idempotent.
    await api.db.unsafe(v22Backfill());
    expect(await primaryCount(ALICE)).toBe(1);
  });

  test('databaseRejectsTwoPrimariesForOneUser', async () => {
    await create(ALICE, 'First');
    await create(ALICE, 'Second');
    let code: string | undefined;
    try {
      await api.db`UPDATE public.saved_schedules SET is_primary = TRUE`;
    } catch (e) {
      code = (e as { code?: string }).code;
    }
    expect(code).toBe('23505');
  });

  test('otherUsersSchedulesAreNotFound', async () => {
    const bobs = (await create(BOB, "Bob's")).id as string;
    const a = await as(ALICE);
    expect((await api.get(`/v1/me/schedules/${bobs}`, { as: a })).status).toBe(404);
    expect((await api.put(`/v1/me/schedules/${bobs}`, { as: a, body: body('hijack') })).status).toBe(404);
    expect((await api.put(`/v1/me/schedules/${bobs}/primary`, { as: a })).status).toBe(404);
    const d = await api.delete(`/v1/me/schedules/${bobs}`, { as: a });
    expect(d.status).toBe(404);
    expect(d.json.message).toBe(`SavedSchedule with identifier '${bobs}' not found`);
    expect((await api.get('/v1/me/schedules', { as: a })).json).toHaveLength(0);

    const r = await api.get(`/v1/me/schedules/${bobs}`, { as: await as(BOB) });
    expect(r.status).toBe(200);
    expect(r.json.name).toBe("Bob's");
  });
});
