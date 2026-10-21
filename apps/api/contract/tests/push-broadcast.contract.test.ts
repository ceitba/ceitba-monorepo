// Ports apps/api/src/test/java/org/ceitba/api/web/staff/PushBroadcastIT.java
// (HTTP side). The IT injects a FakePushGateway to assert the tokens and
// message: that part is in-process in test/push/push-broadcast.test.ts. Black
// box, FCM is not configured (NoOp service), and PushTriggerListener still
// records the fan-out in push_log (0 targeted / 0 sent), which is what these
// tests observe; "nothing sent" = no push_log row after a grace period.
import { beforeEach, describe, expect, test } from 'bun:test';
import { bearer, mintJwt, seedStaff, seedUser, useServer } from '../support';

const api = useServer();
const BODY = '{"title":"CEITBA","body":"Mañana no hay clases","data":{"type":"announcement","id":"42"}}\n';

const staff = async () => {
  await seedStaff(api.db, 'boss@itba.edu.ar');
  return bearer(await mintJwt({ email: 'boss@itba.edu.ar', name: 'Boss' }));
};
const user = async () => bearer(await mintJwt({ email: 'alice@itba.edu.ar', name: 'Alice' }));
const pushLog = () => api.db`SELECT org_slug, kind, ref_id, targeted, sent FROM public.push_log`;

async function assertNothingSent() {
  await Bun.sleep(500);
  expect(await pushLog()).toHaveLength(0);
}

describe('PushBroadcastIT', () => {
  beforeEach(async () => {
    await api.db`TRUNCATE public."user", public.push_log CASCADE`;
    const alice = await seedUser(api.db, 'alice@itba.edu.ar', { name: 'Alice' });
    const bob = await seedUser(api.db, 'bob@itba.edu.ar', { name: 'Bob' });
    await api.db`INSERT INTO public.user_devices (token, user_id, platform) VALUES ('a-1', ${alice}, 'ios')`;
    await api.db`INSERT INTO public.user_devices (token, user_id, platform) VALUES ('b-1', ${bob}, 'android')`;
  });

  test('anonymousIsUnauthorized', async () => {
    expect((await api.post('/v1/staff/push/broadcast', { body: BODY })).status).toBe(401);
    await assertNothingSent();
  });

  test('regularUserIsForbidden', async () => {
    expect((await api.post('/v1/staff/push/broadcast', { as: await user(), body: BODY })).status).toBe(403);
    await assertNothingSent();
  });

  test('staffBroadcastReachesEveryDevice', async () => {
    const r = await api.post('/v1/staff/push/broadcast', { as: await staff(), body: BODY });
    expect(r.status).toBe(202);
    expect(r.text).toBe('');
    // Delivery is asynchronous; with FCM unconfigured the reach is 0/0, but the fan-out is logged.
    let rows: unknown[] = [];
    for (let i = 0; i < 100 && rows.length === 0; i++) {
      rows = await pushLog();
      if (rows.length === 0) await Bun.sleep(100);
    }
    expect(rows).toEqual([{ org_slug: null, kind: 'announcement', ref_id: '42', targeted: 0, sent: 0 }]);
  });

  test('invalidBroadcastsAreRejected', async () => {
    const s = await staff();
    const cases: [string, string][] = [
      ['{"title":" ","body":"b"}', 'title: must not be blank'],
      ['{"title":"t"}', 'body: must not be blank'],
      [`{"title":"t","body":"${'x'.repeat(1001)}"}`, 'body: size must be between 0 and 1000'],
      ['{"title":"t","body":"b","data":{"from":"x"}}', "Validation failed for field 'data' with value 'from': reserved by FCM"],
      ['{"title":"t","body":"b","data":{"google.x":"x"}}', "Validation failed for field 'data' with value 'google.x': reserved by FCM"],
      [`{"title":"t","body":"b","data":{"k":"${'v'.repeat(201)}"}}`, "Validation failed for field 'data.k' with value '201 characters': values must be at most 200 characters"],
      [`{"title":"t","body":"b","data":${JSON.stringify(Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, 'v'])))}}`, 'data: size must be between 0 and 10'],
    ];
    for (const [body, message] of cases) {
      const r = await api.post('/v1/staff/push/broadcast', { as: s, body });
      expect(r.status).toBe(400);
      expect(r.json.message).toBe(message);
    }
    await assertNothingSent();
  });
});
