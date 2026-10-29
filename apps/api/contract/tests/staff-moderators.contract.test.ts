// Ports apps/api/src/test/java/org/ceitba/api/web/staff/ModeratorIT.java (HTTP
// parts). The authoritiesOf(...) assertions drive StaffAwareJwtAuthenticationConverter
// directly: in-process in test/staff/moderator-roles.test.ts. STAFF is boss's real
// row; a MODERATOR caller is a real ceitba_moderators row, so
// userAndModeratorCannotManageGrants checks that no grant was created or changed
// instead of count() == 0.
import { beforeEach, describe, expect, test } from 'bun:test';
import { bearer, mintJwt, seedModerator, seedStaff, seedUser, useServer } from '../support';

const api = useServer();
const BOSS = 'boss@itba.edu.ar';
const ALICE = 'alice@itba.edu.ar';
let bossId: string;
let aliceId: string;

const as = async (email: string) => bearer(await mintJwt({ email, name: email }));
const staff = () => as(BOSS);
const modRow = async (id: string) => (await api.db`SELECT * FROM public.ceitba_moderators WHERE user_id = ${id}`)[0];

async function grantAlice() {
  const r = await api.post('/v1/staff/moderators', { as: await staff(), body: { email: ALICE } });
  expect(r.status).toBe(201);
  expect(r.json.userId).toBe(aliceId);
  expect(r.json.email).toBe(ALICE);
  expect(r.json.grantedBy).toBe(bossId);
  return r;
}

describe('ModeratorIT', () => {
  beforeEach(async () => {
    await api.db`TRUNCATE public."user" CASCADE`;
    bossId = await seedUser(api.db, BOSS, { name: 'Boss' });
    await seedStaff(api.db, BOSS);
    aliceId = await seedUser(api.db, ALICE, { name: 'Alice' });
  });

  test('staffGrantsAndRevokesModerator', async () => {
    const g = await grantAlice();
    // OffsetDateTime.now(clock): the ART clock, written with its offset.
    expect(g.json.grantedAt).toMatch(/-03:00$/);
    expect(Object.keys(g.json)).toEqual(['userId', 'email', 'name', 'grantedBy', 'grantedAt']);
    let r = await api.get('/v1/staff/moderators', { as: await staff() });
    expect(r.status).toBe(200);
    expect(r.json.length).toBe(1);
    expect(r.json[0].email).toBe(ALICE);
    expect(r.json[0].name).toBe('Alice');
    expect(r.json[0].grantedAt).toMatch(/Z$/);
    r = await api.get('/v1/auth/me', { as: await as(ALICE) });
    expect(r.status).toBe(200);
    expect(r.json.role).toBe('user');
    expect(r.json.moderator).toBe(true);

    const d = await api.delete(`/v1/staff/moderators/${aliceId}`, { as: await staff() });
    expect(d.status).toBe(204);
    expect(d.text).toBe('');
    expect((await api.get('/v1/staff/moderators', { as: await staff() })).json.length).toBe(0);
    expect((await api.get('/v1/auth/me', { as: await as(ALICE) })).json.moderator).toBe(false);

    // Revoked rows are kept for audit.
    const row = await modRow(aliceId);
    expect(row!.revoked_at).not.toBeNull();
    expect(row!.revoked_by).toBe(bossId);
  });

  test('regrantAfterRevokeReactivates', async () => {
    await grantAlice();
    expect((await api.delete(`/v1/staff/moderators/${aliceId}`, { as: await staff() })).status).toBe(204);
    await grantAlice();
    const row = await modRow(aliceId);
    expect(row!.revoked_at).toBeNull();
    expect(row!.revoked_by).toBeNull();
  });

  test('duplicateGrantIs409AndUnknownUserIs404', async () => {
    await grantAlice();
    let r = await api.post('/v1/staff/moderators', { as: await staff(), body: { email: ALICE } });
    expect(r.status).toBe(409);
    expect(r.json.message).toBe(`Moderator with identifier '${ALICE}' already exists`);
    r = await api.post('/v1/staff/moderators', { as: await staff(), body: { email: 'ghost@itba.edu.ar' } });
    expect(r.status).toBe(404);
    expect(r.json.message).toBe("User with identifier 'ghost@itba.edu.ar' not found");
    r = await api.post('/v1/staff/moderators', { as: await staff(), body: { email: 'not-an-email' } });
    expect(r.status).toBe(400);
    expect(r.json.message).toBe('email: must be a well-formed email address');
  });

  test('revokeWithoutActiveGrantIs404', async () => {
    const r = await api.delete(`/v1/staff/moderators/${aliceId}`, { as: await staff() });
    expect(r.status).toBe(404);
    expect(r.json.message).toBe(`Moderator with identifier '${aliceId}' not found`);
  });

  test('staffImpliesModerator', async () => {
    const r = await api.get('/v1/auth/me', { as: await staff() });
    expect(r.status).toBe(200);
    expect(r.json.role).toBe('staff');
    expect(r.json.moderator).toBe(true);
    // Implicit moderators are not listed as grants.
    expect((await api.get('/v1/staff/moderators', { as: await staff() })).json.length).toBe(0);
  });

  test('userAndModeratorCannotManageGrants', async () => {
    const tryAll = async () => {
      const a = await as(ALICE);
      expect((await api.post('/v1/staff/moderators', { as: a, body: { email: ALICE } })).status).toBe(403);
      expect((await api.get('/v1/staff/moderators', { as: a })).status).toBe(403);
      expect((await api.delete(`/v1/staff/moderators/${aliceId}`, { as: a })).status).toBe(403);
    };
    await tryAll();
    expect((await api.db`SELECT 1 FROM public.ceitba_moderators`).length).toBe(0);
    // As a MODERATOR: the only row is the seeded grant, untouched.
    await seedModerator(api.db, aliceId);
    const before = await modRow(aliceId);
    await tryAll();
    expect((await api.db`SELECT 1 FROM public.ceitba_moderators`).length).toBe(1);
    expect(await modRow(aliceId)).toEqual(before);
    expect((await api.get('/v1/staff/moderators')).status).toBe(401);
  });
});
