// Ports apps/api/src/test/java/org/ceitba/api/web/auth/RefreshTokenIT.java.
// newFamily() = a seeded refresh_tokens row (RefreshTokenService.issueNewFamily).
// The two concurrency tests (logout/logout-all during an uncommitted rotation)
// drive the service inside an open transaction: in-process, test/auth/refresh-concurrency.test.ts.
import { beforeEach, describe, expect, test } from 'bun:test';
import { bearer, mintJwt, seedRefreshToken, seedUser, sha256Hex, truncateUsers, useServer } from '../support';

const api = useServer();
let alice: string;

const newFamily = (userId: string) => seedRefreshToken(api.db, userId, { deviceName: 'test-device' });
const refresh = (token: string) => api.post('/v1/auth/refresh', { body: { refreshToken: token } });
const ok = async (token: string) => {
  const r = await refresh(token);
  expect(r.status).toBe(200);
  return r.json;
};
const rows = () => api.db`SELECT id, family_id, revoked_at, replaced_by, device_name FROM public.refresh_tokens`;
const ageRotations = () => api.db`UPDATE public.refresh_tokens SET revoked_at = revoked_at - INTERVAL '10 minutes' WHERE revoked_at IS NOT NULL`;

describe('RefreshTokenIT', () => {
  beforeEach(async () => {
    await truncateUsers(api.db);
    alice = await seedUser(api.db, 'alice@itba.edu.ar', { name: 'Alice' });
  });

  test('refreshRotatesTheToken', async () => {
    const t1 = await newFamily(alice);
    const r = await refresh(t1);
    expect(r.status).toBe(200);
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    expect(r.headers.get('Pragma')).toBeNull();
    const body = r.json;
    expect(Object.keys(body)).toEqual(['accessToken', 'accessTokenExpiresAt', 'refreshToken', 'refreshTokenExpiresAt', 'user']);
    const t2 = body.refreshToken;
    expect(t2).not.toBe(t1);
    expect(body.accessToken).not.toBe('');
    expect(body.user.email).toBe('alice@itba.edu.ar');
    // accessTokenExpiresAt has the exp claim's second precision.
    expect(body.accessTokenExpiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    const all = await rows();
    expect(all).toHaveLength(2);
    expect(new Set(all.map((x) => x.family_id)).size).toBe(1);
    const old = all.find((x) => x.revoked_at !== null)!;
    const current = all.find((x) => x.revoked_at === null)!;
    expect(old.replaced_by).toBe(current.id);
    expect(current.device_name).toBe('test-device');
    await ok(t2);
  });

  test('reusingARotatedTokenAfterTheGraceWindowRevokesTheWholeFamily', async () => {
    const t1 = await newFamily(alice);
    const t2 = (await ok(t1)).refreshToken;
    await ageRotations();
    const r = await refresh(t1);
    expect(r.status).toBe(401);
    expect(r.json).toMatchObject({ error: 'invalid_token', message: 'Refresh token is invalid or expired' });
    expect((await refresh(t2)).status).toBe(401);
    expect((await rows()).every((x) => x.revoked_at !== null)).toBe(true);
  });

  test('reusingARotatedTokenWhoseSuccessorWasUsedRevokesTheWholeFamily', async () => {
    const t1 = await newFamily(alice);
    const t2 = (await ok(t1)).refreshToken;
    const t3 = (await ok(t2)).refreshToken;
    expect((await refresh(t1)).status).toBe(401);
    expect((await refresh(t3)).status).toBe(401);
    expect((await rows()).every((x) => x.revoked_at !== null)).toBe(true);
  });

  test('retryWithinGraceWindowAfterALostResponseIssuesANewSuccessor', async () => {
    const t1 = await newFamily(alice);
    const lost = (await ok(t1)).refreshToken;
    const t3 = (await ok(t1)).refreshToken;
    expect(t3).not.toBe(lost);
    const all = await rows();
    expect(all).toHaveLength(3);
    expect(new Set(all.map((x) => x.family_id)).size).toBe(1);
    const live = all.filter((x) => x.revoked_at === null);
    expect(live).toHaveLength(1);
    expect(new Set(all.filter((x) => x.revoked_at !== null).map((x) => x.replaced_by))).toEqual(new Set([live[0]!.id]));
    await ok(t3);
  });

  test('theReplacedSuccessorCountsAsReuseOnceTheNewOneWasUsed', async () => {
    const t1 = await newFamily(alice);
    const lost = (await ok(t1)).refreshToken;
    const t3 = (await ok(t1)).refreshToken;
    const t4 = (await ok(t3)).refreshToken;
    expect((await refresh(lost)).status).toBe(401);
    expect((await refresh(t4)).status).toBe(401);
    expect((await rows()).every((x) => x.revoked_at !== null)).toBe(true);
  });

  test('reuseDoesNotTouchOtherFamilies', async () => {
    const a = await newFamily(alice);
    const b = await newFamily(alice);
    await ok(a);
    await ageRotations();
    expect((await refresh(a)).status).toBe(401);
    await ok(b);
  });

  test('userRemovedFromAllowlistLosesTheFamily', async () => {
    const mallory = await seedUser(api.db, 'mallory@gmail.com', { name: 'Mallory' });
    const t = await newFamily(mallory);
    const r = await refresh(t);
    expect(r.status).toBe(403);
    expect(r.json).toMatchObject({ error: 'unauthorized', message: 'Email is not allowed to sign in' });
    expect((await rows()).every((x) => x.revoked_at !== null)).toBe(true);
    expect((await refresh(t)).status).toBe(401);
  });

  test('unknownTokenIsRejected', async () => {
    const r = await refresh('not-a-real-token');
    expect(r.status).toBe(401);
    expect(r.json.error).toBe('invalid_token');
  });

  test('expiredTokenIsRejected', async () => {
    const raw = 'expired-raw-token';
    await api.db`INSERT INTO public.refresh_tokens (id, user_id, family_id, token_hash, device_name, created_at, expires_at)
                 VALUES (${crypto.randomUUID()}, ${alice}, ${crypto.randomUUID()}, ${sha256Hex(raw)}, NULL, now(), now() - interval '1 minute')`;
    expect((await refresh(raw)).status).toBe(401);
  });

  test('refreshIgnoresAnExpiredBearerHeader', async () => {
    const t = await newFamily(alice);
    const r = await api.post('/v1/auth/refresh', { headers: { Authorization: 'Bearer expired.or.garbage' }, body: { refreshToken: t } });
    expect(r.status).toBe(200);
  });

  test('logoutWithRefreshTokenRevokesItsFamily', async () => {
    const t1 = await newFamily(alice);
    const t2 = (await ok(t1)).refreshToken;
    const other = await newFamily(alice);
    expect((await api.post('/v1/auth/logout', { body: { refreshToken: t2 } })).status).toBe(204);
    expect((await refresh(t2)).status).toBe(401);
    await ok(other);
  });

  test('logoutWithoutBodyStillWorks', async () => {
    expect((await api.post('/v1/auth/logout')).status).toBe(204);
    expect((await api.post('/v1/auth/logout', { body: { refreshToken: 'unknown' } })).status).toBe(204);
  });

  test('logoutWithANonJsonBodyStillClearsTheCookie', async () => {
    const r = await api.post('/v1/auth/logout', { body: 'bye', contentType: 'text/plain' });
    expect(r.status).toBe(204);
    expect(r.setCookies).toEqual(['ceitba_session=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure; HttpOnly; SameSite=Lax']);
    expect((await api.post('/v1/auth/logout', { body: 'a=b', contentType: 'application/x-www-form-urlencoded' })).status).toBe(204);
  });

  test('logoutAllRevokesEveryFamilyOfTheCaller', async () => {
    const a = await newFamily(alice);
    const b = await newFamily(alice);
    const bob = await seedUser(api.db, 'bob@itba.edu.ar', { name: 'Bob' });
    const bobs = await newFamily(bob);
    const r = await api.post('/v1/auth/logout-all', { as: bearer(await mintJwt({ email: 'alice@itba.edu.ar' })) });
    expect(r.status).toBe(204);
    expect((await refresh(a)).status).toBe(401);
    expect((await refresh(b)).status).toBe(401);
    await ok(bobs);
  });

  test('logoutAllRequiresAuthentication', async () => {
    expect((await api.post('/v1/auth/logout-all')).status).toBe(401);
  });

  // Not in the IT: a logout body that is JSON but malformed is a 400 ValidationError.
  test('logoutWithMalformedJsonIs400', async () => {
    const r = await api.post('/v1/auth/logout', { body: '{bad' });
    expect(r.status).toBe(400);
    expect(r.json.message).toBe("Validation failed for field 'body' with value '<malformed>': logout body must be valid JSON");
  });

  test('refreshValidation', async () => {
    const r = await api.post('/v1/auth/refresh', { body: {} });
    expect(r.status).toBe(400);
    expect(r.json.message).toBe('refreshToken: must not be blank');
  });
});
