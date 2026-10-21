// In-process port of apps/api/src/test/java/org/ceitba/api/web/auth/AuthMobileIT.java
// (+ ReviewLoginIT.googleLoginWithTheReviewEmailIsStillRejected): the real
// verifier with a local RSA key (TestGoogleIdTokens), which a black-box jar cannot use.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { HttpGoogleOAuthClient } from '../../src/external/google';
import { loadConfig } from '../../src/config';
import { CONTRACT_ENV } from '../../contract/support/env';
import { googleToken, IOS_CLIENT, localKeyVerifier, WEB_CLIENT } from '../support/google';
import { testApp, type TestApp } from '../support/app';

const env = { AUTH_ALLOWED_EMAILS: 'friend@gmail.com,boss@acme.com', AUTH_GOOGLE_MOBILE_AUDIENCES: `${WEB_CLIENT},${IOS_CLIENT}` };
let t: TestApp;

beforeAll(async () => {
  const auth = (await loadConfig({ ...CONTRACT_ENV, ...env })).auth;
  t = await testApp({ env, overrides: { google: { oauth: new HttpGoogleOAuthClient(auth), idTokens: localKeyVerifier(auth) } } });
}, 60_000);
afterAll(() => t?.close());

const login = (body: Record<string, unknown>) => t.request('POST', '/v1/auth/google/mobile', { body });
const loginToken = (idToken: string) => login({ idToken, deviceName: 'Pixel 8' });
const count = async (table: string) => Number((await t.sql.unsafe(`SELECT count(*)::int AS n FROM public.${table}`))[0]!.n);

describe('AuthMobileIT', () => {
  beforeEach(async () => { await t.sql`TRUNCATE public."user" CASCADE`; });

  test('validTokenReturnsTokenPairAndProvisionsUser', async () => {
    const before = Date.now();
    const r = await loginToken(await googleToken('alice@itba.edu.ar'));
    expect(r.status).toBe(200);
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    expect(typeof r.json.accessToken).toBe('string');
    expect(typeof r.json.refreshToken).toBe('string');
    expect(r.json.user).toMatchObject({ email: 'alice@itba.edu.ar', name: 'Test alice@itba.edu.ar', role: 'user' });
    const accessExp = Date.parse(r.json.accessTokenExpiresAt);
    expect(accessExp).toBeGreaterThanOrEqual(before + 14 * 60_000);
    expect(accessExp).toBeLessThanOrEqual(before + 16 * 60_000);
    expect(Date.parse(r.json.refreshTokenExpiresAt)).toBeGreaterThan(before + 59 * 86_400_000);
    const [user] = await t.sql`SELECT id, google_sub FROM public."user" WHERE email = 'alice@itba.edu.ar'`;
    expect(user!.google_sub).toBe('google-alice@itba.edu.ar');
    expect([...(await t.sql`SELECT device_name FROM public.refresh_tokens`)]).toEqual([{ device_name: 'Pixel 8' }]);
    const me = await t.request('GET', '/v1/auth/me', { headers: { Authorization: `Bearer ${r.json.accessToken}` } });
    expect(me.status).toBe(200);
    expect(me.json.id).toBe(user!.id);
  });

  test('loginLeavesAcademicProfileForTheUserToFill', async () => {
    expect((await loginToken(await googleToken('alice@itba.edu.ar'))).status).toBe(200);
    const [u] = await t.sql`SELECT file_number, career_id, plan FROM public."user" WHERE email = 'alice@itba.edu.ar'`;
    expect(u).toEqual({ file_number: null, career_id: null, plan: null });
  });

  test('iosAudienceIsAlsoAccepted', async () => {
    expect((await loginToken(await googleToken('alice@itba.edu.ar', (c) => { c.aud = IOS_CLIENT; }))).status).toBe(200);
  });

  test('unverifiedEmailIsRejected', async () => {
    const r = await loginToken(await googleToken('alice@itba.edu.ar', (c) => { c.email_verified = false; }));
    expect(r.status).toBe(403);
    expect(r.json).toMatchObject({ error: 'unverified_email', message: 'Google account email is not verified' });
    expect(await count('"user"')).toBe(0);
  });

  test('emailOutsideAllowlistIsRejected', async () => {
    const r = await loginToken(await googleToken('mallory@gmail.com'));
    expect(r.status).toBe(403);
    expect(r.json.error).toBe('unauthorized');
    expect(await count('"user"')).toBe(0);
    expect(await count('refresh_tokens')).toBe(0);
  });

  test('explicitlyAllowlistedGmailIsAccepted', async () => {
    expect((await loginToken(await googleToken('friend@gmail.com'))).status).toBe(200);
  });

  test('workspaceDomainOutsideAllowlistIsRejected', async () => {
    const r = await loginToken(await googleToken('boss@acme.com', (c) => { c.hd = 'acme.com'; }));
    expect(r.status).toBe(403);
    expect(r.json.error).toBe('unauthorized_workspace');
  });

  test('wrongAudienceIsRejected', async () => {
    const r = await loginToken(await googleToken('alice@itba.edu.ar', (c) => { c.aud = 'someone-elses-app.apps.googleusercontent.com'; }));
    expect(r.status).toBe(401);
    expect(r.json).toMatchObject({ error: 'invalid_token', message: 'Google ID token is invalid' });
    expect(await count('"user"')).toBe(0);
  });

  test('wrongIssuerIsRejected', async () => {
    const r = await loginToken(await googleToken('alice@itba.edu.ar', (c) => { c.iss = 'https://evil.example.com'; }));
    expect(r.status).toBe(401);
    expect(r.json.error).toBe('invalid_token');
  });

  test('expiredTokenIsRejected', async () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    const r = await loginToken(await googleToken('alice@itba.edu.ar', (c) => { c.iat = past - 3600; c.exp = past; }));
    expect(r.status).toBe(401);
    expect(r.json.error).toBe('invalid_token');
  });

  test('tamperedTokenIsRejected', async () => {
    const token = await googleToken('alice@itba.edu.ar');
    const tampered = token.slice(0, -4) + (token.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    expect((await loginToken(tampered)).status).toBe(401);
  });

  test('nonceMustMatchWhenProvided', async () => {
    const token = await googleToken('alice@itba.edu.ar', (c) => { c.nonce = 'n-123'; });
    expect((await login({ idToken: token, nonce: 'other' })).status).toBe(401);
    expect((await login({ idToken: token, nonce: 'n-123' })).status).toBe(200);
  });

  test('missingIdTokenIsBadRequest', async () => {
    expect((await login({ deviceName: 'x' })).status).toBe(400);
  });

  test('repeatedLoginReusesTheSameUserAndStartsNewFamilies', async () => {
    const first = (await loginToken(await googleToken('alice@itba.edu.ar'))).json.user.id;
    const second = (await loginToken(await googleToken('alice@itba.edu.ar'))).json.user.id;
    expect(second).toBe(first);
    expect(await count('"user"')).toBe(1);
    const fams = await t.sql`SELECT family_id FROM public.refresh_tokens`;
    expect(fams).toHaveLength(2);
    expect(new Set(fams.map((f) => f.family_id)).size).toBe(2);
  });

  test('loginIgnoresAStaleBearerToken', async () => {
    const r = await t.request('POST', '/v1/auth/google/mobile', {
      headers: { Authorization: 'Bearer not-a-valid-jwt' }, body: { idToken: await googleToken('alice@itba.edu.ar') },
    });
    expect(r.status).toBe(200);
  });
});
