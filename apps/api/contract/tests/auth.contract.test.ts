// Ports apps/api/src/test/java/org/ceitba/api/web/auth/AuthIT.java (HTTP parts).
// The allowlist unit assertions (allowlistAdmits*) are in-process: test/auth/allowlist.test.ts.
import { describe, expect, test } from 'bun:test';
import { apiKey, bearer, mintJwt, supports, TEST_SYNC_KEY, useServer } from '../support';

const api = useServer();
const hasBookmarks = await supports('GET /v1/wiki/bookmarks/93.12');
const hasSync = await supports('POST /v1/sync/all');

describe('AuthIT', () => {
  test.skipIf(!hasBookmarks)('publicEndpointsAreReachableWithoutAuth', async () => {
    expect((await api.get('/health')).status).toBe(200);
    expect((await api.get('/v1/careers')).status).toBe(200);
    const b = await api.get('/v1/wiki/bookmarks/93.12');
    expect(b.status).toBe(200);
    expect(b.json.bookmarked).toBe(false);
  });

  test('publicEndpointsAreReachableWithoutAuth (health, careers)', async () => {
    expect((await api.get('/health')).status).toBe(200);
    expect((await api.get('/v1/careers')).status).toBe(200);
  });

  test('protectedEndpointWithoutTokenReturns401', async () => {
    const r = await api.post('/v1/wiki/bookmarks/93.12');
    expect(r.status).toBe(401);
    expect(r.headers.get('WWW-Authenticate')).toBe('Bearer');
  });

  test('syncWithoutApiKeyReturns401', async () => {
    expect((await api.post('/v1/sync/all')).status).toBe(401);
  });

  test('syncWithWrongApiKeyReturns401', async () => {
    expect((await api.post('/v1/sync/all', { as: apiKey('wrong-key') })).status).toBe(401);
  });

  test('syncWithPrefixOfTheKeyReturns401', async () => {
    expect((await api.post('/v1/sync/all', { as: apiKey('test-sync-ke') })).status).toBe(401);
  });

  test('syncKeyOnAUserEndpointIsForbidden', async () => {
    const r = await api.get('/v1/auth/me', { as: apiKey(TEST_SYNC_KEY) });
    expect(r.status).toBe(403);
    expect(r.json.error).toBe('AccessDenied');
    expect(r.json.message).toBe('Insufficient permissions');
  });

  test('apiKeyTtlIsCappedAtOneYear', async () => {
    const alice = bearer(await mintJwt({ email: 'alice@itba.edu.ar', name: 'Alice' }));
    const over = await api.post('/v1/auth/api-keys', { as: alice, body: { name: 'script', ttlDays: 366 } });
    expect(over.status).toBe(400);
    expect(over.json.message).toBe('ttlDays: must be less than or equal to 365');
    const ok = await api.post('/v1/auth/api-keys', { as: alice, body: { name: 'script', ttlDays: 365 } });
    expect(ok.status).toBe(201);
    expect(Object.keys(ok.json)).toEqual(['id', 'name', 'key', 'expiresAt', 'scopes']);
    expect(ok.json.key).toMatch(/^ceitba_[A-Za-z0-9_-]{43}$/);
    // OffsetDateTime.now().plusDays(365) in the JVM zone (ART).
    expect(ok.json.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?-03:00$/);
    expect(ok.json.scopes).toEqual(['read', 'report', 'events', 'write', 'staff', 'keys']);
  });

  test.skipIf(!hasSync)('syncWithCorrectApiKeyIsAllowed', async () => {
    const r = await api.post('/v1/sync/all', { as: apiKey(TEST_SYNC_KEY) });
    expect(r.status).toBe(200);
    expect(r.json.totalProcessed).toBe(0);
  });
});

// Not in the Java suite: the JWT validation contract (SecurityConfig.jwtDecoder), probed against the jar.
describe('JWT validation', () => {
  const desc = (r: { headers: Headers }) => r.headers.get('WWW-Authenticate');
  const PREFIX = 'Bearer error="invalid_token", error_description="An error occurred while attempting to decode the Jwt: ';
  const URI = '", error_uri="https://tools.ietf.org/html/rfc6750#section-3.1"';

  test('malformedExpiredBadSignatureAndClaims', async () => {
    expect(desc(await api.get('/v1/auth/me', { as: bearer('abc') }))).toBe(`${PREFIX}Malformed token${URI}`);
    const exp = Math.floor(Date.now() / 1000) - 3600;
    const expired = await api.get('/v1/auth/me', { as: bearer(await mintJwt({ ttlSeconds: -3600 })) });
    expect(expired.status).toBe(401);
    expect(desc(expired)).toBe(`${PREFIX}Jwt expired at ${new Date(exp * 1000).toISOString().replace('.000Z', 'Z')}${URI}`);
    expect(desc(await api.get('/v1/auth/me', { as: bearer(await mintJwt({ secret: new Uint8Array(32).fill(1) })) })))
      .toBe(`${PREFIX}Signed JWT rejected: Invalid signature${URI}`);
    expect(desc(await api.get('/v1/auth/me', { as: bearer(await mintJwt({ iss: null })) }))).toBe(`${PREFIX}The iss claim is not valid${URI}`);
    expect(desc(await api.get('/v1/auth/me', { as: bearer(await mintJwt({ aud: null })) }))).toBe(`${PREFIX}The aud claim is not valid${URI}`);
    expect(desc(await api.get('/v1/auth/me', { as: bearer(await mintJwt({ alg: 'HS512' })) })))
      .toBe(`${PREFIX}Signed JWT rejected: Another algorithm expected, or no matching key(s) found${URI}`);
  });

  test('expiresAtMustBeAfterIssuedAt', async () => {
    const now = Math.floor(Date.now() / 1000);
    const r = await api.get('/v1/auth/me', { as: bearer(await mintJwt({ iat: now, ttlSeconds: 0 })) });
    expect(r.status).toBe(401);
    expect(desc(r)).toBe(`${PREFIX}expiresAt must be after issuedAt${URI}`);
  });

  test('clockSkewOf60Seconds', async () => {
    expect((await api.get('/v1/auth/me', { as: bearer(await mintJwt({ ttlSeconds: -30 })) })).status).toBe(200);
  });

  test('audienceArrayIsAccepted', async () => {
    expect((await api.get('/v1/auth/me', { as: bearer(await mintJwt({ aud: ['x', 'ceitba-api'] })) })).status).toBe(200);
  });

  test('tokenWithoutEmailIsForbidden', async () => {
    const r = await api.get('/v1/auth/me', { as: bearer(await mintJwt({ email: null })) });
    expect(r.status).toBe(403);
    expect(desc(r)).toBe('Bearer error="insufficient_scope", error_description="The request requires higher privileges than provided by the access token.", error_uri="https://tools.ietf.org/html/rfc6750#section-3.1"');
    expect(r.text).toBe('');
  });

  test('aBadTokenIs401EvenOnPublicRoutes', async () => {
    expect((await api.get('/v1/careers', { as: bearer(await mintJwt({ ttlSeconds: -3600 })) })).status).toBe(401);
    const empty = await api.get('/v1/careers', { headers: { Authorization: 'Bearer ' } });
    expect(empty.status).toBe(401);
    expect(desc(empty)).toBe('Bearer error="invalid_token", error_description="Bearer token is malformed", error_uri="https://tools.ietf.org/html/rfc6750#section-3.1"');
    expect((await api.get('/v1/careers', { headers: { Authorization: 'Basic abc' } })).status).toBe(200);
  });

  test('sessionCookieAuthenticates', async () => {
    const token = await mintJwt({ email: 'cookie@itba.edu.ar' });
    const r = await api.get('/v1/auth/me', { headers: { Cookie: `ceitba_session=${token}` } });
    expect(r.status).toBe(200);
    expect(r.json.email).toBe('cookie@itba.edu.ar');
    expect((await api.get('/v1/careers', { headers: { Cookie: 'ceitba_session=' } })).status).toBe(200);
  });

  test('notAllowlistedEmailIsForbidden', async () => {
    const r = await api.get('/v1/auth/me', { as: bearer(await mintJwt({ email: 'bob@gmail.com' })) });
    expect(r.status).toBe(403);
    expect(r.text).toBe('');
  });
});
