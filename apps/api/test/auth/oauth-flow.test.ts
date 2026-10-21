// In-process part of apps/api/src/test/java/org/ceitba/api/web/auth/AuthOAuthFlowIT.java:
// the flows where Google's code exchange succeeds (StubGoogle).
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { HttpGoogleOAuthClient, StubGoogleOAuthClient } from '../../src/external/google';
import { loadConfig } from '../../src/config';
import { CONTRACT_ENV } from '../../contract/support/env';
import { localKeyVerifier } from '../support/google';
import { testApp, type TestApp } from '../support/app';

const env = { FRONTEND_URL: 'https://ceitba.org.ar' };
let t: TestApp;
let stub: StubGoogleOAuthClient;

beforeAll(async () => {
  const auth = (await loadConfig({ ...CONTRACT_ENV, ...env })).auth;
  stub = new StubGoogleOAuthClient(new HttpGoogleOAuthClient(auth), {
    sub: 'google-sub-1', email: 'alice@itba.edu.ar', name: 'Alice', picture: null, emailVerified: true, hd: 'itba.edu.ar',
  });
  t = await testApp({ env, overrides: { google: { oauth: stub, idTokens: localKeyVerifier(auth) } } });
}, 60_000);
afterAll(() => t?.close());

const start = async (redirectUri: string) => {
  const r = await t.request('GET', `/v1/auth/google?redirect_uri=${encodeURIComponent(redirectUri)}`);
  expect(r.status).toBe(302);
  return {
    state: new URL(r.headers.get('Location')!).searchParams.get('state')!,
    cookie: r.setCookies.find((c) => c.startsWith('ceitba_oauth_state='))!.split(';')[0]!,
  };
};

describe('AuthOAuthFlowIT (stubbed exchange)', () => {
  beforeEach(() => { stub.exchanges = 0; });

  test('fullFlow_withMatchingCookie_logsInAndRedirectsToTarget', async () => {
    const s = await start('https://ceitba.org.ar/manage?tab=2');
    const r = await t.request('GET', `/v1/auth/callback?code=good-code&state=${encodeURIComponent(s.state)}`, { headers: { Cookie: s.cookie } });
    expect(r.status).toBe(302);
    expect(r.headers.get('Location')).toBe('https://ceitba.org.ar/manage?tab=2');
    const session = r.setCookies.find((c) => c.startsWith('ceitba_session='))!;
    expect(session).toMatch(/^ceitba_session=eyJ[^;]+; Path=\/; Max-Age=86400; Expires=[^;]+; Secure; HttpOnly; SameSite=Lax$/);
    expect(r.setCookies).toContain('ceitba_oauth_state=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure; HttpOnly; SameSite=Lax');
    expect(stub.exchanges).toBe(1);
    // The session cookie is a working session.
    const me = await t.request('GET', '/v1/auth/me', { headers: { Cookie: session.split(';')[0]! } });
    expect(me.json.email).toBe('alice@itba.edu.ar');
  });

  test('googleLogin_lookalikeRedirect_fallsBackToFrontend', async () => {
    const s = await start('https://ceitba.org.ar.evil.com/steal');
    const r = await t.request('GET', `/v1/auth/callback?code=good-code&state=${encodeURIComponent(s.state)}`, { headers: { Cookie: s.cookie } });
    expect(r.headers.get('Location')).toBe('https://ceitba.org.ar');
  });

  test('rejectedLoginRedirectsWithTheReasonCode', async () => {
    stub.claims = { ...stub.claims, email: 'bob@gmail.com', hd: null };
    try {
      const s = await start('https://ceitba.org.ar/manage');
      const r = await t.request('GET', `/v1/auth/callback?code=c&state=${encodeURIComponent(s.state)}`, { headers: { Cookie: s.cookie } });
      expect(r.headers.get('Location')).toBe('https://ceitba.org.ar/manage?error=unauthorized');
    } finally {
      stub.claims = { ...stub.claims, email: 'alice@itba.edu.ar', hd: 'itba.edu.ar' };
    }
  });
});
