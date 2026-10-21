// Ports apps/api/src/test/java/org/ceitba/api/web/staff/StaffEndpointsIT.java.
// ROLE_STAFF is a real ceitba_staff row of the caller (boss@itba.edu.ar), seeded
// lazily, so it is listed by GET /v1/staff: list counts include it (+1).
// revokingTheLastActiveStaffMemberReturns409 cannot be reproduced as written (the
// staff caller is itself active staff), so the only active staff member — the
// caller — revokes themselves.
import { beforeEach, describe, expect, test } from 'bun:test';
import { bearer, mintJwt, seedStaff, seedUser, useServer, type As } from '../support';

const api = useServer();
const BOSS = 'boss@itba.edu.ar';
let aliceId: string;
let bobId: string;
let bossId: string | null;

async function staff(): Promise<As> {
  if (!bossId) bossId = await seedStaff(api.db, BOSS);
  return bearer(await mintJwt({ email: BOSS }));
}
const user = async () => bearer(await mintJwt({ email: 'regular@itba.edu.ar' }));
const seedStaffRow = (userId: string, start: string, end: string) =>
  api.db`INSERT INTO public.ceitba_staff (user_id, branch, role, start, "end") VALUES (${userId}, 'IT', 'MEMBER', ${start}::timestamptz, ${end}::timestamptz)`;
const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const isActive = async (id: string) => (await api.db`SELECT 1 FROM public.ceitba_staff WHERE user_id = ${id} AND start <= now() AND "end" >= now()`).length > 0;
const assign = async (body: string) => api.post('/v1/staff', { as: await staff(), body });
const ALICE_BODY = `{"email":"alice@itba.edu.ar","branch":"IT","role":"MEMBER",
             "start":"2026-01-01T00:00:00Z","end":"2027-01-01T00:00:00Z"}`;

describe('StaffEndpointsIT', () => {
  beforeEach(async () => {
    bossId = null;
    await api.db`TRUNCATE public."user" CASCADE`;
    aliceId = await seedUser(api.db, 'alice@itba.edu.ar', { name: 'Alice' });
    bobId = await seedUser(api.db, 'bob@itba.edu.ar', { name: 'Bob' });
  });

  test('anonymousCannotListStaff', async () => {
    const r = await api.get('/v1/staff');
    expect(r.status).toBe(401);
    expect(r.text).toBe('');
  });

  test('regularUserCannotListStaff', async () => {
    const r = await api.get('/v1/staff', { as: await user() });
    expect(r.status).toBe(403);
    expect(r.text).toBe('');
  });

  test('staffCanListStaff', async () => {
    const r = await api.get('/v1/staff', { as: await staff() });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.json)).toBe(true);
  });

  test('staffWithNonAllowlistedEmailIsForbidden', async () => {
    await seedStaff(api.db, 'boss@gmail.com');
    expect((await api.get('/v1/staff', { as: bearer(await mintJwt({ email: 'boss@gmail.com' })) })).status).toBe(403);
  });

  test('staffCanAssignAndListsActiveOnly', async () => {
    const r = await assign(ALICE_BODY);
    expect(r.status).toBe(201);
    // @JsonProperty("user_id") is written last; start/end as Jackson bound them (UTC).
    expect(r.text).toBe(`{"email":"alice@itba.edu.ar","name":"Alice","branch":"IT","role":"MEMBER","start":"2026-01-01T00:00:00Z","end":"2027-01-01T00:00:00Z","user_id":"${aliceId}"}`);

    const l = await api.get('/v1/staff', { as: await staff() });
    // alice + the boss caller, in user_id order.
    expect(l.json.length).toBe(2);
    expect(l.json.map((s: { email: string }) => s.email).sort()).toEqual(['alice@itba.edu.ar', BOSS]);
    expect(l.json.map((s: { user_id: string }) => s.user_id)).toEqual([aliceId, bossId!].sort());
  });

  test('assigningSamePersonTwiceReturns409', async () => {
    expect((await assign(ALICE_BODY)).status).toBe(201);
    const r = await assign(ALICE_BODY);
    expect(r.status).toBe(409);
    expect(r.json.error).toBe('ResourceAlreadyExists');
    expect(r.json.message).toBe("CeitbaStaff with identifier 'alice@itba.edu.ar' already exists");
  });

  test('assigningUnknownEmailReturns404', async () => {
    const r = await assign(ALICE_BODY.replace('alice@', 'ghost@'));
    expect(r.status).toBe(404);
    expect(r.json.message).toBe("User with identifier 'ghost@itba.edu.ar' not found");
  });

  test('startAfterEndReturns400', async () => {
    const r = await assign(`{"email":"alice@itba.edu.ar","branch":"IT","role":"MEMBER",
             "start":"2027-01-01T00:00:00Z","end":"2026-01-01T00:00:00Z"}`);
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('ValidationError');
    // OffsetDateTime.toString(): no seconds when zero.
    expect(r.json.message).toBe("Validation failed for field 'start' with value '2027-01-01T00:00Z': must be before end");
  });

  test('revokeEndDatesActiveMembershipSoListingDropsIt', async () => {
    await seedStaffRow(bobId, days(-1), days(365));
    expect((await assign(ALICE_BODY.replace('2027-01-01', '2030-01-01'))).status).toBe(201);
    const d = await api.delete(`/v1/staff/${aliceId}`, { as: await staff() });
    expect(d.status).toBe(204);
    expect(d.text).toBe('');
    const l = await api.get('/v1/staff', { as: await staff() });
    // bob + the boss caller; alice's row stays end-dated.
    expect(l.json.length).toBe(2);
    expect(l.json.map((s: { email: string }) => s.email).sort()).toEqual(['bob@itba.edu.ar', BOSS]);
    expect((await api.db`SELECT 1 FROM public.ceitba_staff WHERE user_id = ${aliceId}`).length).toBe(1);
  });

  test('reassigningAfterRevokeGrantsStaffAgain', async () => {
    await seedStaffRow(bobId, days(-1), days(365));
    expect((await assign(ALICE_BODY.replace('2027-01-01', '2030-01-01'))).status).toBe(201);
    expect((await api.delete(`/v1/staff/${aliceId}`, { as: await staff() })).status).toBe(204);

    const start = new Date(Date.now() - 60_000).toISOString();
    const r = await assign(`{"email":"alice@itba.edu.ar","branch":"DIRECTIVES","role":"MEMBER",
             "start":"${start}","end":"2031-01-01T00:00:00Z"}`);
    expect(r.status).toBe(201);
    expect(r.json.branch).toBe('DIRECTIVES');
    expect(await isActive(aliceId)).toBe(true);
    // alice, bob and the boss caller.
    expect((await api.get('/v1/staff', { as: await staff() })).json.length).toBe(3);
  });

  test('revokingTheLastActiveStaffMemberReturns409', async () => {
    const s = await staff();
    const r = await api.delete(`/v1/staff/${bossId}`, { as: s });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe('LastActiveStaff');
    expect(r.json.message).toBe('Cannot revoke the only active staff member. Grant the STAFF role to someone else first.');
    expect(await isActive(bossId!)).toBe(true);
  });

  test('revokingAnExpiredMembershipReturns404AndKeepsItsEnd', async () => {
    await seedStaffRow(bobId, days(-1), days(365));
    await seedStaffRow(aliceId, '2025-01-01T00:00:00Z', '2025-06-01T00:00:00Z');
    const r = await api.delete(`/v1/staff/${aliceId}`, { as: await staff() });
    expect(r.status).toBe(404);
    expect(r.json.message).toBe(`CeitbaStaff with identifier '${aliceId}' not found`);
    const [row] = await api.db`SELECT "end" = '2025-06-01T00:00:00Z'::timestamptz AS same FROM public.ceitba_staff WHERE user_id = ${aliceId}`;
    expect(row!.same).toBe(true);
  });

  test('revokingANotYetStartedMembershipDeletesIt', async () => {
    await seedStaffRow(aliceId, days(10), days(365));
    expect((await api.delete(`/v1/staff/${aliceId}`, { as: await staff() })).status).toBe(204);
    expect((await api.db`SELECT 1 FROM public.ceitba_staff WHERE user_id = ${aliceId}`).length).toBe(0);
  });

  test('regularUserCannotAssign', async () => {
    const r = await api.post('/v1/staff', { as: await user(), body: ALICE_BODY });
    expect(r.status).toBe(403);
    expect(Number((await api.db`SELECT count(*)::int AS n FROM public.ceitba_staff`)[0]!.n)).toBe(0);
  });
});
