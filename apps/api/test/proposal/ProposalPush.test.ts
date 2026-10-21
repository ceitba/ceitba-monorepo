// In-process port of apps/api/src/test/java/org/ceitba/api/web/proposal/ProposalPushIT.java:
// moderation -> ProposalStatusChangedEvent -> push to the author's devices,
// after commit, through the real delivery path (firePushes) against
// FakePushGateway. AsyncWork.awaitIdle = pendingPushes().
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mintJwt, seedModerator, seedUser } from '../../contract/support';
import { pendingPushes } from '../../src/features/news/pushTriggers';
import { FakePushGateway } from '../../src/infra/push';
import { testApp, type TestApp } from '../support/app';

const AUTHOR = 'autor@itba.edu.ar';
const OTHER = 'otro@itba.edu.ar';
const MOD = 'mod@itba.edu.ar';

let t: TestApp;
const gateway = new FakePushGateway();

beforeAll(async () => {
  t = await testApp({ overrides: { push: gateway } });
}, 60_000);
afterAll(() => t?.close());

const auth = async (email: string) => ({ Authorization: `Bearer ${(await mintJwt({ email, name: email }))}` });

async function create(title: string): Promise<string> {
  const r = await t.request('POST', '/v1/proposals', { headers: await auth(AUTHOR), body: `{"title":"${title}","description":"d","topic":"CEITBA"}` });
  expect(r.status).toBe(201);
  return r.json.id;
}

const approve = async (id: string) => t.request('POST', `/v1/staff/proposals/${id}/approve`, { headers: await auth(MOD) });
const patch = async (id: string, body: string) => t.request('PATCH', `/v1/staff/proposals/${id}`, { headers: await auth(MOD), body });

/** await().atMost(10s).until(calls >= n) */
async function awaitCalls(n: number) {
  const deadline = Date.now() + 10_000;
  while (gateway.calls.length < n) {
    if (Date.now() > deadline) throw new Error(`expected ${n} push calls, got ${gateway.calls.length}`);
    await pendingPushes();
    await Bun.sleep(10);
  }
}

async function assertCallsStay(n: number) {
  await pendingPushes();
  expect(gateway.calls).toHaveLength(n);
}

describe('ProposalPushIT', () => {
  beforeEach(async () => {
    await t.sql`TRUNCATE public."user" CASCADE`;
    const author = await seedUser(t.sql, AUTHOR, { name: 'Autor' });
    const other = await seedUser(t.sql, OTHER, { name: 'Otro' });
    const mod = await seedUser(t.sql, MOD, { name: 'Moderador' });
    await seedModerator(t.sql, mod);
    for (const [token, u] of [['author-phone', author], ['author-tablet', author], ['other-phone', other]] as const) {
      await t.sql`INSERT INTO public.user_devices (token, user_id, platform) VALUES (${token}, ${u}, 'ios')`;
    }
    await pendingPushes();
    gateway.calls.length = 0;
  });

  test('creatingAProposalDoesNotPush', async () => {
    await create('Más microondas');
    await assertCallsStay(0);
  });

  test('approvalPushesToTheAuthorsDevicesOnly', async () => {
    const id = await create('Más microondas');
    expect((await approve(id)).status).toBe(200);

    await awaitCalls(1);
    const call = gateway.calls[0]!;
    expect([...call.tokens].sort()).toEqual(['author-phone', 'author-tablet']);
    expect(call.message.title).toBe('Tu propuesta fue aprobada');
    expect(call.message.body).toBe('Más microondas');
    expect(call.message.data).toMatchObject({ type: 'proposal', id });
    await assertCallsStay(1);
  });

  test('rejectionAndLifecycleChangesPushAndNoOpsDoNot', async () => {
    const id = await create('Bicicleteros');
    expect((await approve(id)).status).toBe(200);
    await awaitCalls(1);

    expect((await patch(id, '{"lifecycle":"ACEPTADO"}')).status).toBe(200);
    await awaitCalls(2);
    expect(gateway.calls[1]!.message.title).toBe('Tu propuesta fue aceptada');

    // Same lifecycle again: no event, no push.
    expect((await patch(id, '{"lifecycle":"ACEPTADO"}')).status).toBe(200);
    await assertCallsStay(2);

    const r = await t.request('POST', `/v1/staff/proposals/${id}/reject`, { headers: await auth(MOD), body: '{"reason":"duplicada"}' });
    expect(r.status).toBe(200);
    await awaitCalls(3);
    expect(gateway.calls[2]!.message.title).toBe('Tu propuesta fue rechazada');
    expect([...gateway.calls[2]!.tokens].sort()).toEqual(['author-phone', 'author-tablet']);
  });

  test('aFailedModerationSendsNothing', async () => {
    const id = await create('Algo');
    expect((await approve(id)).status).toBe(200);
    await awaitCalls(1);

    // Approving twice is a 409: the transaction rolls back, nothing is sent.
    expect((await approve(id)).status).toBe(409);
    await assertCallsStay(1);
  });

  test('aProposalWhoseAuthorDeletedTheirAccountDoesNotPush', async () => {
    const id = await create('Huérfana');
    await t.sql`UPDATE public.proposal SET author_id = NULL WHERE id = ${id}::uuid`;

    expect((await approve(id)).status).toBe(200);
    await assertCallsStay(0);
  });

  // Not in the IT: PushTriggerListener records every delivery in push_log.
  test('deliveriesAreLogged', async () => {
    const id = await create('Con registro');
    expect((await approve(id)).status).toBe(200);
    await awaitCalls(1);
    await pendingPushes();
    const rows = await t.sql`SELECT org_slug, kind, ref_id, targeted, sent FROM public.push_log WHERE ref_id = ${id}`;
    expect(rows.map((r) => ({ ...r }))).toEqual([{ org_slug: null, kind: 'proposal', ref_id: id, targeted: 2, sent: 2 }]);
  });
});
