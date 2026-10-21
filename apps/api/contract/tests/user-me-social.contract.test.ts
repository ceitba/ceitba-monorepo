// No Java IT covers these operations; written for coverage and checked on the
// jar first: MeProfileController /preferences, MeFollowsController,
// MeOrganizationsController, MeRsvpsController and the PATCH/DELETE/GET of
// UserMembershipsController (apps/api/src/main/java/org/ceitba/api/web/user/).
import { beforeEach, describe, expect, test } from 'bun:test';
import { bearer, mintJwt, seedStaff, seedUser, useServer } from '../support';

const api = useServer();
const ALICE = 'alice@itba.edu.ar';
let aliceId: string;
const alice = async () => bearer(await mintJwt({ email: ALICE, name: 'Alice' }));
const staff = async () => {
  await seedStaff(api.db, 'boss@itba.edu.ar');
  return bearer(await mintJwt({ email: 'boss@itba.edu.ar', name: 'Boss' }));
};

beforeEach(async () => {
  await api.db`TRUNCATE public."user", public.organizations, public.news_events CASCADE`;
  aliceId = await seedUser(api.db, ALICE, { name: 'Alice' });
  await api.db`INSERT INTO public.organizations (slug, name, full_name) VALUES ('ceitba', 'CEITBA', 'CEITBA'), ('it', 'IT', 'Rama IT')`;
});

describe('MeProfileController /preferences', () => {
  test('preferencesStartEmptyAndPatchSetsAndClears', async () => {
    const a = await alice();
    let r = await api.get('/v1/me/preferences', { as: a });
    expect(r.status).toBe(200);
    expect(r.text).toBe('{"theme":null,"language":null}');
    r = await api.patch('/v1/me/preferences', { as: a, body: { theme: 'dark', language: 'en' } });
    expect(r.status).toBe(200);
    expect(r.text).toBe('{"theme":"dark","language":"en"}');
    // null leaves alone, "" clears.
    r = await api.patch('/v1/me/preferences', { as: a, body: { theme: '' } });
    expect(r.text).toBe('{"theme":null,"language":"en"}');
    expect((await api.get('/v1/me/preferences', { as: a })).text).toBe('{"theme":null,"language":"en"}');
  });

  test('invalidPreferencesAre400WithTheirOwnMessages', async () => {
    const a = await alice();
    let r = await api.patch('/v1/me/preferences', { as: a, body: { theme: 'blue' } });
    expect(r.status).toBe(400);
    expect(r.json.message).toBe("theme: theme must be 'light' or 'dark'");
    r = await api.patch('/v1/me/preferences', { as: a, body: { language: 'toolong' }, headers: { 'Accept-Language': 'es-AR' } });
    expect(r.status).toBe(400);
    expect(r.json.message).toBe('language: language code too long');
  });

  test('requiresAuthentication', async () => {
    expect((await api.get('/v1/me/preferences')).status).toBe(401);
  });
});

describe('MeFollowsController', () => {
  test('followListAndUnfollow', async () => {
    const a = await alice();
    let r = await api.post('/v1/me/follows/it', { as: a });
    expect(r.status).toBe(201);
    expect(r.json.orgSlug).toBe('it');
    // A new follow answers its in-memory creation time (JVM zone).
    expect(r.json.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?-03:00$/);
    // Re-following is idempotent: a merge of a transient entity answers createdAt null.
    r = await api.post('/v1/me/follows/it', { as: a });
    expect(r.status).toBe(201);
    expect(r.text).toBe('{"orgSlug":"it","createdAt":null}');

    r = await api.get('/v1/me/follows', { as: a });
    expect(r.status).toBe(200);
    expect(r.json).toHaveLength(1);
    expect(r.json[0].orgSlug).toBe('it');
    expect(r.json[0].createdAt).toMatch(/Z$/);

    let d = await api.delete('/v1/me/follows/it', { as: a });
    expect(d.status).toBe(204);
    expect((await api.get('/v1/me/follows', { as: a })).text).toBe('[]');
    // Unfollowing what you don't follow is a no-op.
    d = await api.delete('/v1/me/follows/nope', { as: a });
    expect(d.status).toBe(204);
  });

  test('followingAnUnknownOrganizationIs404', async () => {
    const r = await api.post('/v1/me/follows/nope', { as: await alice() });
    expect(r.status).toBe(404);
    expect(r.json.message).toBe("Organization with identifier 'nope' not found");
  });
});

describe('MeOrganizationsController and MeRsvpsController', () => {
  test('listsTheCallersMembershipsAndRsvps', async () => {
    const a = await alice();
    expect((await api.get('/v1/me/organizations', { as: a })).text).toBe('[]');
    expect((await api.get('/v1/me/rsvps', { as: a })).text).toBe('{"eventIds":[]}');
    await api.db`INSERT INTO public.user_organizations (user_id, org_slug, role) VALUES (${aliceId}, 'it', 'admin')`;
    await api.db`INSERT INTO public.news_events (id, title, event_date, start_time, end_time, location, category)
                 VALUES ('e1', 'Charla', '2026-11-01', '18:00', '20:00', 'SDF', 'charla')`;
    await api.db`INSERT INTO public.event_rsvps (event_id, user_id) VALUES ('e1', ${aliceId})`;
    expect((await api.get('/v1/me/organizations', { as: a })).text).toBe('[{"slug":"it","role":"admin"}]');
    expect((await api.get('/v1/me/rsvps', { as: a })).text).toBe('{"eventIds":["e1"]}');
  });
});

describe('UserMembershipsController', () => {
  test('staffAddsChangesListsAndRemovesAMembership', async () => {
    const s = await staff();
    let r = await api.post(`/v1/users/${aliceId}/organizations`, { as: s, body: { slug: 'it' } });
    expect(r.status).toBe(201);
    expect(r.text).toBe('{"slug":"it","role":"member"}');
    r = await api.post(`/v1/users/${aliceId}/organizations`, { as: s, body: { slug: 'it' } });
    expect(r.status).toBe(409);
    expect(r.json.message).toBe(`UserOrganization with identifier '${aliceId}:it' already exists`);
    r = await api.post(`/v1/users/${aliceId}/organizations`, { as: s, body: { slug: 'ceitba', role: 'boss' } });
    expect(r.status).toBe(400);
    expect(r.json.message).toBe("Validation failed for field 'role' with value 'boss': must be one of [member, admin]");
    r = await api.post(`/v1/users/${aliceId}/organizations`, { as: s, body: { slug: 'nope' } });
    expect(r.status).toBe(404);

    r = await api.patch(`/v1/users/${aliceId}/organizations/it`, { as: s, body: { role: 'admin' } });
    expect(r.status).toBe(200);
    expect(r.text).toBe('{"slug":"it","role":"admin"}');
    r = await api.patch(`/v1/users/${aliceId}/organizations/it`, { as: s, body: { role: '' } });
    expect(r.status).toBe(400);
    expect(r.json.message).toBe('role: must not be blank');
    r = await api.patch(`/v1/users/${aliceId}/organizations/ceitba`, { as: s, body: { role: 'admin' } });
    expect(r.status).toBe(404);
    expect(r.json.message).toBe(`UserOrganization with identifier '${aliceId}:ceitba' not found`);

    r = await api.get(`/v1/users/${aliceId}/organizations`, { as: s });
    expect(r.status).toBe(200);
    expect(r.text).toBe('[{"slug":"it","role":"admin"}]');
    const u = await api.get(`/v1/users/${aliceId}`, { as: s });
    expect(u.status).toBe(200);
    expect(u.text).toBe(`{"id":"${aliceId}","email":"${ALICE}","name":"Alice","plan":null,"avatarUrl":null,"isStaff":false,"organizations":[{"slug":"it","role":"admin"}],"file_number":null,"career_id":null}`);

    // STAFF has no last-admin guard; removing a non-membership is a no-op.
    expect((await api.delete(`/v1/users/${aliceId}/organizations/it`, { as: s })).status).toBe(204);
    expect((await api.delete(`/v1/users/${aliceId}/organizations/it`, { as: s })).status).toBe(204);
    expect((await api.get(`/v1/users/${aliceId}/organizations`, { as: s })).text).toBe('[]');
  });

  test('membershipsAreStaffOnly', async () => {
    const a = await alice();
    expect((await api.get(`/v1/users/${aliceId}/organizations`, { as: a })).status).toBe(403);
    expect((await api.patch(`/v1/users/${aliceId}/organizations/it`, { as: a, body: { role: 'admin' } })).status).toBe(403);
    expect((await api.delete(`/v1/users/${aliceId}/organizations/it`, { as: a })).status).toBe(403);
    expect((await api.get(`/v1/users/${aliceId}`, { as: a })).status).toBe(403);
    const bad = await api.get('/v1/users/not-a-uuid', { as: await staff() });
    expect(bad.status).toBe(400);
  });
});
