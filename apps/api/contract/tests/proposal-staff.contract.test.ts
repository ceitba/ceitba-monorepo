// Ports apps/api/src/test/java/org/ceitba/api/web/proposal/StaffProposalControllerIT.java.
// The moderator is a real ceitba_moderators grant without STAFF (seedModerator).
// The IT's @RecordApplicationEvents assertions (ProposalStatusChangedEvent)
// cannot be seen black-box: they are ported in-process in
// test/proposal/StaffProposalEvents.test.ts with the same test names.
import { beforeEach, describe, expect, test } from 'bun:test';
import { bearer, mintJwt, seedModerator, seedUser, supports, truncateUsers, useServer, type As } from '../support';

const api = useServer();
const hasModeratorList = await supports('GET /v1/staff/moderators');

const AUTHOR = 'autor@itba.edu.ar';
const USER = 'user@itba.edu.ar';
const MOD = 'mod@itba.edu.ar';

let authorId = '';
let modId = '';

const as = async (email: string): Promise<As> => bearer(await mintJwt({ email, name: email }));
const user = () => as(USER);
const mod = () => as(MOD);

async function create(title: string): Promise<string> {
  const r = await api.post('/v1/proposals', { as: await as(AUTHOR), body: `{"title":"${title}","description":"d","topic":"CEITBA"}` });
  expect(r.status).toBe(201);
  return r.json.id;
}

describe('StaffProposalControllerIT', () => {
  beforeEach(async () => {
    await truncateUsers(api.db);
    authorId = await seedUser(api.db, AUTHOR, { name: 'Autor' });
    modId = await seedUser(api.db, MOD, { name: 'Moderador' });
    await seedModerator(api.db, modId);
  });

  test('plainUserGets403Everywhere', async () => {
    const id = await create('Algo');
    const u = await user();
    expect((await api.get('/v1/staff/proposals', { as: u })).status).toBe(403);
    expect((await api.post(`/v1/staff/proposals/${id}/approve`, { as: u })).status).toBe(403);
    expect((await api.post(`/v1/staff/proposals/${id}/reject`, { as: u, body: '{"reason":"no"}' })).status).toBe(403);
    expect((await api.patch(`/v1/staff/proposals/${id}`, { as: u, body: '{"lifecycle":"CERRADO"}' })).status).toBe(403);
    expect((await api.delete(`/v1/staff/proposals/${id}/comments/${crypto.randomUUID()}`, { as: u })).status).toBe(403);
    expect((await api.get('/v1/staff/proposals')).status).toBe(401);

    const [row] = await api.db`SELECT status FROM public.proposal WHERE id = ${id}::uuid`;
    expect(row!.status).toBe('PENDING');
  });

  test('moderatorOutsideTheAllowlistIsRejected', async () => {
    // A real moderator grant, so the 403 comes from the allowlist and not from the role.
    const outsider = await seedUser(api.db, 'mod@gmail.com', { name: 'mod@gmail.com' });
    await seedModerator(api.db, outsider);
    expect((await api.get('/v1/staff/proposals', { as: await as('mod@gmail.com') })).status).toBe(403);
  });

  test.skipIf(!hasModeratorList)('moderatorIsNotStaffElsewhere', async () => {
    expect((await api.get('/v1/staff/moderators', { as: await mod() })).status).toBe(403);
  });

  test('moderatorWorksTheQueueOldestFirst', async () => {
    const first = await create('Primera');
    const second = await create('Segunda');
    const m = await mod();

    const queue = await api.get('/v1/staff/proposals', { as: m });
    expect(queue.status).toBe(200);
    expect(queue.json.meta.total).toBe(2);
    expect(queue.json.data[0].id).toBe(first);
    expect(queue.json.data[1].id).toBe(second);
    expect(queue.text).not.toContain(authorId);
    expect(queue.text).not.toContain(AUTHOR);

    const approved = await api.post(`/v1/staff/proposals/${first}/approve`, { as: m });
    expect(approved.status).toBe(200);
    expect(approved.json.status).toBe('APPROVED');
    expect(typeof approved.json.moderatedAt).toBe('string');
    const again = await api.post(`/v1/staff/proposals/${first}/approve`, { as: m });
    expect(again.status).toBe(409);
    expect(again.json.error).toBe('InvalidState');
    expect(again.json.message).toBe('Proposal is already APPROVED');

    const noReason = await api.post(`/v1/staff/proposals/${second}/reject`, { as: m, body: '{}' });
    expect(noReason.status).toBe(400);
    expect(noReason.json).toMatchObject({ error: 'ValidationError', message: 'reason: must not be blank' });
    const rejected = await api.post(`/v1/staff/proposals/${second}/reject`, { as: m, body: '{"reason":"Duplicada"}' });
    expect(rejected.status).toBe(200);
    expect(rejected.json.status).toBe('REJECTED');
    expect(rejected.json.rejectionReason).toBe('Duplicada');

    expect((await api.get('/v1/staff/proposals', { as: m })).json.data).toHaveLength(0);
    expect((await api.get('/v1/staff/proposals?status=REJECTED', { as: m })).json.data[0].id).toBe(second);
    const nope = await api.get('/v1/staff/proposals?status=NOPE', { as: m });
    expect(nope.status).toBe(400);
    expect(nope.json.message).toBe("Method parameter 'status': Failed to convert value of type 'java.lang.String' to required type "
      + "'org.ceitba.api.domain.ProposalStatus'; Failed to convert from type [java.lang.String] to type "
      + '[@org.springframework.web.bind.annotation.RequestParam org.ceitba.api.domain.ProposalStatus] for value [NOPE]');

    // The author sees the reason; the moderator id is recorded but never shown.
    expect((await api.get('/v1/me/proposals', { as: await as(AUTHOR) })).json.data[0].rejectionReason).toBe('Duplicada');
    const [row] = await api.db`SELECT moderated_by FROM public.proposal WHERE id = ${second}::uuid`;
    expect(row!.moderated_by).toBe(modId);
    // The ProposalStatusChangedEvent assertions: test/proposal/StaffProposalEvents.test.ts.
  });

  test('lifecycleAndCommentModeration', async () => {
    const id = await create('Con ciclo');
    const m = await mod();
    const early = await api.patch(`/v1/staff/proposals/${id}`, { as: m, body: '{"lifecycle":"ACEPTADO"}' });
    expect(early.status).toBe(409);
    expect(early.json.message).toBe('Only approved proposals have a lifecycle');

    expect((await api.post(`/v1/staff/proposals/${id}/approve`, { as: m })).status).toBe(200);
    const accepted = await api.patch(`/v1/staff/proposals/${id}`, { as: m, body: '{"lifecycle":"aceptado"}' });
    expect(accepted.status).toBe(200);
    expect(accepted.json.lifecycle).toBe('ACEPTADO');
    expect((await api.patch(`/v1/staff/proposals/${id}`, { as: m, body: '{"lifecycle":"INVALIDO"}' })).status).toBe(400);

    const c = await api.post(`/v1/proposals/${id}/comments`, { as: await user(), body: '{"body":"spam"}' });
    expect(c.status).toBe(201);
    const comment = c.json.id as string;

    const del = await api.delete(`/v1/staff/proposals/${id}/comments/${comment}`, { as: m });
    expect(del.status).toBe(204);
    expect(del.text).toBe('');
    // Deleting it again is a no-op, not a second decrement.
    expect((await api.delete(`/v1/staff/proposals/${id}/comments/${comment}`, { as: m })).status).toBe(204);
    const ghost = crypto.randomUUID();
    const missing = await api.delete(`/v1/staff/proposals/${id}/comments/${ghost}`, { as: m });
    expect(missing.status).toBe(404);
    expect(missing.json.message).toBe(`ProposalComment with identifier '${ghost}' not found`);
    const p = await api.get(`/v1/proposals/${id}`, { as: await user() });
    expect(p.json.commentCount).toBe(0);
    expect(p.json.lifecycle).toBe('ACEPTADO');
    // The ProposalStatusChangedEvent assertions: test/proposal/StaffProposalEvents.test.ts.
  });

  test('unknownProposalIs404', async () => {
    const ghost = crypto.randomUUID();
    const r = await api.post(`/v1/staff/proposals/${ghost}/approve`, { as: await mod() });
    expect(r.status).toBe(404);
    expect(r.json).toMatchObject({ error: 'ResourceNotFound', message: `Proposal with identifier '${ghost}' not found` });
  });

  // Not in the IT: reject/take-down states, paging meta, the moderator view.
  test('rejectTakesDownApprovedAndRefusesTwice', async () => {
    const id = await create('Bajar');
    const m = await mod();
    expect((await api.post(`/v1/staff/proposals/${id}/approve`, { as: m })).status).toBe(200);
    const down = await api.post(`/v1/staff/proposals/${id}/reject`, { as: m, body: { reason: '  Spam  ' } });
    expect(down.status).toBe(200);
    expect(down.json).toMatchObject({ status: 'REJECTED', rejectionReason: 'Spam', isMine: false });
    const twice = await api.post(`/v1/staff/proposals/${id}/reject`, { as: m, body: { reason: 'x' } });
    expect(twice.status).toBe(409);
    expect(twice.json.message).toBe('Proposal is already REJECTED');
    const approve = await api.post(`/v1/staff/proposals/${id}/approve`, { as: m });
    expect(approve.json.message).toBe('Proposal is already REJECTED');
    const long = await api.post(`/v1/staff/proposals/${id}/reject`, { as: m, body: { reason: 'x'.repeat(1025) } });
    expect(long.json).toMatchObject({ error: 'ValidationError', message: 'reason: size must be between 0 and 1024' });
    const nullLifecycle = await api.patch(`/v1/staff/proposals/${id}`, { as: m, body: {} });
    expect(nullLifecycle.json).toMatchObject({ error: 'ValidationError', message: 'lifecycle: must not be null' });

    // Moderators see a rejected proposal (and its reason) everywhere.
    const got = await api.get(`/v1/proposals/${id}`, { as: m });
    expect(got.status).toBe(200);
    expect(got.json.rejectionReason).toBe('Spam');
    const other = await api.get(`/v1/proposals/${id}`, { as: await user() });
    expect(other.status).toBe(404);

    const rejected = await api.get('/v1/staff/proposals?status=REJECTED&limit=100&page=0', { as: m });
    expect(rejected.json.meta).toEqual({ total: 1, page: 1, limit: 50 });
    expect(rejected.json.data[0].rejectionReason).toBe('Spam');
    const def = await api.get('/v1/staff/proposals?status=', { as: m });
    expect(def.status).toBe(200);
    expect(def.json.meta.total).toBe(0);
  });
});
