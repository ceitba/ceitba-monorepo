// Ports apps/api/src/test/java/org/ceitba/api/web/news/UserOrganizationEndpointsIT.java.
// The tests of /v1/me/organizations and /v1/users[/{userId}/organizations] (web/user,
// another feature) are skipped on ts until those routes land.
import { beforeEach, describe, expect, test } from 'bun:test';
import { seedUser, supports, useServer, type As } from '../support';
import { as, seedArticle, seedEvent, seedMembership, seedOrg, staff, wipeNews } from '../../test/news/support/fixtures';

const api = useServer();
const hasMeOrgs = await supports('GET /v1/me/organizations');
const hasRoles = await supports('PATCH /v1/users/{userId}/organizations/{slug}');
const hasAddMembership = await supports('POST /v1/users/{userId}/organizations');
const hasUsers = await supports('GET /v1/users');

let boss: As;
let aliceId: string;
let carolId: string;
const orgAdmin = () => as('carol@itba.edu.ar', 'Carol');
const member = () => as('alice@itba.edu.ar', 'Alice');
const outsider = () => as('bob@itba.edu.ar', 'Bob');
const patchRole = (userId: string, slug: string, body: string, who: As) =>
  api.patch(`/v1/users/${userId}/organizations/${slug}`, { as: who, body });
const hasRole = async (userId: string, org: string, role: string) =>
  (await api.db`SELECT 1 FROM public.user_organizations WHERE user_id = ${userId} AND org_slug = ${org} AND role = ${role}`).length > 0;

const ART = (id: string, org: string) => `{"id":"${id}","title":"Hello","excerpt":"x","body":["p1"],"category":"General","authors":["Alice"],"organization":"${org}"}`;
const EVT = (id: string, org: string) => `{"id":"${id}","title":"Workshop","eventDate":"2026-06-01","startTime":"18:00:00","endTime":"20:00:00",
  "location":"Aula 101","category":"Académico","organization":"${org}"}`;

describe('UserOrganizationEndpointsIT', () => {
  beforeEach(async () => {
    await wipeNews(api.db);
    boss = await staff(api.db);
    await seedOrg(api.db, 'sabf', 'SABF', 'South American Business Forum');
    await seedOrg(api.db, 'trama', 'TRAMA', 'TRAMA ITBA');
    aliceId = await seedUser(api.db, 'alice@itba.edu.ar', { name: 'Alice' });
    await seedMembership(api.db, aliceId, 'sabf', 'member');
    await seedUser(api.db, 'bob@itba.edu.ar', { name: 'Bob' });
    carolId = await seedUser(api.db, 'carol@itba.edu.ar', { name: 'Carol' });
    await seedMembership(api.db, carolId, 'sabf', 'admin');
    await seedArticle(api.db, { id: 'trama-art', title: 'TRAMA news', excerpt: 'x', body: ['p'], category: 'news', authors: ['TRAMA'], organization: 'trama' });
    await seedArticle(api.db, { id: 'sabf-art', title: 'SABF news', excerpt: 'x', body: ['p'], category: 'news', authors: ['SABF'], organization: 'sabf' });
    await seedEvent(api.db, { id: 'trama-evt', title: 'TRAMA meetup', eventDate: '2026-06-01', startTime: '18:00', endTime: '20:00', location: 'Aula 1', category: 'meetup', organization: 'trama' });
    await seedEvent(api.db, { id: 'sabf-evt', title: 'SABF meetup', eventDate: '2026-06-01', startTime: '18:00', endTime: '20:00', location: 'Aula 2', category: 'meetup', organization: 'sabf' });
  });

  test('anonymousCannotListMyOrganizations', async () => {
    expect((await api.get('/v1/me/organizations')).status).toBe(401);
  });

  test.skipIf(!hasMeOrgs)('memberSeesOwnMemberships', async () => {
    const r = await api.get('/v1/me/organizations', { as: await member() });
    expect(r.status).toBe(200);
    expect(r.json).toHaveLength(1);
    expect(r.json[0].slug).toBe('sabf');
    expect(r.json[0].role).toBe('member');
  });

  test.skipIf(!hasMeOrgs)('outsiderSeesEmptyMemberships', async () => {
    const r = await api.get('/v1/me/organizations', { as: await outsider() });
    expect(r.status).toBe(200);
    expect(r.json).toHaveLength(0);
  });

  test('memberCanPatchOwnOrg', async () => {
    const r = await api.patch('/v1/organizations/sabf', { as: await member(), body: '{"description":"by member","logoUrl":"https://x/l.png"}' });
    expect(r.status).toBe(200);
    expect(r.json.description).toBe('by member');
    expect(r.json.logoUrl).toBe('https://x/l.png');
  });

  test('memberCannotPatchAnotherOrg', async () => {
    expect((await api.patch('/v1/organizations/trama', { as: await member(), body: '{"description":"nope"}' })).status).toBe(403);
  });

  test('memberCanPostArticleForOwnOrg', async () => {
    const r = await api.post('/v1/articles', { as: await member(), body: ART('art-1', 'sabf') });
    expect(r.status).toBe(201);
    expect(r.json.id).toBe('art-1');
    expect(r.json.organization).toBe('sabf');
    expect(r.json.status).toBe('published');
  });

  test('memberCannotPostArticleForAnotherOrg', async () => {
    expect((await api.post('/v1/articles', { as: await member(), body: ART('art-2', 'trama') })).status).toBe(403);
  });

  test('memberCanPostEventForOwnOrg', async () => {
    const r = await api.post('/v1/news/events', { as: await member(), body: EVT('evt-1', 'sabf') });
    expect(r.status).toBe(201);
    expect(r.json.id).toBe('evt-1');
    expect(r.json.organization).toBe('sabf');
  });

  test('memberCannotPostEventForAnotherOrg', async () => {
    expect((await api.post('/v1/news/events', { as: await member(), body: EVT('evt-2', 'trama') })).status).toBe(403);
  });

  test('postingArticleWithExistingIdReturns409AndLeavesItUntouched', async () => {
    const r = await api.post('/v1/articles', { as: await member(), body: `{"id":"trama-art","title":"Hijacked","excerpt":"x","body":["p"],
       "category":"General","authors":["Alice"],"organization":"sabf"}` });
    expect(r.status).toBe(409);
    expect(r.json.message).toBe("Article with identifier 'trama-art' already exists");
    const [a] = await api.db`SELECT title, organization FROM public.articles WHERE id = 'trama-art'`;
    expect(a).toMatchObject({ title: 'TRAMA news', organization: 'trama' });
  });

  test('postingEventWithExistingIdReturns409AndLeavesItUntouched', async () => {
    const r = await api.post('/v1/news/events', { as: await member(), body: `{"id":"trama-evt","title":"Hijacked","eventDate":"2026-06-01",
       "startTime":"18:00:00","endTime":"20:00:00","location":"x","category":"Académico","organization":"sabf"}` });
    expect(r.status).toBe(409);
    expect(r.json.message).toBe("Event with identifier 'trama-evt' already exists");
    const [e] = await api.db`SELECT title, organization FROM public.news_events WHERE id = 'trama-evt'`;
    expect(e).toMatchObject({ title: 'TRAMA meetup', organization: 'trama' });
  });

  test('memberCanPatchOwnOrgArticle', async () => {
    const r = await api.patch('/v1/articles/sabf-art', { as: await member(), body: '{"title":"Edited","organization":"sabf"}' });
    expect(r.status).toBe(200);
    expect(r.json.title).toBe('Edited');
  });

  test('memberCannotTakeOverAnotherOrgsArticleByPatchingItsOrg', async () => {
    expect((await api.patch('/v1/articles/trama-art', { as: await member(), body: '{"title":"Hijacked","organization":"sabf"}' })).status).toBe(403);
    const [a] = await api.db`SELECT title FROM public.articles WHERE id = 'trama-art'`;
    expect(a!.title).toBe('TRAMA news');
  });

  test('memberCannotMoveOwnArticleToAnotherOrg', async () => {
    expect((await api.patch('/v1/articles/sabf-art', { as: await member(), body: '{"organization":"trama"}' })).status).toBe(403);
  });

  test('memberCannotTakeOverAnotherOrgsEventByPatchingItsOrg', async () => {
    expect((await api.patch('/v1/news/events/trama-evt', { as: await member(), body: '{"title":"Hijacked","organization":"sabf"}' })).status).toBe(403);
    const [e] = await api.db`SELECT title FROM public.news_events WHERE id = 'trama-evt'`;
    expect(e!.title).toBe('TRAMA meetup');
  });

  test('memberCannotMoveOwnEventToAnotherOrg', async () => {
    expect((await api.patch('/v1/news/events/sabf-evt', { as: await member(), body: '{"organization":"trama"}' })).status).toBe(403);
  });

  test('memberCanPatchOwnOrgEvent', async () => {
    const r = await api.patch('/v1/news/events/sabf-evt', { as: await member(), body: '{"title":"Edited"}' });
    expect(r.status).toBe(200);
    expect(r.json.title).toBe('Edited');
  });

  test('staffCanStillMoveAnArticleBetweenOrgs', async () => {
    const r = await api.patch('/v1/articles/trama-art', { as: boss, body: '{"organization":"sabf"}' });
    expect(r.status).toBe(200);
    expect(r.json.organization).toBe('sabf');
  });

  test('plainMemberCannotListFollowers', async () => {
    expect((await api.get('/v1/organizations/sabf/followers', { as: await member() })).status).toBe(403);
  });

  test('orgAdminCanListOwnOrgFollowers', async () => {
    const r = await api.get('/v1/organizations/sabf/followers', { as: await orgAdmin() });
    expect(r.status).toBe(200);
    expect(r.json.data).toEqual([]);
    expect(r.json.count).toBe(0);
  });

  test('orgAdminCannotListAnotherOrgsFollowers', async () => {
    expect((await api.get('/v1/organizations/trama/followers', { as: await orgAdmin() })).status).toBe(403);
  });

  test('staffCanListAnyOrgsFollowers', async () => {
    expect((await api.get('/v1/organizations/trama/followers', { as: boss })).status).toBe(200);
  });

  test.skipIf(!hasRoles)('staffCanPromoteMemberToAdmin', async () => {
    const r = await patchRole(aliceId, 'sabf', '{"role":"admin"}', boss);
    expect(r.status).toBe(200);
    expect(r.json.slug).toBe('sabf');
    expect(r.json.role).toBe('admin');
    expect(await hasRole(aliceId, 'sabf', 'admin')).toBe(true);
  });

  test.skipIf(!hasRoles)('staffCanDemoteAdminToMember', async () => {
    const r = await patchRole(carolId, 'sabf', '{"role":"member"}', boss);
    expect(r.status).toBe(200);
    expect(r.json.role).toBe('member');
    expect(await hasRole(carolId, 'sabf', 'member')).toBe(true);
  });

  test.skipIf(!hasRoles)('nonStaffCannotChangeMembershipRole', async () => {
    expect((await patchRole(aliceId, 'sabf', '{"role":"admin"}', await member())).status).toBe(403);
    expect((await patchRole(aliceId, 'sabf', '{"role":"admin"}', await orgAdmin())).status).toBe(403);
    expect(await hasRole(aliceId, 'sabf', 'member')).toBe(true);
  });

  test.skipIf(!hasRoles)('changingRoleOfUnknownMembershipReturns404', async () => {
    expect((await patchRole(aliceId, 'trama', '{"role":"admin"}', boss)).status).toBe(404);
    expect((await patchRole(crypto.randomUUID(), 'sabf', '{"role":"admin"}', boss)).status).toBe(404);
  });

  test.skipIf(!hasRoles)('invalidRoleReturns400', async () => {
    expect((await patchRole(aliceId, 'sabf', '{"role":"owner"}', boss)).status).toBe(400);
    expect((await patchRole(aliceId, 'sabf', '{"role":""}', boss)).status).toBe(400);
    expect((await patchRole(aliceId, 'sabf', '{}', boss)).status).toBe(400);
    expect(await hasRole(aliceId, 'sabf', 'member')).toBe(true);
  });

  test.skipIf(!hasAddMembership)('addingMembershipWithInvalidRoleReturns400', async () => {
    const r = await api.post(`/v1/users/${aliceId}/organizations`, { as: boss, body: '{"slug":"trama","role":"owner"}' });
    expect(r.status).toBe(400);
    expect((await api.db`SELECT 1 FROM public.user_organizations WHERE user_id = ${aliceId} AND org_slug = 'trama'`).length).toBe(0);
  });

  test.skipIf(!hasRoles)('promotedAdminCanListFollowersAndDemotedAdminCannot', async () => {
    expect((await api.get('/v1/organizations/sabf/followers', { as: await member() })).status).toBe(403);
    expect((await patchRole(aliceId, 'sabf', '{"role":"admin"}', boss)).status).toBe(200);
    expect((await patchRole(carolId, 'sabf', '{"role":"member"}', boss)).status).toBe(200);
    expect((await api.get('/v1/organizations/sabf/followers', { as: await member() })).status).toBe(200);
    expect((await api.get('/v1/organizations/sabf/followers', { as: await orgAdmin() })).status).toBe(403);
  });

  test.skipIf(!hasUsers)('staffUserListExposesMembershipRoles', async () => {
    const r = await api.get('/v1/users', { as: boss });
    expect(r.status).toBe(200);
    const orgs = JSON.stringify(r.json);
    expect(orgs).toContain('"slug":"sabf","role":"admin"');
    expect(orgs).toContain('"slug":"sabf","role":"member"');
  });
});
