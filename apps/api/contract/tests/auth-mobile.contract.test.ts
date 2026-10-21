// The black-box part of apps/api/src/test/java/org/ceitba/api/web/auth/AuthMobileIT.java.
// Every token check needs a Google ID token signed by a key the server trusts;
// the Java jar only trusts Google's JWKS, so those tests are in-process:
// test/auth/mobile-login.test.ts (local RSA key, like TestGoogleIdTokens).
import { describe, expect, test } from 'bun:test';
import { useServer } from '../support';

const unconfigured = useServer();
const configured = useServer({ env: { AUTH_GOOGLE_MOBILE_AUDIENCES: 'test-web-client.apps.googleusercontent.com' } });

describe('AuthMobileIT', () => {
  test('missingIdTokenIsBadRequest', async () => {
    const r = await configured.post('/v1/auth/google/mobile', { body: { deviceName: 'x' } });
    expect(r.status).toBe(400);
    expect(r.json).toMatchObject({ error: 'ValidationError', message: 'idToken: must not be blank' });
  });

  // Not in the IT: AUTH_GOOGLE_MOBILE_AUDIENCES empty = 501 (after body validation).
  test('mobileLoginIsNotImplementedWithoutAudiences', async () => {
    const r = await unconfigured.post('/v1/auth/google/mobile', { body: { idToken: 'x' } });
    expect(r.status).toBe(501);
    expect(r.json).toMatchObject({ error: 'NotImplemented', message: 'Mobile Google login is not configured (AUTH_GOOGLE_MOBILE_AUDIENCES is empty)' });
    expect((await unconfigured.post('/v1/auth/google/mobile', { body: {} })).status).toBe(400);
  });
});
