// Ports apps/api/src/test/java/org/ceitba/api/web/user/UserEndpointsIT.java.
// ROLE_STAFF is a real ceitba_staff row for boss@itba.edu.ar, seeded lazily so
// tests that never act as staff have no extra user. The boss row is pinned to
// the oldest created_at, so it shows up last in "newest" order and first in
// "oldest": list assertions count it (+1) where the Java IT (MockMvc authorities,
// no row) does not.
import { beforeEach, describe, expect, test } from 'bun:test';
import { bearer, mintJwt, seedCareer, seedStaff, useServer, type As } from '../support';

const api = useServer();
const BOSS = 'boss@itba.edu.ar';
let staffSeeded = false;

async function staff(): Promise<As> {
  if (!staffSeeded) {
    await seedStaff(api.db, BOSS);
    await api.db`UPDATE public."user" SET name = 'Boss', created_at = '2000-01-01T00:00:00Z' WHERE email = ${BOSS}`;
    staffSeeded = true;
  }
  return bearer(await mintJwt({ email: BOSS }));
}
const user = async () => bearer(await mintJwt({ email: 'regular@itba.edu.ar' }));

const create = async (body: unknown) => api.post('/v1/users/create', { as: await staff(), body });

describe('UserEndpointsIT', () => {
  beforeEach(async () => {
    staffSeeded = false;
    await api.db`TRUNCATE public."user", public.organizations, public.careers CASCADE`;
    await seedCareer(api.db, 'S', 'Sistemas');
  });

  test('anonymousCreateReturns401', async () => {
    const r = await api.post('/v1/users/create', { body: { email: 'alice@itba.edu.ar', name: 'Alice' } });
    expect(r.status).toBe(401);
  });

  test('anonymousListReturns401', async () => {
    expect((await api.get('/v1/users')).status).toBe(401);
  });

  test('regularUserCreateReturns403', async () => {
    const r = await api.post('/v1/users/create', { as: await user(), body: { email: 'alice@itba.edu.ar', name: 'Alice' } });
    expect(r.status).toBe(403);
    expect(r.json.error).toBe('AccessDenied');
  });

  test('regularUserListReturns403', async () => {
    expect((await api.get('/v1/users', { as: await user() })).status).toBe(403);
  });

  test('regularUserGetByIdReturns403', async () => {
    expect((await api.get(`/v1/users/${crypto.randomUUID()}`, { as: await user() })).status).toBe(403);
  });

  test('staffCanCreateUserReturns201WithBody', async () => {
    const r = await create({ email: 'alice@itba.edu.ar', name: 'Alice', file_number: 12345, career_id: 'S', plan: 'S10-Rev23' });
    expect(r.status).toBe(201);
    expect(r.json.id).toBeString();
    expect(r.text).toBe(`{"id":"${r.json.id}","email":"alice@itba.edu.ar","name":"Alice","plan":"S10-Rev23","avatarUrl":null,"isStaff":false,"organizations":[],"file_number":12345,"career_id":"S"}`);
  });

  test('staffCreateWithUnknownCareerReturns404', async () => {
    const r = await create({ email: 'bob@itba.edu.ar', name: 'Bob', career_id: 'NOPE' });
    expect(r.status).toBe(404);
    expect(r.json.error).toBe('ResourceNotFound');
    expect(r.json.message).toBe("Career with identifier 'NOPE' not found");
  });

  test('staffCreateDuplicateEmailReturns409', async () => {
    expect((await create({ email: 'dup@itba.edu.ar' })).status).toBe(201);
    const r = await create({ email: 'dup@itba.edu.ar' });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe('ResourceAlreadyExists');
  });

  test('staffCreateWithBadEmailReturns400', async () => {
    const r = await create({ email: 'not-an-email' });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('ValidationError');
    expect(r.json.message).toBe('email: must be a well-formed email address');
  });

  test('staffCanListUsers', async () => {
    expect((await create({ email: 'alice@itba.edu.ar', name: 'Alice' })).status).toBe(201);
    const r = await api.get('/v1/users', { as: await staff() });
    expect(r.status).toBe(200);
    // alice + the boss caller (oldest).
    expect(r.json.data.length).toBe(2);
    expect(r.json.data[0].email).toBe('alice@itba.edu.ar');
    expect(r.json.data[1].email).toBe(BOSS);
    expect(r.json.data[1].isStaff).toBe(true);
    expect(r.json.meta).toEqual({ total: 2, page: 1, limit: 20 });
  });

  test('listUsersSupportsSearchSortAndPagination', async () => {
    for (const [e, n] of [['alice@itba.edu.ar', 'Alice'], ['bob@itba.edu.ar', 'Bob'], ['carol@itba.edu.ar', 'Carol']]) {
      expect((await create({ email: e, name: n })).status).toBe(201);
    }
    const s = await staff();
    let r = await api.get('/v1/users?q=ALI', { as: s });
    expect(r.status).toBe(200);
    expect(r.json.data.length).toBe(1);
    expect(r.json.data[0].email).toBe('alice@itba.edu.ar');

    r = await api.get('/v1/users?sort=oldest', { as: s });
    expect(r.json.data.map((u: { email: string }) => u.email)).toEqual([BOSS, 'alice@itba.edu.ar', 'bob@itba.edu.ar', 'carol@itba.edu.ar']);

    r = await api.get('/v1/users?sort=newest', { as: s });
    expect(r.json.data[0].email).toBe('carol@itba.edu.ar');

    r = await api.get('/v1/users?sort=newest&page=2&limit=2', { as: s });
    expect(r.status).toBe(200);
    expect(r.json.data.map((u: { email: string }) => u.email)).toEqual(['alice@itba.edu.ar', BOSS]);
    expect(r.json.meta).toEqual({ total: 4, page: 2, limit: 2 });

    // Meta reports the limit actually applied (capped at 100), not the raw param.
    r = await api.get('/v1/users?limit=5000&page=0', { as: s });
    expect(r.status).toBe(200);
    expect(r.json.data.length).toBe(4);
    expect(r.json.meta.page).toBe(1);
    expect(r.json.meta.limit).toBe(100);
  });

  test('listUsersFiltersByActiveStaff', async () => {
    for (const [e, n] of [['jo@itba.edu.ar', 'Jo'], ['pajo@itba.edu.ar', 'Pajo'], ['majo@itba.edu.ar', 'Majo']]) {
      expect((await create({ email: e, name: n })).status).toBe(201);
    }
    const day = 86_400_000;
    const iso = (ms: number) => new Date(ms).toISOString();
    const s = await staff();
    let r = await api.post('/v1/staff', { as: s, body: { email: 'jo@itba.edu.ar', branch: 'IT', role: 'MEMBER', start: iso(Date.now() - day), end: iso(Date.now() + 30 * day) } });
    expect(r.status).toBe(201);
    // An expired grant doesn't count.
    r = await api.post('/v1/staff', { as: s, body: { email: 'majo@itba.edu.ar', branch: 'IT', role: 'MEMBER', start: iso(Date.now() - 60 * day), end: iso(Date.now() - 30 * day) } });
    expect(r.status).toBe(201);

    r = await api.get('/v1/users?staff=true', { as: s });
    expect(r.status).toBe(200);
    // jo + the boss caller (an active staff row as well).
    expect(r.json.data.length).toBe(2);
    expect(r.json.data[0].email).toBe('jo@itba.edu.ar');
    expect(r.json.data[0].isStaff).toBe(true);
    expect(r.json.data[1].email).toBe(BOSS);
    expect(r.json.meta.total).toBe(2);
    r = await api.get('/v1/users?staff=true&q=pajo', { as: s });
    expect(r.json.data.length).toBe(0);
    r = await api.get('/v1/users', { as: s });
    expect(r.json.meta.total).toBe(4);
  });

  test('listUsersFiltersByOrganization', async () => {
    await api.db`INSERT INTO public.organizations (slug, name, full_name) VALUES ('ceitba', 'CEITBA', 'CEITBA')`;
    for (const [e, n] of [['alice@itba.edu.ar', 'Alice'], ['bob@itba.edu.ar', 'Bob']]) {
      expect((await create({ email: e, name: n })).status).toBe(201);
    }
    const [alice] = await api.db`SELECT id FROM public."user" WHERE email = 'alice@itba.edu.ar'`;
    const s = await staff();
    const add = await api.post(`/v1/users/${alice!.id}/organizations`, { as: s, body: { slug: 'ceitba', role: 'member' } });
    expect(add.status).toBe(201);
    expect(add.text).toBe('{"slug":"ceitba","role":"member"}');

    let r = await api.get('/v1/users?organization=ceitba', { as: s });
    expect(r.status).toBe(200);
    expect(r.json.data.length).toBe(1);
    expect(r.json.data[0].email).toBe('alice@itba.edu.ar');
    expect(r.json.data[0].organizations).toEqual([{ slug: 'ceitba', role: 'member' }]);

    r = await api.get('/v1/users?organization=does-not-exist', { as: s });
    expect(r.status).toBe(200);
    expect(r.json.data.length).toBe(0);
    expect(r.json.meta.total).toBe(0);
  });

  test('disallowedEmailReturns403EvenWithStaffAuthorities', async () => {
    await seedStaff(api.db, 'evil@gmail.com');
    const r = await api.post('/v1/users/create', { as: bearer(await mintJwt({ email: 'evil@gmail.com' })), body: { email: 'alice@itba.edu.ar' } });
    expect(r.status).toBe(403);
  });
});
