// In-process part of apps/api/src/test/java/org/ceitba/api/web/staff/PushBroadcastIT.java
// (@Import(FakePushGatewayConfig)): the real FCM service (recipient resolution,
// batching, pruning) against an in-memory gateway, so the tokens and message
// can be asserted. HTTP status/validation cases are in
// contract/tests/push-broadcast.contract.test.ts.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mintJwt, seedStaff, seedUser } from '../../contract/support/identity';
import { pushIdle } from '../../src/features/push/service';
import { testApp, type TestApp } from '../support/app';
import { FakePushGateway } from './support/FakePushGateway';

const gateway = new FakePushGateway();
let t: TestApp;
beforeAll(async () => { t = await testApp({ overrides: { push: gateway } }); }, 60_000);
afterAll(() => t?.close());

const BODY = { title: 'CEITBA', body: 'Mañana no hay clases', data: { type: 'announcement', id: '42' } };
const auth = async (email: string) => ({ Authorization: `Bearer ${await mintJwt({ email, name: email })}` });

describe('PushBroadcastIT (fake gateway)', () => {
  beforeEach(async () => {
    await t.sql`TRUNCATE public."user", public.push_log CASCADE`;
    gateway.reset();
    const alice = await seedUser(t.sql, 'alice@itba.edu.ar', { name: 'Alice' });
    const bob = await seedUser(t.sql, 'bob@itba.edu.ar', { name: 'Bob' });
    await t.sql`INSERT INTO public.user_devices (token, user_id, platform) VALUES ('a-1', ${alice}, 'ios'), ('b-1', ${bob}, 'android')`;
    await seedStaff(t.sql, 'boss@itba.edu.ar');
  });

  test('staffBroadcastReachesEveryDevice', async () => {
    const r = await t.request('POST', '/v1/staff/push/broadcast', { headers: await auth('boss@itba.edu.ar'), body: BODY });
    expect(r.status).toBe(202);
    await pushIdle();
    const call = gateway.calls[0]!;
    expect([...call.tokens].sort()).toEqual(['a-1', 'b-1']);
    expect(call.message.title).toBe('CEITBA');
    expect(call.message.body).toBe('Mañana no hay clases');
    expect(call.message.data).toEqual({ type: 'announcement', id: '42' });
    expect([...(await t.sql`SELECT org_slug, kind, ref_id, targeted, sent FROM public.push_log`)] as unknown[])
      .toEqual([{ org_slug: null, kind: 'announcement', ref_id: '42', targeted: 2, sent: 2 }]);
  });

  test('regularUserAndInvalidBroadcastsSendNothing', async () => {
    expect((await t.request('POST', '/v1/staff/push/broadcast', { headers: await auth('alice@itba.edu.ar'), body: BODY })).status).toBe(403);
    expect((await t.request('POST', '/v1/staff/push/broadcast', { headers: await auth('boss@itba.edu.ar'), body: { title: 't', body: 'b', data: { from: 'x' } } })).status).toBe(400);
    expect((await t.request('POST', '/v1/staff/push/broadcast', { body: BODY })).status).toBe(401);
    await pushIdle();
    expect(gateway.calls).toHaveLength(0);
  });

  test('deadTokensArePrunedAfterDelivery', async () => {
    gateway.answer('a-1', 'UNREGISTERED');
    expect((await t.request('POST', '/v1/staff/push/broadcast', { headers: await auth('boss@itba.edu.ar'), body: BODY })).status).toBe(202);
    await pushIdle();
    expect((await t.sql`SELECT token FROM public.user_devices`).map((r) => r.token)).toEqual(['b-1']);
    expect((await t.sql`SELECT targeted, sent FROM public.push_log`)[0]).toEqual({ targeted: 2, sent: 1 });
  });
});
