// ReviewLoginIT.googleLoginWithTheReviewEmailIsStillRejected (in-process: needs the local-key Google verifier).
import { afterAll, beforeAll, expect, test } from 'bun:test';
import bcrypt from 'bcryptjs';
import { HttpGoogleOAuthClient } from '../../src/external/google';
import { loadConfig } from '../../src/config';
import { CONTRACT_ENV } from '../../contract/support/env';
import { googleToken, localKeyVerifier, WEB_CLIENT } from '../support/google';
import { testApp, type TestApp } from '../support/app';

const env = { AUTH_GOOGLE_MOBILE_AUDIENCES: WEB_CLIENT, REVIEW_LOGIN_EMAIL: '  AppReview@Example.com ', REVIEW_LOGIN_PASSWORD_HASH: bcrypt.hashSync('pw', 4) };
let t: TestApp;
beforeAll(async () => {
  const auth = (await loadConfig({ ...CONTRACT_ENV, ...env })).auth;
  t = await testApp({ env, overrides: { google: { oauth: new HttpGoogleOAuthClient(auth), idTokens: localKeyVerifier(auth) } } });
}, 60_000);
afterAll(() => t?.close());

test('googleLoginWithTheReviewEmailIsStillRejected', async () => {
  const r = await t.request('POST', '/v1/auth/google/mobile', { body: { idToken: await googleToken('appreview@example.com') } });
  expect(r.status).toBe(403);
  expect(r.json.error).toBe('unauthorized');
});
