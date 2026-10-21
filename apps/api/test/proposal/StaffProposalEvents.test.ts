// In-process part of apps/api/src/test/java/org/ceitba/api/web/proposal/StaffProposalControllerIT.java:
// its @RecordApplicationEvents assertions on ProposalStatusChangedEvent, which
// a black-box server cannot expose. The HTTP assertions of the same tests are
// in contract/tests/proposal-staff.contract.test.ts. ApplicationEvents =
// onProposalStatusChanged (the listener registry the moderation service publishes to).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mintJwt, seedModerator, seedUser } from '../../contract/support';
import { onProposalStatusChanged, type ProposalStatusChangedEvent } from '../../src/features/proposal/events';
import { testApp, type TestApp } from '../support/app';

const AUTHOR = 'autor@itba.edu.ar';
const USER = 'user@itba.edu.ar';
const MOD = 'mod@itba.edu.ar';

let t: TestApp;
let authorId = '';
let events: ProposalStatusChangedEvent[] = [];
let unsubscribe = () => {};

beforeAll(async () => { t = await testApp(); }, 60_000);
afterAll(() => t?.close());

const auth = async (email: string) => ({ Authorization: `Bearer ${await mintJwt({ email, name: email })}` });

async function create(title: string): Promise<string> {
  const r = await t.request('POST', '/v1/proposals', { headers: await auth(AUTHOR), body: `{"title":"${title}","description":"d","topic":"CEITBA"}` });
  expect(r.status).toBe(201);
  return r.json.id;
}

describe('StaffProposalControllerIT (events)', () => {
  beforeEach(async () => {
    await t.sql`TRUNCATE public."user" CASCADE`;
    authorId = await seedUser(t.sql, AUTHOR, { name: 'Autor' });
    await seedModerator(t.sql, await seedUser(t.sql, MOD, { name: 'Moderador' }));
    events = [];
    unsubscribe = onProposalStatusChanged((e) => events.push(e));
  });
  afterEach(() => unsubscribe());

  test('plainUserGets403Everywhere', async () => {
    const id = await create('Algo');
    const u = await auth(USER);
    expect((await t.request('POST', `/v1/staff/proposals/${id}/approve`, { headers: u })).status).toBe(403);
    expect((await t.request('POST', `/v1/staff/proposals/${id}/reject`, { headers: u, body: '{"reason":"no"}' })).status).toBe(403);
    expect((await t.request('PATCH', `/v1/staff/proposals/${id}`, { headers: u, body: '{"lifecycle":"CERRADO"}' })).status).toBe(403);
    expect(events).toEqual([]);
  });

  test('moderatorWorksTheQueueOldestFirst', async () => {
    const first = await create('Primera');
    const second = await create('Segunda');
    const m = await auth(MOD);
    expect((await t.request('POST', `/v1/staff/proposals/${first}/approve`, { headers: m })).status).toBe(200);
    expect((await t.request('POST', `/v1/staff/proposals/${first}/approve`, { headers: m })).status).toBe(409);
    expect((await t.request('POST', `/v1/staff/proposals/${second}/reject`, { headers: m, body: '{}' })).status).toBe(400);
    expect((await t.request('POST', `/v1/staff/proposals/${second}/reject`, { headers: m, body: '{"reason":"Duplicada"}' })).status).toBe(200);

    expect(events).toEqual([
      { proposalId: first, authorId, newStatus: 'APPROVED' },
      { proposalId: second, authorId, newStatus: 'REJECTED' },
    ]);
  });

  test('lifecycleAndCommentModeration', async () => {
    const id = await create('Con ciclo');
    const m = await auth(MOD);
    expect((await t.request('PATCH', `/v1/staff/proposals/${id}`, { headers: m, body: '{"lifecycle":"ACEPTADO"}' })).status).toBe(409);
    expect((await t.request('POST', `/v1/staff/proposals/${id}/approve`, { headers: m })).status).toBe(200);
    expect((await t.request('PATCH', `/v1/staff/proposals/${id}`, { headers: m, body: '{"lifecycle":"aceptado"}' })).status).toBe(200);
    expect((await t.request('PATCH', `/v1/staff/proposals/${id}`, { headers: m, body: '{"lifecycle":"INVALIDO"}' })).status).toBe(400);
    const c = await t.request('POST', `/v1/proposals/${id}/comments`, { headers: await auth(USER), body: '{"body":"spam"}' });
    expect(c.status).toBe(201);
    expect((await t.request('DELETE', `/v1/staff/proposals/${id}/comments/${c.json.id}`, { headers: m })).status).toBe(204);

    expect(events.map((e) => e.newStatus)).toEqual(['APPROVED', 'ACEPTADO']);
  });
});
