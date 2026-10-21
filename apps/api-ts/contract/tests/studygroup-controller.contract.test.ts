// Ports apps/api/src/test/java/org/ceitba/api/web/studygroup/StudyGroupControllerIT.java.
// MockMvc's jwt().authorities(USER, MODERATOR) becomes a real JWT plus a real
// ceitba_moderators row (seedModerator); the SYNC-only authority becomes the
// sync API key. `jsonPath(..).doesNotExist()` also passes for a key present
// with a null value: where Java prints `null`, the extra byte-level tests at
// the end pin the real shape.
import { beforeEach, describe, expect, test } from 'bun:test';
import { apiKey, bearer, mintJwt, seedModerator, seedUser, TEST_SYNC_KEY, useServer, type As } from '../support';

const api = useServer();

const OWNER = 'owner@itba.edu.ar';
const ALICE = 'alice@itba.edu.ar';
const BOB = 'bob@itba.edu.ar';
const MOD = 'mod@itba.edu.ar';

let ownerId: string;

// No "name" claim: JIT sync would copy it over the seeded display names.
const as = async (email: string): Promise<As> => bearer(await mintJwt({ email, name: null }));

/** OffsetDateTime.now().plusDays(days).truncatedTo(SECONDS).toString() */
const future = (days: number) => {
  const d = new Date(Date.now() + days * 86_400_000);
  d.setUTCMilliseconds(0);
  return d.toISOString();
};

const body = (title: string, subject: string, type: string, max: number | null, dueInDays: number) =>
  `{"title":"${title}","subjectId":"${subject}","type":"${type}","locations":["SDF","VIRTUAL"],
    "dueAt":"${future(dueInDays)}","description":"Repaso","contactLink":"https://chat.example.org/g",
    "maxParticipants":${max}}`;

const postGroup = async (email: string, json: string) => api.post('/v1/study-groups', { as: await as(email), body: json });

async function create(email: string, title = 'Parcial', subject = '93.41', type = 'EXAMEN', max: number | null = 3, dueInDays = 2): Promise<string> {
  const r = await postGroup(email, body(title, subject, type, max, dueInDays));
  expect(r.status).toBe(201);
  return r.json.id;
}

const join = async (email: string, id: string) => api.post(`/v1/study-groups/${id}/join`, { as: await as(email) });
const leave = async (email: string, id: string) => api.delete(`/v1/study-groups/${id}/membership`, { as: await as(email) });
const userId = async (email: string) => ((await api.db`SELECT id FROM public."user" WHERE email = ${email}`)[0]!.id as string);
const countOf = async (q: Promise<{ n: number }[]>) => Number((await q)[0]!.n);

async function insertGroup(owner: string, dueAtMs: number, max: number | null): Promise<string> {
  const id = crypto.randomUUID();
  await api.db`INSERT INTO public.study_groups (id, owner_id, title, subject_id, type, locations, due_at, max_participants)
               VALUES (${id}, ${owner}, 'Old', '93.41', 'GUIAS', ARRAY['SDR'], ${new Date(dueAtMs).toISOString()}, ${max})`;
  return id;
}

beforeEach(async () => {
  await api.db`TRUNCATE public."user", public.subject CASCADE`;
  ownerId = await seedUser(api.db, OWNER, { name: 'Olivia Owner', avatarUrl: 'https://img.example.org/owner.png' });
  await seedUser(api.db, ALICE, { name: 'Alice' });
  await seedUser(api.db, BOB, { name: 'Bob' });
  await seedModerator(api.db, await seedUser(api.db, MOD, { name: 'Mod' }));
  await api.db`INSERT INTO public.subject (id, name, updated_at) VALUES ('93.41', 'Algebra', now())`;
  await api.db`INSERT INTO public.subject (id, name, updated_at) VALUES ('72.08', 'Arquitectura', now())`;
});

describe('StudyGroupControllerIT', () => {
  test('createReturnsDetailWithOwnerAsFirstParticipant', async () => {
    const r = await postGroup(OWNER, body('  Parcial 1  ', '93.41', 'EXAMEN', 0, 2));
    expect(r.status).toBe(201);
    const j = r.json;
    expect(j.title).toBe('Parcial 1');
    expect(j.subject).toEqual({ id: '93.41', name: 'Algebra' });
    expect(j.type).toBe('EXAMEN');
    expect(j.locations).toHaveLength(2);
    expect(j.maxParticipants ?? null).toBeNull();
    expect(j.participantCount).toBe(1);
    expect(j.isOwner).toBe(true);
    expect(j.isMember).toBe(true);
    expect(j.isFull).toBe(false);
    expect(j.canEdit).toBe(true);
    expect(j.contactLink).toBe('https://chat.example.org/g');
    expect(j.participants).toHaveLength(1);
    expect(j.participants[0].name).toBe('Olivia Owner');
    expect(j.participants[0].avatarUrl).toBe('https://img.example.org/owner.png');
    expect(j.participants[0].isOwner).toBe(true);
  });

  test('nonMembersSeeNoContactLinkAndNobodySeesEmails', async () => {
    const id = await create(OWNER);
    expect((await join(BOB, id)).status).toBe(200);
    const r = await api.get(`/v1/study-groups/${id}`, { as: await as(ALICE) });
    expect(r.status).toBe(200);
    expect(r.json.contactLink ?? null).toBeNull();
    expect(r.json.isMember).toBe(false);
    expect(r.json.canEdit).toBe(false);
    expect(r.json.participants).toHaveLength(2);
    expect(r.json.participants[0].email).toBeUndefined();
    expect(r.json.participants[1].name).toBe('Bob');
    expect(r.text).not.toContain('@itba.edu.ar');
    const b = await api.get(`/v1/study-groups/${id}`, { as: await as(BOB) });
    expect(b.json.contactLink).toBe('https://chat.example.org/g');
  });

  test('unknownGroupIsNotFound', async () => {
    expect((await api.get(`/v1/study-groups/${crypto.randomUUID()}`, { as: await as(ALICE) })).status).toBe(404);
    expect((await join(ALICE, crypto.randomUUID())).status).toBe(404);
  });

  test('createValidatesInput', async () => {
    const subj = await postGroup(OWNER, body('t', '99.99', 'EXAMEN', 3, 2));
    expect(subj.status).toBe(400);
    expect(subj.json.message).toContain('subjectId');
    const type = await postGroup(OWNER, body('t', '93.41', 'PARTY', 3, 2));
    expect(type.status).toBe(400);
    expect(type.json.error).toBe('BadRequest');
    expect((await postGroup(OWNER, body('t', '93.41', 'EXAMEN', 3, -1))).status).toBe(400);
    expect((await postGroup(OWNER, body('t', '93.41', 'EXAMEN', 1, 2))).status).toBe(400);
    expect((await postGroup(OWNER, body('t', '93.41', 'EXAMEN', 51, 2))).status).toBe(400);
    expect((await postGroup(OWNER, body('', '93.41', 'EXAMEN', 3, 2))).status).toBe(400);
    expect((await postGroup(OWNER, body('t', '93.41', 'EXAMEN', 3, 2).replace('["SDF","VIRTUAL"]', '[]'))).status).toBe(400);
    expect((await postGroup(OWNER, body('t', '93.41', 'EXAMEN', 3, 2).replace('https://chat.example.org/g', 'javascript:alert(1)'))).status).toBe(400);
    expect(await countOf(api.db`SELECT count(*)::int AS n FROM public.study_groups`)).toBe(0);
  });

  test('listShowsUpcomingOnlyByDefaultWithFiltersAndPagination', async () => {
    const soon = await create(OWNER, 'Soon', '93.41', 'EXAMEN', 3, 1);
    const later = await create(OWNER, 'Later', '72.08', 'GUIAS', null, 5);
    const mid = await create(ALICE, 'Mid', '93.41', 'GUIAS', null, 3);
    await insertGroup(ownerId, Date.now() - 86_400_000, null);
    const bob = await as(BOB);

    const r = await api.get('/v1/study-groups', { as: bob });
    expect(r.status).toBe(200);
    expect(r.json.data).toHaveLength(3);
    expect(r.json.data.map((g: { id: string }) => g.id)).toEqual([soon, mid, later]);
    expect(r.json.data[0].participants).toBeUndefined();
    expect(r.json.data[0].contactLink ?? null).toBeNull();
    expect(r.json.data[0].participantCount).toBe(1);
    expect(r.json.meta).toEqual({ total: 3, page: 1, limit: 20 });

    const all = await api.get('/v1/study-groups', { as: bob, query: { upcoming: 'false' } });
    expect(all.json.meta.total).toBe(4);
    expect(all.json.data[0].title).toBe('Old');

    expect((await api.get('/v1/study-groups', { as: bob, query: { subject: '93.41' } })).json.data).toHaveLength(2);
    const filtered = await api.get('/v1/study-groups', { as: bob, query: { subject: '93.41', type: 'GUIAS' } });
    expect(filtered.json.data).toHaveLength(1);
    expect(filtered.json.data[0].id).toBe(mid);
    expect((await api.get('/v1/study-groups', { as: bob, query: { type: 'NOPE' } })).status).toBe(400);

    const p2 = await api.get('/v1/study-groups', { as: bob, query: { page: 2, limit: 2 } });
    expect(p2.json.data).toHaveLength(1);
    expect(p2.json.data[0].id).toBe(later);
    expect(p2.json.meta).toEqual({ total: 3, page: 2, limit: 2 });

    const a = await api.get('/v1/study-groups', { as: await as(ALICE) });
    expect(a.json.data[1].isMember).toBe(true);
    expect(a.json.data[1].isOwner).toBe(true);
    expect(a.json.data[1].contactLink).toBe('https://chat.example.org/g');
    expect(a.json.data[0].isMember).toBe(false);
  });

  test('meListsOwnedAndJoinedGroups', async () => {
    const owned = await create(ALICE, 'Mine', '93.41', 'EXAMEN', null, 3);
    const joined = await create(OWNER, 'Joined', '93.41', 'EXAMEN', null, 1);
    await create(OWNER, 'Other', '93.41', 'EXAMEN', null, 2);
    expect((await join(ALICE, joined)).status).toBe(200);
    const old = await insertGroup(ownerId, Date.now() - 3 * 86_400_000, null);
    await api.db`INSERT INTO public.study_group_participants (group_id, user_id) VALUES (${old}, ${await userId(ALICE)})`;

    const alice = await as(ALICE);
    const r = await api.get('/v1/me/study-groups', { as: alice });
    expect(r.status).toBe(200);
    expect(r.json.map((g: { id: string }) => g.id)).toEqual([joined, owned]);
    expect((await api.get('/v1/me/study-groups', { as: alice, query: { upcoming: 'false' } })).json).toHaveLength(3);
    expect((await api.get('/v1/me/study-groups', { as: await as(BOB) })).json).toHaveLength(0);
  });

  test('joinAndLeaveRules', async () => {
    const id = await create(OWNER, 'Duo', '93.41', 'TP_GRUPO', 2, 2);
    const j = await join(ALICE, id);
    expect(j.status).toBe(200);
    expect(j.json.isMember).toBe(true);
    expect(j.json.isFull).toBe(true);
    expect(j.json.contactLink).toBe('https://chat.example.org/g');
    const again = await join(ALICE, id);
    expect(again.status).toBe(200);
    expect(again.json.participantCount).toBe(2);
    const full = await join(BOB, id);
    expect(full.status).toBe(409);
    expect(full.json.error).toBe('StudyGroupFull');

    expect((await leave(ALICE, id)).status).toBe(204);
    expect((await leave(ALICE, id)).status).toBe(404);
    expect((await join(BOB, id)).status).toBe(200);

    const old = await insertGroup(ownerId, Date.now() - 60_000, null);
    const past = await join(ALICE, old);
    expect(past.status).toBe(409);
    expect(past.json.error).toBe('StudyGroupPastDue');
  });

  test('ownerLeavingTransfersToEarliestJoinerThenDeletesWhenAlone', async () => {
    const id = await create(OWNER);
    expect((await join(BOB, id)).status).toBe(200);
    expect((await join(ALICE, id)).status).toBe(200);

    expect((await leave(OWNER, id)).status).toBe(204);
    const g = await api.get(`/v1/study-groups/${id}`, { as: await as(BOB) });
    expect(g.json.isOwner).toBe(true);
    expect(g.json.canEdit).toBe(true);
    expect(g.json.participantCount).toBe(2);
    expect(g.json.participants[0].name).toBe('Bob');
    expect(g.json.participants[0].isOwner).toBe(true);

    expect((await leave(ALICE, id)).status).toBe(204);
    expect((await leave(BOB, id)).status).toBe(204);
    expect((await api.get(`/v1/study-groups/${id}`, { as: await as(BOB) })).status).toBe(404);
  });

  test('onlyOwnerOrModeratorCanEditAndDelete', async () => {
    const id = await create(OWNER);
    expect((await join(ALICE, id)).status).toBe(200);
    const alice = await as(ALICE);
    const owner = await as(OWNER);
    const mod = await as(MOD);

    const denied = await api.patch(`/v1/study-groups/${id}`, { as: alice, body: '{"title":"Renamed"}' });
    expect(denied.status).toBe(403);
    expect(denied.json.error).toBe('AccessDenied');
    expect((await api.delete(`/v1/study-groups/${id}`, { as: alice })).status).toBe(403);

    const ok = await api.patch(`/v1/study-groups/${id}`, { as: owner, body: '{"title":"Renamed","subjectId":"72.08","contactLink":"","maxParticipants":0}' });
    expect(ok.status).toBe(200);
    expect(ok.json.title).toBe('Renamed');
    expect(ok.json.subject.name).toBe('Arquitectura');
    expect(ok.json.contactLink ?? null).toBeNull();
    expect(ok.json.maxParticipants ?? null).toBeNull();
    expect(ok.json.description).toBe('Repaso');

    const byMod = await api.patch(`/v1/study-groups/${id}`, { as: mod, body: '{"maxParticipants":2}' });
    expect(byMod.status).toBe(200);
    expect(byMod.json.canEdit).toBe(true);
    expect(byMod.json.isOwner).toBe(false);
    expect((await join(BOB, id)).status).toBe(409);
    expect((await api.patch(`/v1/study-groups/${id}`, { as: owner, body: '{"maxParticipants":1}' })).status).toBe(400);
    expect((await leave(ALICE, id)).status).toBe(204);
    expect((await join(BOB, id)).status).toBe(200);
    expect((await join(ALICE, id)).status).toBe(409);
    expect((await api.patch(`/v1/study-groups/${id}`, { as: owner, body: '{"dueAt":"2001-01-01T00:00:00Z"}' })).status).toBe(400);

    expect((await api.delete(`/v1/study-groups/${id}`, { as: mod })).status).toBe(204);
    expect((await api.get(`/v1/study-groups/${id}`, { as: owner })).status).toBe(404);
    expect(await countOf(api.db`SELECT count(*)::int AS n FROM public.study_group_participants`)).toBe(0);
  });

  test('capacityCannotDropBelowMemberCount', async () => {
    const id = await create(OWNER, 'Trio', '93.41', 'AHORA', null, 2);
    expect((await join(ALICE, id)).status).toBe(200);
    expect((await join(BOB, id)).status).toBe(200);
    const r = await api.patch(`/v1/study-groups/${id}`, { as: await as(OWNER), body: '{"maxParticipants":2}' });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe('StudyGroupCapacityBelowMembers');
    expect(r.json.message).toBe("Group already has 3 members; capacity can't be set to 2");
  });

  test('requiresASignedInUser', async () => {
    expect((await api.get('/v1/study-groups')).status).toBe(401);
    expect((await api.get('/v1/me/study-groups')).status).toBe(401);
    expect((await api.get('/v1/study-groups', { as: apiKey(TEST_SYNC_KEY) })).status).toBe(403);
    expect((await api.get('/v1/study-groups', { as: await as('someone@gmail.com') })).status).toBe(403);
  });

  test('concurrentJoinsNeverExceedCapacity', async () => {
    const id = await insertGroup(ownerId, Date.now() + 86_400_000, 1);
    const racers = 12;
    const tokens: As[] = [];
    for (let i = 0; i < racers; i++) {
      const email = `racer${i}@itba.edu.ar`;
      await seedUser(api.db, email, { name: `Racer ${i}` });
      tokens.push(await as(email));
    }
    const statuses = (await Promise.all(tokens.map((t) => api.post(`/v1/study-groups/${id}/join`, { as: t })))).map((r) => r.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(racers - 1);
    expect(await countOf(api.db`SELECT count(*)::int AS n FROM public.study_group_participants WHERE group_id = ${id}`)).toBe(1);
  });
});

// Not in the IT: the exact bytes, verified on the jar. Jackson writes the
// @JsonProperty("isX") components after the others; dueAt from the request is
// adjusted to UTC; rows written in this request keep their in-memory
// timestamps (-03:00), rows loaded from the DB print UTC.
describe('StudyGroup JSON shapes', () => {
  const ART_TS = '\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?-03:00';
  const UTC_TS = '\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?Z';
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  test('createJoinGetPatchAndListBytes', async () => {
    const due = '2030-05-06T07:08:09.120-03:00';
    const c = await api.post('/v1/study-groups', { as: await as(OWNER), body: { title: ' P ', subjectId: '93.41', type: 'EXAMEN', locations: ['SDF', 'VIRTUAL', 'SDF'], dueAt: due, description: ' R ', contactLink: 'https://x.org/g', maxParticipants: 0 } });
    expect(c.status).toBe(201);
    const id = c.json.id as string;
    const head = `\\{"id":"${id}","title":"P","subject":\\{"id":"93\\.41","name":"Algebra"\\},"type":"EXAMEN","locations":\\["SDF","VIRTUAL"\\],"dueAt":"2030-05-06T10:08:09\\.12Z","description":"R",`;
    const owner = `\\{"name":"Olivia Owner","avatarUrl":"https://img\\.example\\.org/owner\\.png","joinedAt":"(${ART_TS})","isOwner":true\\}`;
    expect(c.text).toMatch(new RegExp(`^${head}"contactLink":"https://x\\.org/g","maxParticipants":null,"participantCount":1,"canEdit":true,"participants":\\[${owner}\\],"createdAt":"${ART_TS}","updatedAt":"${ART_TS}","isFull":false,"isMember":true,"isOwner":true\\}$`));
    const ownerJoined = c.json.participants[0].joinedAt as string;

    const j = await join(ALICE, id);
    const ownerDb = `\\{"name":"Olivia Owner","avatarUrl":"https://img\\.example\\.org/owner\\.png","joinedAt":"${UTC_TS}","isOwner":true\\}`;
    expect(j.text).toMatch(new RegExp(`^${head}"contactLink":"https://x\\.org/g","maxParticipants":null,"participantCount":2,"canEdit":false,"participants":\\[${ownerDb},\\{"name":"Alice","avatarUrl":null,"joinedAt":"${ART_TS}","isOwner":false\\}\\],"createdAt":"${UTC_TS}","updatedAt":"${UTC_TS}","isFull":false,"isMember":true,"isOwner":false\\}$`));
    expect(Date.parse(j.json.participants[0].joinedAt)).toBe(Date.parse(ownerJoined));
    expect(Date.parse(j.json.createdAt)).toBe(Date.parse(c.json.createdAt));

    const g = await api.get(`/v1/study-groups/${id}`, { as: await as(MOD) });
    expect(g.text).toMatch(new RegExp(`^${head}"contactLink":null,"maxParticipants":null,"participantCount":2,"canEdit":true,"participants":\\[${ownerDb},\\{"name":"Alice","avatarUrl":null,"joinedAt":"${UTC_TS}","isOwner":false\\}\\],"createdAt":"${UTC_TS}","updatedAt":"${UTC_TS}","isFull":false,"isMember":false,"isOwner":false\\}$`));

    // A changed field: updatedAt is the in-memory @UpdateTimestamp; createdAt stays the DB value.
    const p = await api.patch(`/v1/study-groups/${id}`, { as: await as(MOD), body: { title: 'N', maxParticipants: 5 } });
    expect(p.status).toBe(200);
    expect(p.text).toMatch(new RegExp(`"title":"N",.*"maxParticipants":5,"participantCount":2,"canEdit":true,.*"createdAt":"${UTC_TS}","updatedAt":"${ART_TS}","isFull":false,"isMember":false,"isOwner":false\\}$`));
    // Nothing changed: no UPDATE, so updatedAt is the DB value.
    const same = await api.patch(`/v1/study-groups/${id}`, { as: await as(OWNER), body: { title: 'N', dueAt: '2030-05-06T10:08:09.12Z', locations: ['VIRTUAL', 'SDF'].reverse() } });
    expect(same.status).toBe(200);
    expect(same.text).toMatch(new RegExp(`"createdAt":"${UTC_TS}","updatedAt":"${UTC_TS}",`));
    const empty = await api.patch(`/v1/study-groups/${id}`, { as: await as(OWNER), body: {} });
    expect(empty.text).toMatch(new RegExp(`"updatedAt":"${UTC_TS}",`));

    const list = await api.get('/v1/study-groups', { as: await as(ALICE) });
    const item = `\\{"id":"${id}","title":"N","subject":\\{"id":"93\\.41","name":"Algebra"\\},"type":"EXAMEN","locations":\\["SDF","VIRTUAL"\\],"dueAt":"2030-05-06T10:08:09\\.12Z","description":"R","contactLink":"https://x\\.org/g","maxParticipants":5,"participantCount":2,"canEdit":false,"createdAt":"${UTC_TS}","updatedAt":"${UTC_TS}","isFull":false,"isMember":true,"isOwner":false\\}`;
    expect(list.text).toMatch(new RegExp(`^\\{"data":\\[${item}\\],"meta":\\{"total":1,"page":1,"limit":20\\}\\}$`));
    const me = await api.get('/v1/me/study-groups', { as: await as(ALICE) });
    expect(me.text).toMatch(new RegExp(`^\\[${item}\\]$`));
    void esc;
  });

  test('errorMessages', async () => {
    const owner = await as(OWNER);
    const id = await create(OWNER);
    const msg = async (r: Promise<{ status: number; json: any }>) => { const x = await r; return `${x.status} ${x.json.error}: ${x.json.message}`; };
    const patch = (b: unknown) => api.patch(`/v1/study-groups/${id}`, { as: owner, body: b });
    expect(await msg(patch({ dueAt: '2001-01-01T00:00:00Z' }))).toBe("400 ValidationError: Validation failed for field 'dueAt' with value '2001-01-01T00:00Z': must be in the future");
    expect(await msg(patch({ dueAt: '2001-01-01T00:00:00.500-03:00' }))).toBe("400 ValidationError: Validation failed for field 'dueAt' with value '2001-01-01T03:00:00.500Z': must be in the future");
    expect(await msg(patch({ dueAt: '2001-01-01T00:00:07.000123Z' }))).toBe("400 ValidationError: Validation failed for field 'dueAt' with value '2001-01-01T00:00:07.000123Z': must be in the future");
    expect(await msg(patch({ maxParticipants: 1 }))).toBe("400 ValidationError: Validation failed for field 'maxParticipants' with value '1': must be 0 (unlimited) or at least 2");
    expect(await msg(patch({ title: '   ' }))).toBe("400 ValidationError: Validation failed for field 'title' with value '   ': must not be blank");
    expect(await msg(patch({ title: '' }))).toBe('400 ValidationError: title: size must be between 1 and 120');
    expect(await msg(patch({ subjectId: '99.99' }))).toBe("400 ValidationError: Validation failed for field 'subjectId' with value '99.99': unknown subject");
    expect(await msg(patch({ locations: [] }))).toBe('400 ValidationError: locations: size must be between 1 and 4');
    expect(await msg(api.patch(`/v1/study-groups/${id}`, { as: await as(ALICE), body: { title: 'x' } }))).toBe('403 AccessDenied: Only the group owner or a moderator can edit this study group');
    expect(await msg(api.delete(`/v1/study-groups/${id}`, { as: await as(ALICE) }))).toBe('403 AccessDenied: Only the group owner or a moderator can delete this study group');
    expect(await msg(leave(MOD, id))).toBe(`404 ResourceNotFound: StudyGroupMembership with identifier '${id}' not found`);
    const unknown = crypto.randomUUID();
    expect(await msg(api.get(`/v1/study-groups/${unknown}`, { as: owner }))).toBe(`404 ResourceNotFound: StudyGroup with identifier '${unknown}' not found`);
    expect(await msg(api.get('/v1/study-groups/nope', { as: owner }))).toBe("400 BadRequest: Method parameter 'id': Failed to convert value of type 'java.lang.String' to required type 'java.util.UUID'; Invalid UUID string: nope");

    const good = { title: 't', subjectId: '93.41', type: 'EXAMEN', locations: ['SDF'], dueAt: future(2) };
    const post = (b: unknown) => api.post('/v1/study-groups', { as: owner, body: b });
    expect(await msg(post({ ...good, locations: ['SDF', null] }))).toBe('400 ValidationError: locations[1]: must not be null');
    expect(await msg(post({ ...good, contactLink: 'javascript:x' }))).toBe('400 ValidationError: contactLink: must be an http(s) URL');
    expect((await post({ ...good, contactLink: '  ' })).status).toBe(201);
    expect(await msg(post({ ...good, locations: ['SDF', 'SDR', 'SDT', 'VIRTUAL', 'SDF'] }))).toBe('400 ValidationError: locations: size must be between 0 and 4');
    expect(await msg(post({ ...good, maxParticipants: -1 }))).toBe('400 ValidationError: maxParticipants: must be greater than or equal to 0');
    expect(await msg(post({ ...good, maxParticipants: 1 }))).toBe("400 ValidationError: Validation failed for field 'maxParticipants' with value '1': must be 0 (unlimited) or at least 2");
    expect(await msg(post({ ...good, subjectId: '99.99' }))).toBe("400 ValidationError: Validation failed for field 'subjectId' with value '99.99': unknown subject");
    expect(await msg(post({ ...good, locations: ['MARS'] }))).toBe('400 BadRequest: Malformed or invalid request body');
    expect(await msg(post({ ...good, dueAt: null }))).toBe('400 ValidationError: dueAt: must not be null');

    const alice = await as(ALICE);
    expect(await msg(api.get('/v1/study-groups', { as: alice, query: { type: 'NOPE' } }))).toBe("400 BadRequest: Method parameter 'type': Failed to convert value of type 'java.lang.String' to required type 'org.ceitba.api.domain.StudyGroupType'; Failed to convert from type [java.lang.String] to type [@org.springframework.web.bind.annotation.RequestParam org.ceitba.api.domain.StudyGroupType] for value [NOPE]");
    expect(await msg(api.get('/v1/study-groups', { as: alice, query: { page: 'x' } }))).toBe("400 BadRequest: Method parameter 'page': Failed to convert value of type 'java.lang.String' to required type 'int'; For input string: \"x\"");
    expect(await msg(api.get('/v1/study-groups', { as: alice, query: { upcoming: 'maybe' } }))).toBe("400 BadRequest: Method parameter 'upcoming': Failed to convert value of type 'java.lang.String' to required type 'boolean'; Invalid boolean value [maybe]");
    expect(await msg(api.get('/v1/study-groups', { as: apiKey(TEST_SYNC_KEY) }))).toBe('403 AccessDenied: Insufficient permissions');
  });

  test('pagingIsClampedLikeTheService', async () => {
    for (let i = 0; i < 3; i++) await create(OWNER, `G${i}`, '93.41', 'EXAMEN', null, i + 1);
    const alice = await as(ALICE);
    expect((await api.get('/v1/study-groups', { as: alice, query: { page: 0, limit: 0 } })).json.meta).toEqual({ total: 3, page: 1, limit: 1 });
    expect((await api.get('/v1/study-groups', { as: alice, query: { limit: 500 } })).json.meta).toEqual({ total: 3, page: 1, limit: 100 });
    const beyond = await api.get('/v1/study-groups', { as: alice, query: { page: 9, limit: 2 } });
    expect(beyond.text).toBe('{"data":[],"meta":{"total":3,"page":9,"limit":2}}');
    // A blank subject filter is no filter.
    expect((await api.get('/v1/study-groups', { as: alice, query: { subject: ' ' } })).json.meta.total).toBe(3);
  });
});
