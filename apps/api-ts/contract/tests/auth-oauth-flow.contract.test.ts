// Ports apps/api/src/test/java/org/ceitba/api/web/auth/AuthOAuthFlowIT.java.
// The IT stubs Google's code exchange; black-box servers call Google for real,
// so the tests where the exchange must SUCCEED (fullFlow_*) are in-process:
// test/auth/oauth-flow.test.ts. Every test here asserts that no exchange
// happens (a real one would fail with auth_failed).
import { describe, expect, test } from 'bun:test';
import { useServer, type ApiResponse } from '../support';

const api = useServer({ env: { FRONTEND_URL: 'https://ceitba.org.ar' } });

const stateOf = (r: ApiResponse) => new URL(r.location!).searchParams.get('state')!;
const stateCookieOf = (r: ApiResponse) => r.setCookies.find((c) => c.startsWith('ceitba_oauth_state='))!.split(';')[0]!;
const startLogin = async (redirectUri: string) => {
  const r = await api.get('/v1/auth/google', { query: { redirect_uri: redirectUri } });
  expect(r.status).toBe(302);
  return r;
};

describe('AuthOAuthFlowIT', () => {
  test('googleLogin_setsHttpOnlyStateCookie_andSignedState', async () => {
    const res = await startLogin('https://ceitba.org.ar/manage');
    const cookie = res.setCookies.find((c) => c.startsWith('ceitba_oauth_state='))!;
    expect(cookie).toMatch(/^ceitba_oauth_state=[A-Za-z0-9_-]{22}; Path=\/; Max-Age=600; Expires=[^;]+ GMT; Secure; HttpOnly; SameSite=Lax$/);
    const state = stateOf(res);
    expect(state).toContain('.');
    expect(state).not.toBe(Buffer.from('https://ceitba.org.ar/manage').toString('base64url'));
    // Google's authorization URL, parameter by parameter.
    expect(res.location).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?response_type=code&client_id=test-client-id&redirect_uri=http:\/\/localhost:8080\/api\/v1\/auth\/callback&scope=openid%20email%20profile&state=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+&access_type=offline&hd=itba\.edu\.ar$/);
    expect(res.text).toBe('');
  });

  test('callback_withoutStateCookie_isRejectedBeforeCodeExchange', async () => {
    const start = await startLogin('https://ceitba.org.ar/manage');
    const r = await api.get('/v1/auth/callback', { query: { code: 'good-code', state: stateOf(start) } });
    expect(r.status).toBe(302);
    expect(r.location).toBe('https://ceitba.org.ar?error=invalid_state');
    expect(r.setCookies.some((c) => c.startsWith('ceitba_session='))).toBe(false);
  });

  test('callback_withAnotherBrowsersCookie_isRejected', async () => {
    const victim = await startLogin('https://ceitba.org.ar/manage');
    const attacker = await startLogin('https://ceitba.org.ar/manage');
    const r = await api.get('/v1/auth/callback', { query: { code: 'good-code', state: stateOf(attacker) }, headers: { Cookie: stateCookieOf(victim) } });
    expect(r.status).toBe(302);
    expect(r.location!.endsWith('error=invalid_state')).toBe(true);
  });

  test('callback_withLegacyUnsignedState_isRejected', async () => {
    const legacy = Buffer.from('https://evil.com').toString('base64url');
    const r = await api.get('/v1/auth/callback', { query: { code: 'good-code', state: legacy }, headers: { Cookie: 'ceitba_oauth_state=whatever' } });
    expect(r.status).toBe(302);
    expect(r.location).toBe('https://ceitba.org.ar?error=invalid_state');
  });

  test('googleLogin_lookalikeRedirect_fallsBackToFrontend', async () => {
    // The state carries FRONTEND_URL: with a cancelled consent (no exchange) it is where we land.
    const start = await startLogin('https://ceitba.org.ar.evil.com/steal');
    const r = await api.get('/v1/auth/callback', { query: { error: 'access_denied', state: stateOf(start) }, headers: { Cookie: stateCookieOf(start) } });
    expect(r.location).toBe('https://ceitba.org.ar?error=access_denied');
  });

  test('callback_whenUserCancelsConsent_redirectsToTargetWithAccessDenied', async () => {
    const start = await startLogin('https://ceitba.org.ar/manage');
    const r = await api.get('/v1/auth/callback', { query: { error: 'access_denied', state: stateOf(start) }, headers: { Cookie: stateCookieOf(start) } });
    expect(r.status).toBe(302);
    expect(r.location).toBe('https://ceitba.org.ar/manage?error=access_denied');
    expect(r.setCookies.some((c) => c.startsWith('ceitba_session='))).toBe(false);
    expect(r.setCookies).toEqual(['ceitba_oauth_state=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure; HttpOnly; SameSite=Lax']);
  });

  test('callback_withOtherGoogleErrorOrNoCode_redirectsWithAuthFailed', async () => {
    const start = await startLogin('https://ceitba.org.ar/manage');
    const cookie = stateCookieOf(start);
    const withError = await api.get('/v1/auth/callback', { query: { error: '<script>', state: stateOf(start) }, headers: { Cookie: cookie } });
    expect(withError.location).toBe('https://ceitba.org.ar/manage?error=auth_failed');
    const noCode = await api.get('/v1/auth/callback', { query: { state: stateOf(start) }, headers: { Cookie: cookie } });
    expect(noCode.location).toBe('https://ceitba.org.ar/manage?error=auth_failed');
  });

  test('callback_cancelWithoutValidState_isInvalidState', async () => {
    const r = await api.get('/v1/auth/callback', { query: { error: 'access_denied' } });
    expect(r.status).toBe(302);
    expect(r.location).toBe('https://ceitba.org.ar?error=invalid_state');
  });

  test('logout_isPostOnly', async () => {
    expect((await api.post('/v1/auth/logout')).status).toBe(204);
    expect((await api.get('/v1/auth/logout')).status).toBe(401);
  });

  // Not in the IT: an existing query string keeps its params and `error` is replaced.
  test('targetWithQueryKeepsItAndReplacesError', async () => {
    const start = await startLogin('https://ceitba.org.ar/manage?tab=2&error=old#frag');
    const r = await api.get('/v1/auth/callback', { query: { error: 'access_denied', state: stateOf(start) }, headers: { Cookie: stateCookieOf(start) } });
    expect(r.location).toBe('https://ceitba.org.ar/manage?tab=2&error=access_denied#frag');
  });
});
