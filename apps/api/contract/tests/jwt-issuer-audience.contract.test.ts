// Black-box port of apps/api/src/test/java/org/ceitba/api/config/JwtIssuerAudienceEnforcementTest.java
// (and IssuerAudienceValidatorTest): the decoder the app really uses, default vs AUTH_JWT_ENFORCE_ISS_AUD=false.
import { describe, expect, test } from 'bun:test';
import { bearer, mintJwt, useServer } from '../support';

const enforced = useServer();
const phaseIn = useServer({ env: { AUTH_JWT_ENFORCE_ISS_AUD: 'false' } });
const me = (s: typeof enforced, token: string) => s.get('/v1/auth/me', { as: bearer(token) });

describe('JwtIssuerAudienceEnforcementTest', () => {
  test('defaultDecoderRejectsTokensWithoutIssAndAud', async () => {
    expect((await me(enforced, await mintJwt({ iss: null, aud: null }))).status).toBe(401);
    const issOnly = await me(enforced, await mintJwt({ aud: null }));
    expect(issOnly.status).toBe(401);
    expect(issOnly.headers.get('WWW-Authenticate')).toContain('aud');
    expect((await me(enforced, await mintJwt({}))).status).toBe(200);
  });

  test('explicitPhaseInStillAcceptsLegacyTokens', async () => {
    expect((await me(phaseIn, await mintJwt({ iss: null, aud: null }))).status).toBe(200);
    expect((await me(phaseIn, await mintJwt({ iss: 'https://evil.example' }))).status).toBe(401);
  });
});

describe('IssuerAudienceValidatorTest', () => {
  test('phaseIn_rejectsWrongAudienceWhenPresent', async () => {
    expect((await me(phaseIn, await mintJwt({ iss: null, aud: 'other-api' }))).status).toBe(401);
  });
  test('enforced_acceptsMatchingClaims', async () => {
    expect((await me(enforced, await mintJwt({ aud: ['ceitba-api', 'x'] }))).status).toBe(200);
  });
});
