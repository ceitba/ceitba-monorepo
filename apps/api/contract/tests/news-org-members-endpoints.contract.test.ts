// Ports apps/api/src/test/java/org/ceitba/api/web/news/OrgMembersEndpointsIT.java.
// Three tests call endpoints of other features (/v1/me/organizations, /v1/users/create,
// DELETE /v1/me): skipped on ts until those land.
import { beforeEach, describe, expect, test } from 'bun:test';
import { seedUser, supports, useServer, type As } from '../support';
import { as, roleOf, seedArticle, seedEvent, seedMembership, seedOrg, staff, wipeNews } from '../../test/news/support/fixtures';

const api = useServer();
const hasMeOrgs = await supports('GET /v1/me/organizations');
const hasUsersCreate = await supports('POST /v1/users/create');
const hasDeleteMe = await supports('DELETE /v1/me');

let boss: As;
let aliceId: string; // sabf member
let bobId: string; // no org
let carolId: string; // sabf admin
const orgAdmin = () => as('carol@itba.edu.ar');
const member = () => as('alice@itba.edu.ar');
const outsider = () => as('bob@itba.edu.ar');
const invites = async () => Number((await api.db`SELECT count(*)::int AS n FROM public.org_invites`)[0]!.n);

describe('OrgMembersEndpointsIT', () => {
  beforeEach(async () => {
    await wipeNews(api.db);
    boss = await staff(api.db);
    await seedOrg(api.db, 'ceitba', 'CEITBA', 'Centro de Estudiantes');
    await seedOrg(api.db, 'sabf', 'SABF', 'South American Business Forum');
    await seedOrg(api.db, 'trama', 'TRAMA', 'TRAMA ITBA');
    aliceId = await seedUser(api.db, 'alice@itba.edu.ar', { name: 'Alice' });
    bobId = await seedUser(api.db, 'bob@itba.edu.ar', { name: 'Bob' });
    carolId = await seedUser(api.db, 'carol@itba.edu.ar', { name: 'Carol' });
    await seedMembership(api.db, aliceId, 'sabf', 'member');
    await seedMembership(api.db, carolId, 'sabf', 'admin');
    for (const org of ['sabf', 'trama']) {
      await seedArticle(api.db, { id: `${org}-art`, title: `${org} news`, excerpt: 'x', body: ['p'], category: 'news', authors: [org], organization: org });
      await seedEvent(api.db, { id: `${org}-evt`, title: `${org} meetup`, eventDate: '2026-06-01', startTime: '18:00', endTime: '20:00', location: 'Aula 1', category: 'meetup', organization: org });
    }
  });

  // ---- listing

  test('adminListsMembersWithEmails', async () => {
    const r = await api.get('/v1/organizations/sabf/members', { as: await orgAdmin() });
    expect(r.status).toBe(200);
    expect(r.json.members).toHaveLength(2);
    expect(r.json.members[0].email).toBe('carol@itba.edu.ar');
    expect(r.json.members[0].role).toBe('admin');
    expect(r.json.invites).toHaveLength(0);
    expect(Object.keys(r.json)).toEqual(['members', 'invites', 'settings']);
    expect(Object.keys(r.json.members[0])).toEqual(['userId', 'name', 'email', 'avatarUrl', 'role', 'title', 'showOnPortal', 'since']);
    expect(r.json.members[1]).toMatchObject({ userId: aliceId, name: 'Alice', email: 'alice@itba.edu.ar', avatarUrl: null, role: 'member', title: null, showOnPortal: false });
    expect(r.json.members[1].since).toMatch(/Z$/);
    expect(r.json.settings).toEqual({ attendeesVisibleToMembers: true });
  });

  test('plainMemberAndOutsiderCannotListMembers', async () => {
    expect((await api.get('/v1/organizations/sabf/members', { as: await member() })).status).toBe(403);
    expect((await api.get('/v1/organizations/sabf/members', { as: await outsider() })).status).toBe(403);
    const anon = await api.get('/v1/organizations/sabf/members');
    expect(anon.status).toBe(403);
    expect(anon.json).toMatchObject({ error: 'AccessDenied', message: 'Insufficient permissions' });
  });

  test('adminOfAnotherOrgCannotManageThisOne', async () => {
    await seedMembership(api.db, bobId, 'trama', 'admin');
    expect((await api.get('/v1/organizations/sabf/members', { as: await outsider() })).status).toBe(403);
  });

  // ---- invites

  test('inviteAddsExistingUsersAndKeepsUnknownEmailsPending', async () => {
    const r = await api.post('/v1/organizations/sabf/members/invites', { as: await orgAdmin(), body: '{"emails":["Bob@itba.edu.ar","dave@itba.edu.ar"],"role":"member"}' });
    expect(r.status).toBe(200);
    expect(Object.keys(r.json)).toEqual(['added', 'pending']);
    expect(r.json.added).toHaveLength(1);
    expect(r.json.added[0].email).toBe('bob@itba.edu.ar');
    // repo.save() merges the new row (assigned @IdClass ids): @CreationTimestamp stays null in the view.
    expect(r.json.added[0].since).toBeNull();
    expect(r.json.pending).toHaveLength(1);
    expect(r.json.pending[0].email).toBe('dave@itba.edu.ar');
    expect(Object.keys(r.json.pending[0])).toEqual(['email', 'role', 'createdAt']);
    expect(r.json.pending[0].createdAt).toMatch(/-03:00$/);
    expect(await roleOf(api.db, bobId, 'sabf')).toBe('member');
    const [m] = await api.db`SELECT added_by FROM public.user_organizations WHERE user_id = ${bobId} AND org_slug = 'sabf'`;
    expect(m!.added_by).toBe(carolId);
    expect(await invites()).toBe(1);
    const list = await api.get('/v1/organizations/sabf/members', { as: await orgAdmin() });
    expect(list.json.invites[0].createdAt).toMatch(/Z$/);
  });

  test('inviteRefusesEmailsOutsideTheLoginAllowlist', async () => {
    const r = await api.post('/v1/organizations/sabf/members/invites', { as: await orgAdmin(), body: '{"emails":["someone@gmail.com"]}' });
    expect(r.status).toBe(400);
    expect(r.json.message).toBe("Validation failed for field 'emails' with value 'someone@gmail.com': is not allowed to sign in");
    expect(await invites()).toBe(0);
    const bad = await api.post('/v1/organizations/sabf/members/invites', { as: await orgAdmin(), body: '{"emails":["not an email"],"role":"member"}' });
    expect(bad.json.message).toBe("Validation failed for field 'emails' with value 'not an email': must be an email address");
    const role = await api.post('/v1/organizations/sabf/members/invites', { as: await orgAdmin(), body: '{"emails":["dave@itba.edu.ar"],"role":"owner"}' });
    expect(role.status).toBe(400);
    expect(role.json.message).toBe("Validation failed for field 'role' with value 'owner': must be one of [member, admin]");
    const empty = await api.post('/v1/organizations/sabf/members/invites', { as: await orgAdmin(), body: '{"emails":[]}' });
    expect(empty.status).toBe(400);
    expect(empty.json.message).toBe('emails: must not be empty');
  });

  test('memberCannotInvite', async () => {
    expect((await api.post('/v1/organizations/sabf/members/invites', { as: await member(), body: '{"emails":["bob@itba.edu.ar"]}' })).status).toBe(403);
  });

  test.skipIf(!hasMeOrgs)('pendingInviteBecomesMembershipOnFirstLogin', async () => {
    expect((await api.post('/v1/organizations/sabf/members/invites', { as: await orgAdmin(), body: '{"emails":["dave@itba.edu.ar"],"role":"admin"}' })).status).toBe(200);
    const r = await api.get('/v1/me/organizations', { as: await as('dave@itba.edu.ar') });
    expect(r.status).toBe(200);
    expect(r.json).toHaveLength(1);
    expect(r.json[0].slug).toBe('sabf');
    expect(r.json[0].role).toBe('admin');
    expect(await invites()).toBe(0);
  });

  test.skipIf(!hasUsersCreate)('pendingInviteIsClaimedWhenStaffCreatesTheUser', async () => {
    expect((await api.post('/v1/organizations/sabf/members/invites', { as: await orgAdmin(), body: '{"emails":["dave@itba.edu.ar"]}' })).status).toBe(200);
    expect((await api.post('/v1/users/create', { as: boss, body: '{"email":"dave@itba.edu.ar","name":"Dave"}' })).status).toBe(201);
    const [dave] = await api.db`SELECT id FROM public."user" WHERE email = 'dave@itba.edu.ar'`;
    expect(await roleOf(api.db, dave!.id, 'sabf')).toBe('member');
    expect(await invites()).toBe(0);
  });

  // The /manage "Invitar por email" flow: STAFF who isn't a member of the org (#26).
  test('staffInvitesListsAndRevokesPendingInvites', async () => {
    const inv = await api.post('/v1/organizations/sabf/members/invites', { as: boss, body: '{"emails":["dave@itba.edu.ar"],"role":"admin"}' });
    expect(inv.status).toBe(200);
    expect(inv.json.pending[0].email).toBe('dave@itba.edu.ar');
    const list = await api.get('/v1/organizations/sabf/members', { as: boss });
    expect(list.status).toBe(200);
    expect(list.json.invites).toHaveLength(1);
    expect(list.json.invites[0].role).toBe('admin');
    const del = await api.delete('/v1/organizations/sabf/members/invites', { as: boss, query: { email: 'dave@itba.edu.ar' } });
    expect(del.status).toBe(204);
    expect(await invites()).toBe(0);
  });

  test('adminRevokesPendingInvite', async () => {
    expect((await api.post('/v1/organizations/sabf/members/invites', { as: await orgAdmin(), body: '{"emails":["dave@itba.edu.ar"]}' })).status).toBe(200);
    const r = await api.delete('/v1/organizations/sabf/members/invites', { as: await orgAdmin(), query: { email: 'dave@itba.edu.ar' } });
    expect(r.status).toBe(204);
    expect(await invites()).toBe(0);
    const again = await api.delete('/v1/organizations/sabf/members/invites', { as: await orgAdmin(), query: { email: 'dave@itba.edu.ar' } });
    expect(again.status).toBe(404);
    expect(again.json.message).toBe("OrgInvite with identifier 'sabf:dave@itba.edu.ar' not found");
    const missing = await api.delete('/v1/organizations/sabf/members/invites', { as: await orgAdmin() });
    expect(missing.status).toBe(400);
    expect(missing.json.error).toBe('BadRequest');
  });

  // ---- roles, board, removal, last-admin guard

  test('adminSetsBoardTitleShownOnThePortal', async () => {
    const r = await api.patch(`/v1/organizations/sabf/members/${aliceId}`, { as: await orgAdmin(), body: '{"title":"Presidenta","showOnPortal":true}' });
    expect(r.status).toBe(200);
    expect(r.json.title).toBe('Presidenta');
    expect(r.json.showOnPortal).toBe(true);
    expect(r.json.since).toMatch(/Z$/);
    const g = await api.get('/v1/organizations/sabf');
    expect(g.status).toBe(200);
    expect(g.json.board).toEqual([{ name: 'Alice', title: 'Presidenta', avatarUrl: null }]);
    const long = await api.patch(`/v1/organizations/sabf/members/${aliceId}`, { as: await orgAdmin(), body: `{"title":"${'x'.repeat(61)}"}` });
    expect(long.status).toBe(400);
    expect(long.json.message).toBe('title: size must be between 0 and 60');
  });

  test('adminCannotDemoteOrRemoveThemselvesWhenLastAdmin', async () => {
    const r = await api.patch(`/v1/organizations/sabf/members/${carolId}`, { as: await orgAdmin(), body: '{"role":"member"}' });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe('LastOrgAdmin');
    expect(r.json.message).toBe("You are the only admin of 'sabf'. Make another member admin first.");
    const leave = await api.delete('/v1/organizations/sabf/members/me', { as: await orgAdmin() });
    expect(leave.status).toBe(409);
    expect(leave.json.error).toBe('LastOrgAdmin');
    expect(await roleOf(api.db, carolId, 'sabf')).toBe('admin');
    expect((await api.delete(`/v1/organizations/sabf/members/${carolId}`, { as: boss })).status).toBe(204);
    expect(await roleOf(api.db, carolId, 'sabf')).toBeNull();
  });

  test('transferAdminHandsOverAndStepsDown', async () => {
    const r = await api.post(`/v1/organizations/sabf/members/${aliceId}/transfer-admin`, { as: await orgAdmin() });
    expect(r.status).toBe(204);
    expect(await roleOf(api.db, aliceId, 'sabf')).toBe('admin');
    expect(await roleOf(api.db, carolId, 'sabf')).toBe('member');
    expect((await api.get('/v1/organizations/sabf/members', { as: await orgAdmin() })).status).toBe(403);
    // Not in the IT: to oneself, and staff (no admin row) can't use it.
    const self = await api.post(`/v1/organizations/sabf/members/${aliceId}/transfer-admin`, { as: await member() });
    expect(self.status).toBe(400);
    expect(self.json.message).toBe(`Validation failed for field 'userId' with value '${aliceId}': must be another member`);
    expect((await api.post(`/v1/organizations/sabf/members/${carolId}/transfer-admin`, { as: boss })).status).toBe(403);
  });

  test('adminRemovesMemberAndMemberCanLeave', async () => {
    expect((await api.delete(`/v1/organizations/sabf/members/${aliceId}`, { as: await orgAdmin() })).status).toBe(204);
    expect(await roleOf(api.db, aliceId, 'sabf')).toBeNull();
    await seedMembership(api.db, bobId, 'sabf', 'member');
    expect((await api.delete('/v1/organizations/sabf/members/me', { as: await outsider() })).status).toBe(204);
    expect(await roleOf(api.db, bobId, 'sabf')).toBeNull();
  });

  test.skipIf(!hasDeleteMe)('lastOrgAdminCannotDeleteTheirAccount', async () => {
    const r = await api.delete('/v1/me', { as: await orgAdmin() });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe('LastOrgAdmin');
    const [u] = await api.db`SELECT id FROM public."user" WHERE id = ${carolId}`;
    expect(u).toBeDefined();
  });

  // ---- content and uploads

  test('memberDeletesOwnOrgsEventAndArticleButNotAnotherOrgs', async () => {
    const m = await member();
    expect((await api.delete('/v1/news/events/sabf-evt', { as: m })).status).toBe(204);
    expect((await api.delete('/v1/articles/sabf-art', { as: m })).status).toBe(204);
    expect((await api.delete('/v1/news/events/trama-evt', { as: m })).status).toBe(403);
    expect((await api.delete('/v1/articles/trama-art', { as: m })).status).toBe(403);
    const rows = await api.db`SELECT id FROM public.news_events UNION ALL SELECT id FROM public.articles ORDER BY 1`;
    expect(rows.map((x) => x.id)).toEqual(['trama-art', 'trama-evt']);
  });

  test('orgImageUploadIsForMembersOnly', async () => {
    const body = '{"filename":"logo.png","contentType":"image/png","sizeBytes":1024}';
    expect((await api.post('/v1/organizations/sabf/media/sign-upload', { as: await outsider(), body })).status).toBe(403);
    const r = await api.post('/v1/organizations/sabf/media/sign-upload', { as: await member(), body });
    expect(r.status).toBe(501);
    expect(r.json.error).toBe('NotImplemented');
    expect(r.json.message).toBe('Object storage not configured. Set STORAGE_ENDPOINT, STORAGE_BUCKET, STORAGE_ACCESS_KEY_ID, STORAGE_SECRET_ACCESS_KEY and STORAGE_PUBLIC_URL.');
    // Validated before the check: a bad type is 400 even for a member.
    const bad = await api.post('/v1/organizations/sabf/media/sign-upload', { as: await member(), body: '{"filename":"x.gif","contentType":"image/gif","sizeBytes":10}' });
    expect(bad.status).toBe(400);
    expect((await api.post('/v1/organizations/nope/media/sign-upload', { as: boss, body })).status).toBe(404);
  });

  test('memberUpdatesContactAndRecruitingFields', async () => {
    const m = await member();
    const r = await api.patch('/v1/organizations/sabf', { as: m, body: `{"instagram":"https://www.instagram.com/SABF.ok/","websiteUrl":"https://sabf.org.ar",
       "contactEmail":"sabf@itba.edu.ar","recruitingOpen":true,"recruitingText":"Sumate"}` });
    expect(r.status).toBe(200);
    expect(r.json.instagram).toBe('sabf.ok');
    expect(r.json.recruitingOpen).toBe(true);
    expect((await api.patch('/v1/organizations/sabf', { as: m, body: '{"websiteUrl":"javascript:alert(1)"}' })).status).toBe(400);
  });

  // Not in the IT: member settings by an admin, members of an unknown org.
  test('settingsAndUnknownOrg', async () => {
    const s = await api.patch('/v1/organizations/sabf/members/settings', { as: await orgAdmin(), body: '{}' });
    expect(s.status).toBe(200);
    expect(s.text).toBe('{"attendeesVisibleToMembers":true}');
    const off = await api.patch('/v1/organizations/sabf/members/settings', { as: boss, body: '{"attendeesVisibleToMembers":false}' });
    expect(off.text).toBe('{"attendeesVisibleToMembers":false}');
    const unknown = await api.get('/v1/organizations/nope/members', { as: boss });
    expect(unknown.status).toBe(404);
    const unknownMember = await api.patch(`/v1/organizations/sabf/members/${bobId}`, { as: boss, body: '{"title":"x"}' });
    expect(unknownMember.status).toBe(404);
    expect(unknownMember.json.message).toBe(`UserOrganization with identifier '${bobId}:sabf' not found`);
    const badId = await api.patch('/v1/organizations/sabf/members/not-a-uuid', { as: boss, body: '{"title":"x"}' });
    expect(badId.status).toBe(400);
  });
});
