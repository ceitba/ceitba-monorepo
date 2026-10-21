// web/share/ShareSessionController + service/share/ShareSessionService.
// There is no Java IT for share sessions: these tests were written for the
// port and proven against the jar first (bun contract/run.ts --target java share).
//
// Shapes pinned here (verified on the jar):
//   - create's response is built inside the create transaction: createdAt and
//     the creator's joinedAt are Hibernate's in-memory @CreationTimestamp values
//     (JVM zone, `-03:00`); a later GET prints the same instants from the DB (`Z`).
//   - join of a NEW participant prints its joinedAt in-memory (`-03:00`); a
//     REJOIN (JPA merge onto the managed row) prints `"joinedAt":null`.
//   - payload is the saved schedule's jsonb as Jackson re-writes it (Postgres
//     key order, decimals as Double.toString).
import { beforeEach, describe, expect, test } from 'bun:test';
import { bearer, mintJwt, seedUser, useServer, type As } from '../support';

const api = useServer();

const ART_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?-03:00$/;
const UTC_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;
const TOKEN = /^[A-Za-z0-9_-]{16}$/;

let alice: string;
let bob: string;
let carol: string;
let A: As;
let B: As;
let C: As;

const asUser = async (email: string) => bearer(await mintJwt({ email, name: null }));

async function schedule(userId: string, o: { careerId?: string | null; plan?: string | null; payload?: string } = {}): Promise<string> {
  const id = crypto.randomUUID();
  await api.db`INSERT INTO public.saved_schedules (id, user_id, name, career_id, plan, payload)
               VALUES (${id}, ${userId}, 'Mi horario', ${o.careerId === undefined ? 'S' : o.careerId}, ${o.plan === undefined ? 'S10-Rev23' : o.plan},
                       CAST(${o.payload ?? '{"commissions":["45112"]}'}::text AS jsonb))`;
  return id;
}

async function create(as: As, body: Record<string, unknown>) {
  const r = await api.post('/v1/share/sessions', { as, body });
  expect(r.status).toBe(201);
  return r;
}

beforeEach(async () => {
  await api.db`TRUNCATE public.share_sessions, public.saved_schedules, public."user" CASCADE`;
  alice = await seedUser(api.db, 'alice@itba.edu.ar', { name: '  Alice  Smith ' });
  bob = await seedUser(api.db, 'bob@itba.edu.ar', { name: null });
  carol = await seedUser(api.db, 'carol@itba.edu.ar', { name: 'Carol' });
  A = await asUser('alice@itba.edu.ar');
  B = await asUser('bob@itba.edu.ar');
  C = await asUser('carol@itba.edu.ar');
});

describe('ShareSessionController', () => {
  test('createReturns201WithTheCreatorAsOnlyParticipant', async () => {
    const s = await schedule(alice);
    const r = await create(A, { savedScheduleId: s, name: 'TPE' });
    expect(r.headers.get('content-type')).toBe('application/json');
    const j = r.json;
    expect(j.token).toMatch(TOKEN);
    expect(j.createdAt).toMatch(ART_TS);
    expect(j.participants[0].joinedAt).toMatch(ART_TS);
    expect(r.text).toBe(
      `{"id":"${j.id}","token":"${j.token}","name":"TPE","creatorDisplayName":"Alice","expiresAt":null,"createdAt":"${j.createdAt}",`
      + `"participants":[{"userId":"${alice}","displayName":"Alice","isCreator":true,"careerId":"S","plan":"S10-Rev23",`
      + `"payload":{"commissions":["45112"]},"joinedAt":"${j.participants[0].joinedAt}"}]}`);
    const [row] = await api.db`SELECT token, creator_user_id::text AS creator, name, expires_at FROM public.share_sessions WHERE id = ${j.id}`;
    expect(row).toEqual({ token: j.token, creator: alice, name: 'TPE', expires_at: null });

    // The same instants, read back from the DB, print in UTC.
    const g = await api.get(`/v1/share/sessions/${j.token}`);
    expect(g.json.createdAt).toMatch(UTC_TS);
    expect(Date.parse(g.json.createdAt)).toBe(Date.parse(j.createdAt));
    expect(Date.parse(g.json.participants[0].joinedAt)).toBe(Date.parse(j.participants[0].joinedAt));
  });

  test('createWithoutNameLeavesItNull', async () => {
    const r = await create(A, { savedScheduleId: await schedule(alice) });
    expect(r.json.name).toBeNull();
    expect(r.text).toContain('"name":null,');
  });

  test('createWithAnUnknownOrForeignScheduleIs404', async () => {
    const unknown = crypto.randomUUID();
    const r = await api.post('/v1/share/sessions', { as: A, body: { savedScheduleId: unknown } });
    expect(r.status).toBe(404);
    expect(r.json).toMatchObject({ error: 'ResourceNotFound', message: `SavedSchedule with identifier '${unknown}' not found`, path: '/api/v1/share/sessions' });
    const bobs = await schedule(bob);
    const f = await api.post('/v1/share/sessions', { as: A, body: { savedScheduleId: bobs } });
    expect(f.status).toBe(404);
    expect(f.json.message).toBe(`SavedSchedule with identifier '${bobs}' not found`);
    expect((await api.db`SELECT count(*)::int AS n FROM public.share_sessions`)[0]!.n).toBe(0);
  });

  test('createValidatesTheBody', async () => {
    const s = await schedule(alice);
    const missing = await api.post('/v1/share/sessions', { as: A, body: { name: 'x' } });
    expect(missing.status).toBe(400);
    expect(missing.json).toMatchObject({ error: 'ValidationError', message: 'savedScheduleId: must not be null' });
    const longName = await api.post('/v1/share/sessions', { as: A, body: { savedScheduleId: s, displayName: 'x'.repeat(121) } });
    expect(longName.json.message).toBe('displayName: size must be between 0 and 120');
    const longSession = await api.post('/v1/share/sessions', { as: A, body: { savedScheduleId: s, name: 'x'.repeat(121) } });
    expect(longSession.json.message).toBe('name: size must be between 0 and 120');
    const badUuid = await api.post('/v1/share/sessions', { as: A, body: { savedScheduleId: 'nope' } });
    expect(badUuid.status).toBe(400);
    expect(badUuid.json.error).toBe('BadRequest');
    // Exactly 120 is fine.
    expect((await api.post('/v1/share/sessions', { as: A, body: { savedScheduleId: s, displayName: 'y'.repeat(120) } })).status).toBe(201);
  });

  test('writesRequireASession', async () => {
    const s = await schedule(alice);
    const token = (await create(A, { savedScheduleId: s })).json.token;
    expect((await api.post('/v1/share/sessions', { body: { savedScheduleId: s } })).status).toBe(401);
    expect((await api.post(`/v1/share/sessions/${token}/join`, { body: { savedScheduleId: s } })).status).toBe(401);
    expect((await api.delete(`/v1/share/sessions/${token}/leave`)).status).toBe(401);
    expect((await api.delete(`/v1/share/sessions/${token}`)).status).toBe(401);
    // Outside the allowlist.
    expect((await api.post('/v1/share/sessions', { as: await asUser('someone@gmail.com'), body: { savedScheduleId: s } })).status).toBe(403);
  });

  test('getIsPublicAndUnknownTokensAre404', async () => {
    const token = (await create(A, { savedScheduleId: await schedule(alice), name: 'TPE' })).json.token;
    const r = await api.get(`/v1/share/sessions/${token}`);
    expect(r.status).toBe(200);
    expect(r.json.participants).toHaveLength(1);
    expect(r.json.participants[0].joinedAt).toMatch(UTC_TS);
    const nope = await api.get('/v1/share/sessions/nope');
    expect(nope.status).toBe(404);
    expect(nope.json).toMatchObject({ error: 'ResourceNotFound', message: "ShareSession with identifier 'nope' not found", path: '/api/v1/share/sessions/nope' });
  });

  test('payloadIsWrittenLikeJackson', async () => {
    const payload = JSON.stringify({ b: 1, '10': 'x', '2': [1.5, 0.0000001, 100000000000000000000], z: { y: null, x: true }, s: 'ñ\u001f"\n/' })
      .replace('"b":1', '"b":1.0').replace('1.5', '1.50');
    const s = await schedule(alice, { payload });
    const token = (await create(A, { savedScheduleId: s })).json.token;
    const r = await api.get(`/v1/share/sessions/${token}`);
    expect(r.text).toContain('"payload":{"2":[1.5,1.0E-7,100000000000000000000],"b":1.0,"s":"ñ\\u001F\\"\\n/","z":{"x":true,"y":null},"10":"x"},');
  });

  test('joinAddsANewParticipantAndRejoinReplacesTheirPick', async () => {
    const token = (await create(A, { savedScheduleId: await schedule(alice) })).json.token;
    const s1 = await schedule(bob, { careerId: null, plan: null, payload: '{"k":1}' });
    const j = await api.post(`/v1/share/sessions/${token}/join`, { as: B, body: { savedScheduleId: s1 } });
    expect(j.status).toBe(200);
    expect(j.json.createdAt).toMatch(UTC_TS);
    expect(j.json.participants).toHaveLength(2);
    expect(j.json.participants[0].joinedAt).toMatch(UTC_TS);
    const newcomer = j.json.participants[1];
    expect(newcomer.joinedAt).toMatch(ART_TS);
    expect(JSON.stringify(newcomer)).toBe(`{"userId":"${bob}","displayName":"bob","isCreator":false,"careerId":null,"plan":null,"payload":{"k":1},"joinedAt":"${newcomer.joinedAt}"}`);

    const s2 = await schedule(bob, { careerId: 'I', plan: 'I07', payload: '{}' });
    const re = await api.post(`/v1/share/sessions/${token}/join`, { as: B, body: { savedScheduleId: s2, displayName: '  Bobby ' } });
    expect(re.status).toBe(200);
    expect(re.text).toContain(`{"userId":"${bob}","displayName":"Bobby","isCreator":false,"careerId":"I","plan":"I07","payload":{},"joinedAt":null}`);
    const g = await api.get(`/v1/share/sessions/${token}`);
    expect(g.json.participants[1].joinedAt).toMatch(UTC_TS);
    expect(Date.parse(g.json.participants[1].joinedAt)).toBe(Date.parse(newcomer.joinedAt));
    expect(g.json.participants[1].displayName).toBe('Bobby');
    expect((await api.db`SELECT count(*)::int AS n FROM public.share_session_participants`)[0]!.n).toBe(2);
  });

  test('joinNeedsAKnownTokenAndOwnSchedule', async () => {
    const aliceSchedule = await schedule(alice);
    const token = (await create(A, { savedScheduleId: aliceSchedule })).json.token;
    const unknown = await api.post('/v1/share/sessions/nope/join', { as: B, body: { savedScheduleId: await schedule(bob) } });
    expect(unknown.status).toBe(404);
    expect(unknown.json.message).toBe("ShareSession with identifier 'nope' not found");
    const foreign = await api.post(`/v1/share/sessions/${token}/join`, { as: B, body: { savedScheduleId: aliceSchedule } });
    expect(foreign.status).toBe(404);
    expect(foreign.json.message).toBe(`SavedSchedule with identifier '${aliceSchedule}' not found`);
    const invalid = await api.post(`/v1/share/sessions/${token}/join`, { as: B, body: {} });
    expect(invalid.status).toBe(400);
    expect(invalid.json.message).toBe('savedScheduleId: must not be null');
  });

  test('aFullSessionRejectsNewcomersButNotMembers', async () => {
    const token = (await create(A, { savedScheduleId: await schedule(alice) })).json.token;
    const [{ id }] = await api.db`SELECT id FROM public.share_sessions WHERE token = ${token}`;
    for (let i = 0; i < 49; i++) {
      const u = await seedUser(api.db, `filler${i}@itba.edu.ar`);
      await api.db`INSERT INTO public.share_session_participants (session_id, user_id, display_name, joined_at) VALUES (${id}, ${u}, ${`F${i}`}, now())`;
    }
    const full = await api.post(`/v1/share/sessions/${token}/join`, { as: B, body: { savedScheduleId: await schedule(bob) } });
    expect(full.status).toBe(400);
    expect(full.json).toMatchObject({ error: 'ValidationError', message: `Validation failed for field 'session' with value '${token}': Session is full (max 50 participants).` });
    const again = await api.post(`/v1/share/sessions/${token}/join`, { as: A, body: { savedScheduleId: await schedule(alice), displayName: 'Ali' } });
    expect(again.status).toBe(200);
    expect(again.json.participants).toHaveLength(50);
    expect(again.json.creatorDisplayName).toBe('Ali');
  });

  test('displayNameFallsBackToTheFirstNameThenTheEmail', async () => {
    const token = (await create(C, { savedScheduleId: await schedule(carol), displayName: '   ' })).json.token;
    const r = await api.post(`/v1/share/sessions/${token}/join`, { as: A, body: { savedScheduleId: await schedule(alice) } });
    expect(r.json.creatorDisplayName).toBe('Carol');
    expect(r.json.participants.map((p: { displayName: string }) => p.displayName)).toEqual(['Carol', 'Alice']);
    await api.db`UPDATE public."user" SET name = '   ' WHERE id = ${bob}`;
    const b = await api.post(`/v1/share/sessions/${token}/join`, { as: B, body: { savedScheduleId: await schedule(bob) } });
    expect(b.json.participants[2].displayName).toBe('bob');
  });

  test('leaveRemovesOnlyTheCaller', async () => {
    const token = (await create(A, { savedScheduleId: await schedule(alice), name: 'TPE' })).json.token;
    await api.post(`/v1/share/sessions/${token}/join`, { as: B, body: { savedScheduleId: await schedule(bob) } });
    const notMember = await api.delete(`/v1/share/sessions/${token}/leave`, { as: C });
    expect(notMember.status).toBe(204);
    expect(notMember.text).toBe('');
    expect((await api.delete(`/v1/share/sessions/${token}/leave`, { as: B })).status).toBe(204);
    expect((await api.get(`/v1/share/sessions/${token}`)).json.participants).toHaveLength(1);
    // The creator leaving keeps the session, without a legend name.
    expect((await api.delete(`/v1/share/sessions/${token}/leave`, { as: A })).status).toBe(204);
    const g = await api.get(`/v1/share/sessions/${token}`);
    expect(g.status).toBe(200);
    expect(g.text).toContain('"name":"TPE","creatorDisplayName":null,"expiresAt":null,');
    expect(g.text).toEndWith('"participants":[]}');
    const unknown = await api.delete('/v1/share/sessions/nope/leave', { as: A });
    expect(unknown.status).toBe(404);
    expect(unknown.json.message).toBe("ShareSession with identifier 'nope' not found");
  });

  test('onlyTheCreatorCanDeleteAndOthersSee404', async () => {
    const token = (await create(A, { savedScheduleId: await schedule(alice) })).json.token;
    await api.post(`/v1/share/sessions/${token}/join`, { as: B, body: { savedScheduleId: await schedule(bob) } });
    const byMember = await api.delete(`/v1/share/sessions/${token}`, { as: B });
    expect(byMember.status).toBe(404);
    expect(byMember.json).toMatchObject({ error: 'ResourceNotFound', message: `ShareSession with identifier '${token}' not found`, path: `/api/v1/share/sessions/${token}` });
    const del = await api.delete(`/v1/share/sessions/${token}`, { as: A });
    expect(del.status).toBe(204);
    expect(del.text).toBe('');
    expect((await api.get(`/v1/share/sessions/${token}`)).status).toBe(404);
    expect((await api.delete(`/v1/share/sessions/${token}`, { as: A })).status).toBe(404);
    expect((await api.db`SELECT count(*)::int AS n FROM public.share_session_participants`)[0]!.n).toBe(0);
  });

  test('aDeletedScheduleLeavesAPlaceholderParticipant', async () => {
    const s = await schedule(alice);
    const token = (await create(A, { savedScheduleId: s })).json.token;
    await api.db`DELETE FROM public.saved_schedules WHERE id = ${s}`;
    const g = await api.get(`/v1/share/sessions/${token}`);
    expect(g.status).toBe(200);
    expect(g.text).toContain(`{"userId":"${alice}","displayName":"Alice","isCreator":true,"careerId":null,"plan":null,"payload":null,"joinedAt":"`);
  });

  test('participantsAreOrderedByJoinTime', async () => {
    const token = (await create(A, { savedScheduleId: await schedule(alice) })).json.token;
    await api.post(`/v1/share/sessions/${token}/join`, { as: C, body: { savedScheduleId: await schedule(carol) } });
    await api.post(`/v1/share/sessions/${token}/join`, { as: B, body: { savedScheduleId: await schedule(bob) } });
    await api.db`UPDATE public.share_session_participants SET joined_at = now() - interval '1 day' WHERE user_id = ${bob}`;
    const g = await api.get(`/v1/share/sessions/${token}`);
    expect(g.json.participants.map((p: { userId: string }) => p.userId)).toEqual([bob, alice, carol]);
    expect(g.json.participants.map((p: { isCreator: boolean }) => p.isCreator)).toEqual([false, true, false]);
  });
});
