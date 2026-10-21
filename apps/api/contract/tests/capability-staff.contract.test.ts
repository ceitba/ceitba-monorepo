// No Java IT covers StaffCapabilityController
// (apps/api/src/main/java/org/ceitba/api/web/capability/StaffCapabilityController.java);
// written for coverage and checked on the jar first. STAFF is a real row.
import { beforeEach, describe, expect, test } from 'bun:test';
import { bearer, mintJwt, seedStaff, seedUser, useServer, type As } from '../support';

const api = useServer();
let staff: As;
let user: As;
let aliceId: string;

const DESCRIBE = {
  apuntes: '{"key":"apuntes","label":"Apuntes","description":"Compartir carpetas de Drive, ver apuntes y wikis por materia"',
};

beforeEach(async () => {
  await api.db`TRUNCATE public."user", public.organizations, public.capability_settings, public.capability_user_grants CASCADE`;
  await seedStaff(api.db, 'boss@itba.edu.ar');
  await api.db`UPDATE public."user" SET name = 'Boss' WHERE email = 'boss@itba.edu.ar'`;
  aliceId = await seedUser(api.db, 'alice@itba.edu.ar', { name: 'Alice' });
  await api.db`INSERT INTO public.organizations (slug, name, full_name) VALUES ('it', 'IT', 'Rama IT')`;
  await api.db`INSERT INTO public.user_organizations (user_id, org_slug) VALUES (${aliceId}, 'it')`;
  staff = bearer(await mintJwt({ email: 'boss@itba.edu.ar', name: 'Boss' }));
  user = bearer(await mintJwt({ email: 'alice@itba.edu.ar', name: 'Alice' }));
});

describe('StaffCapabilityController', () => {
  test('listsTheRegistryWithSwitchesAndCounts', async () => {
    const r = await api.get('/v1/staff/capabilities', { as: staff });
    expect(r.status).toBe(200);
    expect(r.text).toBe('[{"key":"apuntes","label":"Apuntes","description":"Compartir carpetas de Drive, ver apuntes y wikis por materia","enabledForAll":false,"userGrantCount":0,"orgGrantCount":0},'
      + '{"key":"resumen_semanal","label":"Resumen semanal","description":"Recibir el mail semanal \'La semana en ITBA\'","enabledForAll":false,"userGrantCount":0,"orgGrantCount":0},'
      + '{"key":"asistentes_ia","label":"Asistentes de IA","description":"Conectar asistentes de IA (Claude, ChatGPT...) a CEITBA por el servidor MCP","enabledForAll":false,"userGrantCount":0,"orgGrantCount":0}]');
  });

  test('enabledForAllSwitchIsStoredAndPublic', async () => {
    let r = await api.put('/v1/staff/capabilities/apuntes', { as: staff, body: { enabledForAll: true } });
    expect(r.status).toBe(200);
    expect(r.text).toBe(`${DESCRIBE.apuntes},"enabledForAll":true,"userGrantCount":0,"orgGrantCount":0}`);
    expect((await api.get('/v1/capabilities')).text).toBe('{"enabledForAll":["apuntes"]}');
    r = await api.put('/v1/staff/capabilities/apuntes', { as: staff, body: { enabledForAll: false } });
    expect(r.json.enabledForAll).toBe(false);
    expect((await api.get('/v1/capabilities')).text).toBe('{"enabledForAll":[]}');
    r = await api.put('/v1/staff/capabilities/apuntes', { as: staff, body: {} });
    expect(r.status).toBe(400);
    expect(r.json.message).toBe('enabledForAll: must not be null');
    r = await api.put('/v1/staff/capabilities/nope', { as: staff, body: { enabledForAll: true } });
    expect(r.status).toBe(404);
    expect(r.json.message).toBe("Capability with identifier 'nope' not found");
  });

  test('userGrantsAreNormalizedIdempotentAndRevocable', async () => {
    let r = await api.post('/v1/staff/capabilities/apuntes/users', { as: staff, body: { emails: [' Alice@ITBA.edu.ar', 'x@y.z', 'alice@itba.edu.ar'] } });
    expect(r.status).toBe(200);
    expect(r.json.users.map((u: { email: string }) => u.email)).toEqual(['alice@itba.edu.ar', 'x@y.z']);
    expect(r.json.users[0].userId).toBe(aliceId);
    expect(r.json.users[0].name).toBe('Alice');
    expect(r.json.users[0].grantedByName).toBe('Boss');
    expect(r.json.users[0].grantedAt).toMatch(/Z$/);
    expect(r.json.users[1].userId).toBeNull();
    expect(Object.keys(r.json.users[0])).toEqual(['email', 'userId', 'name', 'grantedAt', 'grantedByName']);
    const firstGrant = r.json.users[0].grantedAt;
    // Re-granting keeps the original row.
    r = await api.post('/v1/staff/capabilities/apuntes/users', { as: staff, body: { emails: ['alice@itba.edu.ar'] } });
    expect(r.json.users[0].grantedAt).toBe(firstGrant);
    expect((await api.get('/v1/auth/me', { as: user })).json.capabilities).toEqual(['apuntes']);

    r = await api.post('/v1/staff/capabilities/apuntes/users', { as: staff, body: { emails: ['ok@x.com', 'bad'] } });
    expect(r.status).toBe(400);
    expect(r.json.message).toBe("Validation failed for field 'emails' with value 'bad': is not a valid email");
    r = await api.post('/v1/staff/capabilities/apuntes/users', { as: staff, body: { emails: [] } });
    expect(r.status).toBe(400);
    expect(r.json.message).toBe('emails: must not be empty');

    r = await api.delete('/v1/staff/capabilities/apuntes/users/ALICE@itba.edu.ar', { as: staff });
    expect(r.status).toBe(200);
    expect(r.json.users.map((u: { email: string }) => u.email)).toEqual(['x@y.z']);
    // Revoking a missing grant is a no-op.
    expect((await api.delete('/v1/staff/capabilities/apuntes/users/nobody@x.com', { as: staff })).status).toBe(200);
    expect((await api.get('/v1/staff/capabilities', { as: staff })).json[0].userGrantCount).toBe(1);
  });

  test('orgGrantsCountMembersAndAreRevocable', async () => {
    let r = await api.put('/v1/staff/capabilities/asistentes_ia/orgs/it', { as: staff });
    expect(r.status).toBe(200);
    expect(r.json.users).toEqual([]);
    expect(r.json.orgs).toHaveLength(1);
    expect(r.json.orgs[0]).toMatchObject({ slug: 'it', name: 'IT', memberCount: 1, grantedByName: 'Boss' });
    expect(Object.keys(r.json.orgs[0])).toEqual(['slug', 'name', 'memberCount', 'grantedAt', 'grantedByName']);
    expect((await api.get('/v1/auth/me', { as: user })).json.capabilities).toEqual(['asistentes_ia']);
    r = await api.get('/v1/staff/capabilities/asistentes_ia/grants', { as: staff });
    expect(r.status).toBe(200);
    expect(r.json.orgs[0].slug).toBe('it');
    r = await api.put('/v1/staff/capabilities/asistentes_ia/orgs/nope', { as: staff });
    expect(r.status).toBe(404);
    expect(r.json.message).toBe("Organization with identifier 'nope' not found");
    r = await api.delete('/v1/staff/capabilities/asistentes_ia/orgs/it', { as: staff });
    expect(r.status).toBe(200);
    expect(r.text).toBe('{"users":[],"orgs":[]}');
    expect((await api.get('/v1/staff/capabilities/nope/grants', { as: staff })).status).toBe(404);
  });

  test('capabilityManagementIsStaffOnly', async () => {
    expect((await api.get('/v1/staff/capabilities', { as: user })).status).toBe(403);
    expect((await api.put('/v1/staff/capabilities/apuntes', { as: user, body: { enabledForAll: true } })).status).toBe(403);
    expect((await api.get('/v1/staff/capabilities/apuntes/grants', { as: user })).status).toBe(403);
    expect((await api.post('/v1/staff/capabilities/apuntes/users', { as: user, body: { emails: ['a@b.co'] } })).status).toBe(403);
    expect((await api.delete('/v1/staff/capabilities/apuntes/users/a@b.co', { as: user })).status).toBe(403);
    expect((await api.put('/v1/staff/capabilities/apuntes/orgs/it', { as: user })).status).toBe(403);
    expect((await api.delete('/v1/staff/capabilities/apuntes/orgs/it', { as: user })).status).toBe(403);
    expect((await api.get('/v1/staff/capabilities')).status).toBe(401);
  });
});
