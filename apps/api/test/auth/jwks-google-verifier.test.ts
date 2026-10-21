// Port of JwksGoogleIdTokenVerifierTest: mobile login off without audiences,
// blank audience entries dropped, garbage rejected, the JWKS fetch limits, and
// unknown key ids not refetching Google's JWKS on every request.
import { afterAll, describe, expect, test } from 'bun:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { CONTRACT_ENV } from '../../contract/support/env';
import { loadConfig } from '../../src/config';
import { GOOGLE_JWKS_OPTIONS, googleJwkSet, JwksGoogleIdTokenVerifier } from '../../src/external/google';
import { FeatureNotConfiguredError, InvalidTokenError } from '../../src/http/errors';

const auth = async (audiences: string) => (await loadConfig({ ...CONTRACT_ENV, DATABASE_URL: 'jdbc:postgresql://localhost:1/x', AUTH_GOOGLE_MOBILE_AUDIENCES: audiences })).auth;
const keys = await generateKeyPair('RS256');
let fetches = 0;
const jwks = Bun.serve({
  port: 0,
  async fetch() {
    fetches++;
    return Response.json({ keys: [{ ...(await exportJWK(keys.publicKey)), kid: 'known', alg: 'RS256', use: 'sig' }] });
  },
});
afterAll(() => jwks.stop(true));

const sign = (kid: string) => {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ email: 'a@itba.edu.ar', email_verified: true })
    .setProtectedHeader({ alg: 'RS256', kid }).setIssuer('https://accounts.google.com').setAudience('aud').setSubject('sub-1')
    .setIssuedAt(now).setExpirationTime(now + 600).sign(keys.privateKey);
};

describe('JwksGoogleIdTokenVerifierTest', () => {
  test('emptyAudiencesDisableMobileLogin', async () => {
    await expect(new JwksGoogleIdTokenVerifier(await auth('')).verify('anything', null)).rejects.toBeInstanceOf(FeatureNotConfiguredError);
  });

  test('blankAudienceEntriesAreIgnored', async () => {
    expect((await auth(' a , ,')).google.mobileAudiences).toEqual(['a']);
  });

  test('garbageTokenIsInvalid', async () => {
    await expect(new JwksGoogleIdTokenVerifier(await auth('aud')).verify('not-a-jwt', null)).rejects.toBeInstanceOf(InvalidTokenError);
  });

  test('jwksFetchesHaveConnectAndReadTimeouts', () => {
    expect(GOOGLE_JWKS_OPTIONS.timeoutDuration).toBe(5000);
    expect(GOOGLE_JWKS_OPTIONS.cooldownDuration).toBeGreaterThan(0);
  });

  // Tokens with unknown `kid`s must not each trigger a JWKS download.
  test('unknownKeyIdsDoNotRefetchTheJwksOnEveryRequest', async () => {
    const verifier = new JwksGoogleIdTokenVerifier(await auth('aud'), googleJwkSet(`http://127.0.0.1:${jwks.port}/certs`));
    expect((await verifier.verify(await sign('known'), null)).email).toBe('a@itba.edu.ar');
    for (let i = 0; i < 10; i++) {
      await expect(verifier.verify(await sign(`unknown-${i}`), null)).rejects.toBeInstanceOf(InvalidTokenError);
    }
    // One initial fetch plus at most one rate-limited refresh.
    expect(fetches).toBeLessThanOrEqual(2);
    expect((await verifier.verify(await sign('known'), null)).email).toBe('a@itba.edu.ar');
  });
});
