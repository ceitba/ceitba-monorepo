// Ports apps/api/src/test/java/org/ceitba/api/web/user/DeviceIT.java.
// /v1/me/devices: FCM token registry. Upsert keyed by token, reassignment
// between accounts, idempotent delete that never touches other users' rows,
// and the per-user cap.
import { beforeEach, describe, expect, test } from 'bun:test';
import { bearer, mintJwt, seedUser, useServer } from '../support';

const api = useServer();
// Shaped like a real FCM token (instance id ':' base64url payload), PII-free.
const TOKEN = 'fAk3InstanceId:APA91bFakeFcmToken_payload-0123456789';
const MAX_DEVICES_PER_USER = 10;

let aliceId: string;
let bobId: string;
const as = async (email: string, name: string) => bearer(await mintJwt({ email, name }));
const alice = () => as('alice@itba.edu.ar', 'Alice');
const bob = () => as('bob@itba.edu.ar', 'Bob');

async function register(who: 'alice' | 'bob', token: string, platform: string, appVersion: string | null) {
  const version = appVersion === null ? 'null' : `"${appVersion}"`;
  return api.put('/v1/me/devices', { as: await (who === 'alice' ? alice() : bob()), body: `{"token":"${token}","platform":"${platform}","appVersion":${version}}\n` });
}
async function ownerOf(token: string): Promise<string | null> {
  const [r] = await api.db`SELECT user_id FROM public.user_devices WHERE token = ${token}`;
  return (r?.user_id as string) ?? null;
}
async function deviceCount(): Promise<number> {
  const [r] = await api.db`SELECT count(*)::int AS n FROM public.user_devices`;
  return r!.n as number;
}

describe('DeviceIT', () => {
  beforeEach(async () => {
    await api.db`TRUNCATE public."user" CASCADE`;
    aliceId = await seedUser(api.db, 'alice@itba.edu.ar', { name: 'Alice' });
    bobId = await seedUser(api.db, 'bob@itba.edu.ar', { name: 'Bob' });
  });

  test('requiresAuthentication', async () => {
    expect((await api.put('/v1/me/devices', { body: '{"token":"t","platform":"ios"}' })).status).toBe(401);
    expect((await api.delete('/v1/me/devices/t')).status).toBe(401);
  });

  test('registerStoresTheDeviceAndListsIt', async () => {
    const r = await register('alice', TOKEN, 'IOS', '2.0.0');
    expect(r.status).toBe(200);
    expect(r.json.token).toBe(TOKEN);
    expect(r.json.platform).toBe('ios');
    expect(r.json.appVersion).toBe('2.0.0');
    expect(r.json.createdAt).toMatch(/Z$/);
    expect(r.json.lastSeenAt).toBe(r.json.createdAt);
    expect(Object.keys(r.json)).toEqual(['token', 'platform', 'appVersion', 'createdAt', 'lastSeenAt']);

    let l = await api.get('/v1/me/devices', { as: await alice() });
    expect(l.status).toBe(200);
    expect(l.json).toHaveLength(1);
    expect(l.json[0].token).toBe(TOKEN);
    l = await api.get('/v1/me/devices', { as: await bob() });
    expect(l.json).toHaveLength(0);
    expect(await ownerOf(TOKEN)).toBe(aliceId);
  });

  test('reRegisteringIsAnUpsertThatKeepsCreatedAt', async () => {
    expect((await register('alice', TOKEN, 'android', '1.0.0')).status).toBe(200);
    await api.db`UPDATE public.user_devices SET created_at = now() - interval '5 days', last_seen_at = now() - interval '5 days' WHERE token = ${TOKEN}`;
    const [{ c: before }] = await api.db`SELECT created_at::text AS c FROM public.user_devices WHERE token = ${TOKEN}` as unknown as [{ c: string }];

    const r = await register('alice', TOKEN, 'android', null);
    expect(r.status).toBe(200);
    expect(r.json.appVersion).toBeNull();

    expect(await deviceCount()).toBe(1);
    const [row] = await api.db`SELECT created_at::text AS c, last_seen_at > now() - interval '1 hour' AS fresh FROM public.user_devices WHERE token = ${TOKEN}`;
    expect(row!.c).toBe(before);
    expect(row!.fresh).toBe(true);
  });

  test('aTokenRegisteredByAnotherUserMovesToThem', async () => {
    expect((await register('alice', TOKEN, 'ios', '1.0.0')).status).toBe(200);
    expect((await register('bob', TOKEN, 'ios', '1.0.1')).status).toBe(200);
    expect(await deviceCount()).toBe(1);
    expect(await ownerOf(TOKEN)).toBe(bobId);
    expect((await api.get('/v1/me/devices', { as: await alice() })).json).toHaveLength(0);
  });

  test('invalidRequestsAreRejected', async () => {
    let r = await register('alice', TOKEN, 'windows', null);
    expect(r.status).toBe(400);
    expect(r.json.message).toBe('platform: must match "(?i)ios|android"');
    expect((await register('alice', '', 'ios', null)).status).toBe(400);
    expect((await register('alice', 'has spaces/and slashes', 'ios', null)).status).toBe(400);
    r = await register('alice', TOKEN, 'ios', 'x'.repeat(33));
    expect(r.status).toBe(400);
    expect(r.json.message).toBe('appVersion: size must be between 0 and 32');
    expect((await register('alice', 't'.repeat(1025), 'ios', null)).status).toBe(400);
    r = await api.put('/v1/me/devices', { as: await alice(), body: `{"token":"${TOKEN}"}` });
    expect(r.status).toBe(400);
    expect(r.json.message).toBe('platform: must not be blank');
    expect(await deviceCount()).toBe(0);

    // The longest token the column holds is accepted.
    expect((await register('alice', 't'.repeat(1024), 'ios', null)).status).toBe(200);
    expect(await deviceCount()).toBe(1);
  });

  test('deleteRemovesOnlyTheCallersToken', async () => {
    expect((await register('alice', TOKEN, 'ios', null)).status).toBe(200);
    expect((await register('bob', 'bob-token', 'android', null)).status).toBe(200);

    // Someone else's token: 204, untouched.
    let d = await api.delete('/v1/me/devices/bob-token', { as: await alice() });
    expect(d.status).toBe(204);
    expect(d.text).toBe('');
    expect(await ownerOf('bob-token')).toBe(bobId);

    d = await api.delete(`/v1/me/devices/${TOKEN}`, { as: await alice() });
    expect(d.status).toBe(204);
    expect(await ownerOf(TOKEN)).toBeNull();

    // Idempotent (logout retry).
    expect((await api.delete(`/v1/me/devices/${TOKEN}`, { as: await alice() })).status).toBe(204);
  });

  test('registrationsBeyondTheCapDropTheLeastRecentlySeen', async () => {
    for (let i = 0; i < MAX_DEVICES_PER_USER; i++) {
      await api.db`INSERT INTO public.user_devices (token, user_id, platform, created_at, last_seen_at)
                   VALUES (${`old-${i}`}, ${aliceId}, 'android', now() - make_interval(days => ${30 - i}), now() - make_interval(days => ${30 - i}))`;
    }
    expect((await register('bob', 'bob-token', 'ios', null)).status).toBe(200);
    expect((await register('alice', TOKEN, 'ios', null)).status).toBe(200);

    const tokens = (await api.db`SELECT token FROM public.user_devices WHERE user_id = ${aliceId}`).map((r) => r.token as string);
    expect(tokens).toHaveLength(MAX_DEVICES_PER_USER);
    expect(tokens).toContain(TOKEN);
    expect(tokens).not.toContain('old-0');
    expect(await ownerOf('bob-token')).toBe(bobId);
  });
});
