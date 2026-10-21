// Ports apps/api/src/test/java/org/ceitba/api/web/proposal/ProposalControllerIT.java.
// MockMvc's jwt().authorities(MODERATOR) becomes a real ceitba_moderators row
// (seedModerator); the other users are plain signed-in users. Extra tests at
// the end (not in the IT) pin the JSON shapes, the attachment-key checks and
// the sign-upload endpoint byte for byte on both targets.
import { beforeEach, describe, expect, test } from 'bun:test';
import { ContentHmac } from '../../src/features/crypto/logic/contentHmac';
import { MediaUploadService } from '../../src/features/media/logic/mediaUploadService';
import { UnconfiguredObjectStorage } from '../../src/infra/storage';
import { bearer, mintJwt, seedModerator, seedUser, supports, TEST_JWT_SECRET, truncateUsers, useServer, type As } from '../support';

const api = useServer();
const hasAccountDeletion = await supports('DELETE /v1/me');

const AUTHOR = 'autora@itba.edu.ar';
const ALICE = 'alice@itba.edu.ar';
const BOB = 'bob@itba.edu.ar';
const MOD = 'mod@itba.edu.ar';
const NAMES: Record<string, string> = { [AUTHOR]: 'Ana Autora', [ALICE]: 'Alice Pérez', [BOB]: 'Bob Gómez', [MOD]: 'Mora Moderadora' };

let people: { id: string; email: string; name: string }[] = [];
const ids: Record<string, string> = {};

const as = async (email: string): Promise<As> => bearer(await mintJwt({ email, name: `Nombre ${email}` }));
const mod = () => as(MOD);

/** Asserts the body leaks no identity of any seeded user. */
function assertAnonymous(body: string) {
  for (const u of people) {
    expect(body).not.toContain(u.id);
    expect(body).not.toContain(u.email);
    expect(body).not.toContain(u.name);
  }
  expect(body).not.toContain('authorId');
  expect(body).not.toContain('userId');
}

async function create(email: string, title: string, topic: string): Promise<string> {
  const r = await api.post('/v1/proposals', { as: await as(email), body: `{"title":"${title}","description":"Descripción","topic":"${topic}"}` });
  expect(r.status).toBe(201);
  return r.json.id;
}

async function createApproved(title: string, topic: string): Promise<string> {
  const id = await create(AUTHOR, title, topic);
  expect((await api.post(`/v1/staff/proposals/${id}/approve`, { as: await mod() })).status).toBe(200);
  return id;
}

const PROPOSAL_KEYS = ['id', 'title', 'description', 'topic', 'status', 'lifecycle', 'rejectionReason', 'attachments',
  'upCount', 'downCount', 'commentCount', 'myVote', 'isMine', 'authorAlias', 'createdAt', 'moderatedAt'];
const COMMENT_KEYS = ['id', 'parentId', 'alias', 'isMine', 'isAuthor', 'body', 'deleted', 'createdAt', 'replies'];
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;
const ART = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?-03:00$/;

describe('ProposalControllerIT', () => {
  beforeEach(async () => {
    await truncateUsers(api.db);
    people = [];
    for (const email of [AUTHOR, ALICE, BOB, MOD]) {
      ids[email] = await seedUser(api.db, email, { name: NAMES[email]! });
      people.push({ id: ids[email]!, email, name: NAMES[email]! });
    }
    await seedModerator(api.db, ids[MOD]!);
  });

  test('anonymousIsRejected', async () => {
    expect((await api.get('/v1/proposals')).status).toBe(401);
    expect((await api.post('/v1/proposals', { body: '{}' })).status).toBe(401);
  });

  test('pendingProposalIsVisibleOnlyToAuthorAndModerators', async () => {
    const r = await api.post('/v1/proposals', { as: await as(AUTHOR),
      body: '{"title":"Más microondas","description":"En el 3er piso","topic":"vida_universitaria"}' });
    expect(r.status).toBe(201);
    expect(r.json.status).toBe('PENDING');
    expect(r.json.lifecycle).toBe('ABIERTO');
    expect(r.json.topic).toBe('VIDA_UNIVERSITARIA');
    expect(r.json.isMine).toBe(true);
    expect(typeof r.json.authorAlias).toBe('string');
    expect(r.json.attachments).toHaveLength(0);
    assertAnonymous(r.text);
    const id = r.json.id as string;

    const bob = await as(BOB);
    const list = await api.get('/v1/proposals', { as: bob });
    expect(list.status).toBe(200);
    expect(list.json.data).toHaveLength(0);
    expect(list.json.meta.total).toBe(0);
    expect((await api.get(`/v1/proposals/${id}`, { as: bob })).status).toBe(404);
    expect((await api.get(`/v1/proposals/${id}/comments`, { as: bob })).status).toBe(404);
    expect((await api.put(`/v1/proposals/${id}/vote`, { as: bob, body: '{"value":"UP"}' })).status).toBe(404);

    const author = await as(AUTHOR);
    const own = await api.get(`/v1/proposals/${id}`, { as: author });
    expect(own.status).toBe(200);
    expect(own.json.isMine).toBe(true);
    expect((await api.put(`/v1/proposals/${id}/vote`, { as: author, body: '{"value":"UP"}' })).status).toBe(409);
    const asMod = await api.get(`/v1/proposals/${id}`, { as: await mod() });
    expect(asMod.status).toBe(200);
    expect(asMod.json.isMine).toBe(false);

    const mine = await api.get('/v1/me/proposals', { as: author });
    expect(mine.json.data).toHaveLength(1);
    expect(mine.json.data[0].status).toBe('PENDING');
    expect((await api.get('/v1/me/proposals', { as: bob })).json.data).toHaveLength(0);

    expect((await api.post(`/v1/staff/proposals/${id}/approve`, { as: await mod() })).status).toBe(200);
    const approved = await api.get(`/v1/proposals/${id}`, { as: bob });
    expect(approved.status).toBe(200);
    expect(approved.json.status).toBe('APPROVED');
    expect(approved.json.isMine).toBe(false);
  });

  test('listIsApprovedOnlyNewestFirstPaginatedAndFilterable', async () => {
    const first = await createApproved('Primera', 'EVENTOS');
    const second = await createApproved('Segunda', 'CURSOS');
    const third = await createApproved('Tercera', 'EVENTOS');
    await create(AUTHOR, 'Pendiente', 'EVENTOS');

    const bob = await as(BOB);
    const page1 = await api.get('/v1/proposals?limit=2', { as: bob });
    expect(page1.status).toBe(200);
    expect(page1.json.meta).toEqual({ total: 3, page: 1, limit: 2 });
    expect(page1.json.data).toHaveLength(2);
    expect(page1.json.data[0].id).toBe(third);
    expect(page1.json.data[1].id).toBe(second);
    assertAnonymous(page1.text);
    const page2 = await api.get('/v1/proposals?limit=2&page=2', { as: bob });
    expect(page2.json.data).toHaveLength(1);
    expect(page2.json.data[0].id).toBe(first);

    const eventos = await api.get('/v1/proposals?topic=EVENTOS', { as: bob });
    expect(eventos.json.meta.total).toBe(2);
    expect(eventos.json.data[0].id).toBe(third);
    expect(eventos.json.data[1].id).toBe(first);
    const nope = await api.get('/v1/proposals?topic=NOPE', { as: bob });
    expect(nope.status).toBe(400);
    expect(nope.json.error).toBe('BadRequest');
    expect(nope.json.message).toBe("Method parameter 'topic': Failed to convert value of type 'java.lang.String' to required type "
      + "'org.ceitba.api.domain.proposal.ProposalTopic'; Failed to convert from type [java.lang.String] to type "
      + '[@org.springframework.web.bind.annotation.RequestParam org.ceitba.api.domain.proposal.ProposalTopic] for value [NOPE]');
  });

  test('createValidatesInput', async () => {
    const author = await as(AUTHOR);
    expect((await api.post('/v1/proposals', { as: author, body: '{"title":"","description":"d","topic":"OTROS"}' })).status).toBe(400);
    expect((await api.post('/v1/proposals', { as: author, body: '{"title":"a\\nb","description":"d","topic":"OTROS"}' })).status).toBe(400);
    expect((await api.post('/v1/proposals', { as: author, body: '{"title":"t","description":"d"}' })).status).toBe(400);
    const deportes = await api.post('/v1/proposals', { as: author, body: '{"title":"t","description":"d","topic":"DEPORTES"}' });
    expect(deportes.status).toBe(400);
    expect(deportes.json.error).toBe('BadRequest');
    const key = await api.post('/v1/proposals', { as: author,
      body: '{"title":"t","description":"d","topic":"OTROS","attachmentKeys":["proposals/x/y.png"]}' });
    expect(key.status).toBe(400);
    expect(key.json.error).toBe('ValidationError');
    expect((await api.get('/v1/me/proposals', { as: author })).json.meta.total).toBe(0);
  });

  test('votesKeepCountersAndMyVote', async () => {
    const id = await createApproved('Votable', 'CEITBA');
    const vote = `/v1/proposals/${id}/vote`;
    const alice = await as(ALICE);
    const bob = await as(BOB);

    const up = await api.put(vote, { as: alice, body: '{"value":"up"}' });
    expect(up.status).toBe(200);
    expect(up.text).toBe('{"upCount":1,"downCount":0,"myVote":"UP"}');
    expect((await api.put(vote, { as: bob, body: '{"value":"UP"}' })).json.upCount).toBe(2);
    const down = await api.put(vote, { as: alice, body: '{"value":"DOWN"}' });
    expect(down.json.upCount).toBe(1);
    expect(down.json.downCount).toBe(1);
    expect((await api.put(vote, { as: alice, body: '{"value":"sideways"}' })).status).toBe(400);

    const got = await api.get(`/v1/proposals/${id}`, { as: alice });
    expect(got.json.upCount).toBe(1);
    expect(got.json.downCount).toBe(1);
    expect(got.json.myVote).toBe('DOWN');
    expect((await api.get('/v1/proposals', { as: bob })).json.data[0].myVote).toBe('UP');

    const removed = await api.delete(vote, { as: alice });
    expect(removed.status).toBe(200);
    expect(removed.text).toBe('{"upCount":1,"downCount":0,"myVote":null}');
    expect((await api.delete(vote, { as: alice })).json.upCount).toBe(1);
    // jsonPath doesNotExist() passes on a null value: Java writes "myVote": null.
    expect((await api.get(`/v1/proposals/${id}`, { as: alice })).json.myVote).toBeNull();

    const [{ n }] = await api.db`SELECT count(*)::int AS n FROM public.proposal_vote`;
    expect(n).toBe(1);

    expect((await api.patch(`/v1/staff/proposals/${id}`, { as: await mod(), body: '{"lifecycle":"CERRADO"}' })).status).toBe(200);
    expect((await api.put(vote, { as: alice, body: '{"value":"UP"}' })).status).toBe(409);
    expect((await api.post(`/v1/proposals/${id}/comments`, { as: alice, body: '{"body":"tarde"}' })).status).toBe(409);
  });

  test('commentsArePseudonymousStableAndThreaded', async () => {
    const id = await createApproved('Charlable', 'OTROS');
    const url = `/v1/proposals/${id}/comments`;
    const alice = await as(ALICE);
    const bob = await as(BOB);
    const author = await as(AUTHOR);

    const r1 = await api.post(url, { as: alice, body: '{"body":"Primero"}' });
    expect(r1.status).toBe(201);
    expect(r1.json.isMine).toBe(true);
    expect(r1.json.isAuthor).toBe(false);
    const a1 = r1.json;
    const a2 = (await api.post(url, { as: alice, body: '{"body":"Segundo"}' })).json;
    const rop = await api.post(url, { as: author, body: `{"body":"Gracias","parentId":"${a1.id}"}` });
    expect(rop.status).toBe(201);
    expect(rop.json.isAuthor).toBe(true);
    const op = rop.json;

    expect(a2.alias).toBe(a1.alias);
    expect(op.alias).not.toBe(a1.alias);

    // The author's comment alias is the proposal's authorAlias.
    const p = await api.get(`/v1/proposals/${id}`, { as: bob });
    expect(p.json.authorAlias).toBe(op.alias);
    expect(p.json.commentCount).toBe(3);

    // Replying to a reply is refused.
    expect((await api.post(url, { as: bob, body: `{"body":"x","parentId":"${op.id}"}` })).status).toBe(400);

    const asBob = await api.get(url, { as: bob });
    expect(asBob.status).toBe(200);
    expect(asBob.json.meta.total).toBe(2);
    expect(asBob.json.data[0].body).toBe('Segundo');
    expect(asBob.json.data[0].isMine).toBe(false);
    expect(asBob.json.data[1].body).toBe('Primero');
    expect(asBob.json.data[1].replies).toHaveLength(1);
    expect(asBob.json.data[1].replies[0].isAuthor).toBe(true);
    expect(asBob.json.data[1].replies[0].alias).toBe(op.alias);
    assertAnonymous(asBob.text);
    expect((await api.get(url, { as: alice })).json.data[0].isMine).toBe(true);

    // Only the writer can delete; a deleted comment with replies stays as a tombstone.
    const first = a1.id as string;
    expect((await api.delete(`${url}/${first}`, { as: bob })).status).toBe(404);
    expect((await api.delete(`${url}/${first}`, { as: alice })).status).toBe(204);
    expect((await api.delete(`${url}/${a2.id}`, { as: alice })).status).toBe(204);

    const after = await api.get(url, { as: bob });
    expect(after.json.meta.total).toBe(1);
    expect(after.json.data[0].id).toBe(first);
    expect(after.json.data[0].deleted).toBe(true);
    expect(after.json.data[0].body).toBeNull();
    expect(after.json.data[0].alias).toBeNull();
    expect(after.json.data[0].replies).toHaveLength(1);
    expect((await api.get(`/v1/proposals/${id}`, { as: bob })).json.commentCount).toBe(1);
  });

  test.skipIf(!hasAccountDeletion)('accountDeletionUndoesVotesAndTombstonesComments', async () => {
    const id = await createApproved('Sobreviviente', 'OTROS');
    const alice = await as(ALICE);
    const bob = await as(BOB);
    expect((await api.put(`/v1/proposals/${id}/vote`, { as: alice, body: '{"value":"UP"}' })).status).toBe(200);
    expect((await api.put(`/v1/proposals/${id}/vote`, { as: bob, body: '{"value":"DOWN"}' })).status).toBe(200);
    expect((await api.post(`/v1/proposals/${id}/comments`, { as: alice, body: '{"body":"Chau"}' })).status).toBe(201);
    const pending = await create(ALICE, 'Mía pendiente', 'OTROS');

    const del = await api.delete('/v1/me', { as: alice });
    expect(del.status).toBeGreaterThanOrEqual(200);
    expect(del.status).toBeLessThan(300);

    const p = await api.get(`/v1/proposals/${id}`, { as: bob });
    expect(p.json.upCount).toBe(0);
    expect(p.json.downCount).toBe(1);
    expect(p.json.commentCount).toBe(0);
    expect((await api.get(`/v1/proposals/${id}/comments`, { as: bob })).json.data).toHaveLength(0);
    const [{ n }] = await api.db`SELECT count(*)::int AS n FROM public.proposal WHERE id = ${pending}::uuid`;
    expect(n).toBe(0);

    // The author deleting their account keeps the approved proposal, detached.
    const delAuthor = await api.delete('/v1/me', { as: await as(AUTHOR) });
    expect(delAuthor.status).toBeGreaterThanOrEqual(200);
    expect(delAuthor.status).toBeLessThan(300);
    const detached = await api.get(`/v1/proposals/${id}`, { as: bob });
    expect(detached.status).toBe(200);
    expect(detached.json.authorAlias).toBeNull();
  });
});

// Not in the IT: response shapes (record order, nulls, which timestamps are
// read back from the database and which are computed in memory), error
// bodies, attachment keys and the sign-upload endpoint.
describe('ProposalController shapes', () => {
  beforeEach(async () => {
    await truncateUsers(api.db);
    people = [];
    for (const email of [AUTHOR, ALICE, BOB, MOD]) {
      ids[email] = await seedUser(api.db, email, { name: NAMES[email]! });
      people.push({ id: ids[email]!, email, name: NAMES[email]! });
    }
    await seedModerator(api.db, ids[MOD]!);
  });

  test('proposalAndCommentShapes', async () => {
    const author = await as(AUTHOR);
    const created = await api.post('/v1/proposals', { as: author, body: { title: '  Título  ', description: ' Desc ', topic: ' cursos ' } });
    expect(created.status).toBe(201);
    expect(Object.keys(created.json)).toEqual(PROPOSAL_KEYS);
    expect(created.json).toMatchObject({ title: 'Título', description: 'Desc', topic: 'CURSOS', status: 'PENDING', lifecycle: 'ABIERTO',
      rejectionReason: null, attachments: [], upCount: 0, downCount: 0, commentCount: 0, myVote: null, isMine: true, moderatedAt: null });
    // @CreationTimestamp on the in-memory entity: the JVM zone.
    expect(created.json.createdAt).toMatch(ART);
    const id = created.json.id as string;

    const fetched = await api.get(`/v1/proposals/${id}`, { as: author });
    expect(fetched.json.createdAt).toMatch(UTC);
    expect(fetched.json.authorAlias).toBe(created.json.authorAlias);

    const approved = await api.post(`/v1/staff/proposals/${id}/approve`, { as: await mod() });
    expect(Object.keys(approved.json)).toEqual(PROPOSAL_KEYS);
    expect(approved.json.isMine).toBe(false);
    expect(approved.json.createdAt).toMatch(UTC);
    // OffsetDateTime.now(clock): ART.
    expect(approved.json.moderatedAt).toMatch(ART);
    expect((await api.get(`/v1/proposals/${id}`, { as: author })).json.moderatedAt).toMatch(UTC);

    const c = await api.post(`/v1/proposals/${id}/comments`, { as: await as(ALICE), body: { body: '  Hola  ' } });
    expect(c.status).toBe(201);
    expect(Object.keys(c.json)).toEqual(COMMENT_KEYS);
    expect(c.json).toMatchObject({ parentId: null, isMine: true, isAuthor: false, body: 'Hola', deleted: false, replies: [] });
    expect(c.json.createdAt).toMatch(ART);

    const list = await api.get(`/v1/proposals/${id}/comments`, { as: await as(BOB) });
    expect(Object.keys(list.json)).toEqual(['data', 'meta']);
    expect(Object.keys(list.json.data[0])).toEqual(COMMENT_KEYS);
    expect(list.json.data[0].createdAt).toMatch(UTC);
    expect(list.json.data[0].isMine).toBe(false);
  });

  test('errorBodies', async () => {
    const author = await as(AUTHOR);
    const id = await create(AUTHOR, 'Algo', 'OTROS');
    const missing = crypto.randomUUID();

    const nf = await api.get(`/v1/proposals/${missing}`, { as: author });
    expect(nf.status).toBe(404);
    expect(nf.json).toMatchObject({ error: 'ResourceNotFound', message: `Proposal with identifier '${missing}' not found`, path: `/api/v1/proposals/${missing}` });

    const conflict = await api.put(`/v1/proposals/${id}/vote`, { as: author, body: { value: 'UP' } });
    expect(conflict.status).toBe(409);
    expect(conflict.json).toMatchObject({ error: 'InvalidState', message: 'Proposal is not approved yet' });

    const blank = await api.post('/v1/proposals', { as: author, body: { title: ' ', description: 'd', topic: 'OTROS' } });
    expect(blank.json).toMatchObject({ error: 'ValidationError', message: 'title: must not be blank' });
    const twoLines = await api.post('/v1/proposals', { as: author, body: { title: 'a\nb', description: 'd', topic: 'OTROS' } });
    expect(twoLines.json).toMatchObject({ error: 'ValidationError', message: 'title: must be a single line' });
    const noTopic = await api.post('/v1/proposals', { as: author, body: { title: 't', description: 'd' } });
    expect(noTopic.json).toMatchObject({ error: 'ValidationError', message: 'topic: must not be null' });
    const tooMany = await api.post('/v1/proposals', { as: author, body: { title: 't', description: 'd', topic: 'OTROS', attachmentKeys: ['a', 'b', 'c', 'd', 'e', 'f'] } });
    expect(tooMany.json).toMatchObject({ error: 'ValidationError', message: 'attachmentKeys: size must be between 0 and 5' });
    const blankKey = await api.post('/v1/proposals', { as: author, body: { title: 't', description: 'd', topic: 'OTROS', attachmentKeys: [' '] } });
    expect(blankKey.json).toMatchObject({ error: 'ValidationError', message: 'attachmentKeys[0]: must not be blank' });
    for (const topic of ['', 0, 'DEPORTES', true, {}]) {
      const r = await api.post('/v1/proposals', { as: author, body: { title: 't', description: 'd', topic } });
      expect(r.status).toBe(400);
      expect(r.json).toMatchObject({ error: 'BadRequest', message: 'Malformed or invalid request body' });
    }

    const badId = await api.get('/v1/proposals/not-a-uuid', { as: author });
    expect(badId.status).toBe(400);
    expect(badId.json.error).toBe('BadRequest');
    expect(badId.json.message).toBe("Method parameter 'id': Failed to convert value of type 'java.lang.String' to required type 'java.util.UUID'; Invalid UUID string: not-a-uuid");

    const badParent = await createApproved('Abierta', 'OTROS');
    const ghost = crypto.randomUUID();
    const reply = await api.post(`/v1/proposals/${badParent}/comments`, { as: author, body: { body: 'x', parentId: ghost } });
    expect(reply.status).toBe(400);
    expect(reply.json).toMatchObject({ error: 'ValidationError', message: `Validation failed for field 'parentId' with value '${ghost}': no such comment on this proposal` });
    const longBody = await api.post(`/v1/proposals/${badParent}/comments`, { as: author, body: { body: 'x'.repeat(1001) } });
    expect(longBody.json).toMatchObject({ error: 'ValidationError', message: 'body: size must be between 0 and 1000' });

    const ghostComment = await api.delete(`/v1/proposals/${badParent}/comments/${ghost}`, { as: author });
    expect(ghostComment.status).toBe(404);
    expect(ghostComment.json.message).toBe(`ProposalComment with identifier '${ghost}' not found`);
  });

  test('pagingIsClampedAndTopicOptional', async () => {
    await createApproved('Una', 'OTROS');
    const bob = await as(BOB);
    const big = await api.get('/v1/proposals?page=0&limit=500', { as: bob });
    expect(big.json.meta).toEqual({ total: 1, page: 1, limit: 50 });
    const small = await api.get('/v1/proposals?page=-2&limit=0&topic=', { as: bob });
    expect(small.status).toBe(200);
    expect(small.json.meta).toEqual({ total: 1, page: 1, limit: 1 });
    const beyond = await api.get('/v1/proposals?page=5&limit=1', { as: bob });
    expect(beyond.json).toEqual({ data: [], meta: { total: 1, page: 5, limit: 1 } });
    const lower = await api.get('/v1/proposals?topic=otros', { as: bob });
    expect(lower.status).toBe(400);
    const badPage = await api.get('/v1/proposals?page=x', { as: bob });
    expect(badPage.status).toBe(400);
    expect(badPage.json.message).toBe("Method parameter 'page': Failed to convert value of type 'java.lang.String' to required type 'int'; For input string: \"x\"");
  });

  test('attachmentKeysAreOwnedUniqueAndListed', async () => {
    // Keys as MediaUploadService.signProposalAttachment builds them for the author (the test JWT secret).
    const media = new MediaUploadService(new UnconfiguredObjectStorage(), () => {}, ContentHmac.fromJwtSecret(TEST_JWT_SECRET));
    const keyFor = (userId: string, ext: string) => {
      const u = crypto.randomUUID();
      return `proposals/${u}-${media.tagOf(userId, u)}.${ext}`;
    };
    const author = await as(AUTHOR);
    const png = keyFor(ids[AUTHOR]!, 'png');
    const pdf = keyFor(ids[AUTHOR]!, 'pdf');
    const r = await api.post('/v1/proposals', { as: author, body: { title: 't', description: 'd', topic: 'OTROS', attachmentKeys: [png, pdf] } });
    expect(r.status).toBe(201);
    // No storage configured: url is null.
    expect(JSON.stringify(r.json.attachments)).toBe('[{"position":0,"url":null,"contentType":"image/png"},{"position":1,"url":null,"contentType":"application/pdf"}]');

    const reused = await api.post('/v1/proposals', { as: author, body: { title: 't', description: 'd', topic: 'OTROS', attachmentKeys: [png] } });
    expect(reused.status).toBe(400);
    expect(reused.json.message).toBe(`Validation failed for field 'attachmentKeys' with value '[${png}]': attachment already used by another proposal`);
    const fresh = keyFor(ids[AUTHOR]!, 'webp');
    const dup = await api.post('/v1/proposals', { as: author, body: { title: 't', description: 'd', topic: 'OTROS', attachmentKeys: [fresh, fresh] } });
    expect(dup.json.message).toBe(`Validation failed for field 'attachmentKeys' with value '[${fresh}, ${fresh}]': duplicate keys`);
    const alicesKey = keyFor(ids[ALICE]!, 'jpg');
    const foreign = await api.post('/v1/proposals', { as: author, body: { title: 't', description: 'd', topic: 'OTROS', attachmentKeys: [alicesKey] } });
    expect(foreign.json.message).toBe(`Validation failed for field 'attachmentKeys' with value '${alicesKey}': not an attachment key signed for this user`);
  });

  test('signUploadValidatesThenNeedsStorage', async () => {
    const url = '/v1/proposals/attachments/sign-upload';
    expect((await api.post(url, { body: { filename: 'a.png', contentType: 'image/png', sizeBytes: 10 } })).status).toBe(401);
    const alice = await as(ALICE);
    const badType = await api.post(url, { as: alice, body: { filename: 'a.gif', contentType: 'image/gif', sizeBytes: 10 } });
    expect(badType.status).toBe(400);
    expect(badType.json).toMatchObject({ error: 'ValidationError',
      message: "Validation failed for field 'contentType' with value 'image/gif': unsupported content type. Allowed: application/pdf, image/jpeg, image/png, image/webp" });
    const tooBig = await api.post(url, { as: alice, body: { filename: 'a.pdf', contentType: 'application/pdf', sizeBytes: 10 * 1024 * 1024 + 1 } });
    expect(tooBig.json.message).toBe("Validation failed for field 'sizeBytes' with value '10485761': file too large. Maximum size for application/pdf is 10 MB");
    const zero = await api.post(url, { as: alice, body: { filename: 'a.png', contentType: 'image/png' } });
    expect(zero.json).toMatchObject({ error: 'ValidationError', message: 'sizeBytes: must be greater than 0' });
    const blank = await api.post(url, { as: alice, body: { filename: ' ', contentType: 'image/png', sizeBytes: 1 } });
    expect(blank.json).toMatchObject({ error: 'ValidationError', message: 'filename: must not be blank' });
    const ok = await api.post(url, { as: alice, body: { filename: 'a.png', contentType: 'Image/PNG; charset=x', sizeBytes: 10 } });
    expect(ok.status).toBe(501);
    expect(ok.json).toMatchObject({ error: 'NotImplemented',
      message: 'Object storage not configured. Set STORAGE_ENDPOINT, STORAGE_BUCKET, STORAGE_ACCESS_KEY_ID, STORAGE_SECRET_ACCESS_KEY and STORAGE_PUBLIC_URL.' });
  });
});
