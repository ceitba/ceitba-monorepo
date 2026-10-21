// Ports of the auth unit tests: AuthIT allowlist checks, SessionAllowlistTest,
// ApiKeyFilterTest, SafeRedirectTest, CookieOrHeaderBearerTokenResolverTest,
// AuthControllerLogoutTest, IssuerAudienceValidatorTest (via verifyJwt).
import { describe, expect, test } from 'bun:test';
import { SignJWT } from 'jose';
import { loadConfig } from '../../src/config';
import { admits, sessionAdmits } from '../../src/http/auth/allowlist';
import { normalizeScopes, parseScopes, scopeDenial, scopeFromKey, scopeKeys, serializeScopes } from '../../src/http/auth/apikeys';
import { clearSessionCookies } from '../../src/http/auth/cookies';
import { verifyJwt } from '../../src/http/auth/jwt';
import { matchUrlRule } from '../../src/http/auth/policy';
import { keyIsFullPower, type ValidatedKey } from '../../src/http/auth/principal';
import { isTokenEndpoint, resolveBearer, syncKeyMatches } from '../../src/http/security';
import { isSafeRedirect, withError } from '../../src/features/auth/redirects';
import { TEST_JWT_SECRET } from '../../contract/support/env';

const SECRET = TEST_JWT_SECRET;
const cfg = (env: Record<string, string> = {}) => loadConfig({ AUTH_JWT_SECRET: SECRET, AUTH_ALLOWED_DOMAINS: 'itba.edu.ar', AUTH_ALLOWED_EMAILS: 'external@gmail.com', ...env });

describe('AuthIT allowlist', async () => {
  const auth = (await cfg()).auth;
  test('allowlistAdmitsItbaDomain', () => expect(admits(auth, 'alice@itba.edu.ar')).toBe(true));
  test('allowlistAdmitsExplicitlyListedExternalEmail', () => expect(admits(auth, 'external@gmail.com')).toBe(true));
  test('allowlistRejectsUnknownDomain', () => expect(admits(auth, 'bob@gmail.com')).toBe(false));
  test('allowlistIsCaseInsensitive', () => {
    expect(admits(auth, 'ALICE@ITBA.EDU.AR')).toBe(true);
    expect(admits(auth, 'External@Gmail.com')).toBe(true);
  });
});

describe('SessionAllowlistTest', () => {
  test('admitsTheReviewEmailOnlyWhileReviewLoginIsEnabled', async () => {
    const hash = '$2a$04$' + 'a'.repeat(53);
    expect(sessionAdmits((await cfg({ REVIEW_LOGIN_EMAIL: 'r@x.com', REVIEW_LOGIN_PASSWORD_HASH: hash })).auth, 'R@x.com')).toBe(true);
    expect(sessionAdmits((await cfg({ REVIEW_LOGIN_EMAIL: 'r@x.com' })).auth, 'r@x.com')).toBe(false);
    expect(admits((await cfg({ REVIEW_LOGIN_EMAIL: 'r@x.com', REVIEW_LOGIN_PASSWORD_HASH: hash })).auth, 'r@x.com')).toBe(false);
  });
});

describe('ApiKeyFilterTest', () => {
  test('exactSyncKeyGrantsRoleSync', () => expect(syncKeyMatches('s3cret', 's3cret')).toBe(true));
  test('wrongOrPartialKeyGrantsNothing', () => {
    for (const k of ['s3cre', 's3cret2', 'S3CRET', '']) expect(syncKeyMatches('s3cret', k)).toBe(false);
  });
  // AUTH_SYNC_API_KEY defaults to empty: an empty header must not match it.
  test('unsetSyncKeyNeverMatches', () => {
    expect(syncKeyMatches('', '')).toBe(false);
    expect(syncKeyMatches(null, 'anything')).toBe(false);
  });
  const key = (...scopes: ('read' | 'report' | 'write' | 'staff' | 'keys')[]): ValidatedKey => ({ keyId: crypto.randomUUID(), user: null as never, scopes: normalizeScopes(scopes) });
  test('anyKeyMayRevokeItselfButNoOtherKey', () => {
    const self = key('read');
    expect(scopeDenial(self, 'DELETE', `/v1/auth/api-keys/${self.keyId}`)).toBeNull();
    expect(scopeDenial(self, 'DELETE', `/v1/auth/api-keys/${crypto.randomUUID()}`)).not.toBeNull();
  });
  test('readOnlyKeysOnlyPassSafeMethodsAndReadStyleQueries', () => {
    const read = key('read');
    expect(scopeDenial(read, 'GET', '/v1/me/schedules')).toBeNull();
    expect(scopeDenial(read, 'HEAD', '/v1/articles')).toBeNull();
    expect(scopeDenial(read, 'POST', '/v1/classrooms/conflicts')).toBeNull();
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) expect(scopeDenial(read, m, '/v1/me/schedules')).not.toBeNull();
    expect(scopeDenial(key('write'), 'POST', '/v1/me/schedules')).toBeNull();
  });
  test('anEncodedSelfRevokePathIsNotExempt', () => {
    const self = key('read');
    expect(scopeDenial(self, 'DELETE', `/v1/auth/api%2Dkeys/${self.keyId}`)).not.toBeNull();
  });
  test('scopesParseNormalizeAndSort', () => {
    expect(scopeKeys(parseScopes(''))).toEqual(['read', 'report', 'write', 'staff', 'keys']);
    expect(scopeKeys(parseScopes('staff'))).toEqual(['read', 'staff']);
    expect(scopeKeys(normalizeScopes(['write']))).toEqual(['read', 'report', 'write']);
    expect(scopeKeys(normalizeScopes([]))).toEqual(['read']);
  });
});

describe('ApiKeyScopeTest', () => {
  test('nullMeansFullPowerEmptyMeansReadOnlyAndReadIsImplied', () => {
    expect(scopeKeys(normalizeScopes(null))).toEqual(['read', 'report', 'write', 'staff', 'keys']);
    expect(scopeKeys(normalizeScopes([]))).toEqual(['read']);
    expect(scopeKeys(normalizeScopes(['staff']))).toEqual(['read', 'staff']);
  });
  test('roundTripsThroughTheColumn', () => {
    expect(serializeScopes(new Set(['read', 'staff'] as const))).toBe('read,staff');
    expect(scopeKeys(parseScopes('read,staff'))).toEqual(['read', 'staff']);
    expect(scopeKeys(parseScopes('read,write,staff'))).toEqual(['read', 'report', 'write', 'staff']);
    expect(scopeKeys(parseScopes('keys,read,staff,write'))).toEqual(['read', 'report', 'write', 'staff', 'keys']);
    expect(serializeScopes(normalizeScopes(null))).toBe('read,report,write,staff,keys');
    expect(scopeKeys(parseScopes('read,report'))).toEqual(['read', 'report']);
    expect(scopeKeys(parseScopes(' WRITE '))).toEqual(['read', 'report', 'write']);
  });
  // apps/mcp gives staff read, report, staff and write: never full power.
  test('everyScopeButKeysIsNotFullPower', () => {
    expect(keyIsFullPower({ keyId: 'k', user: null as never, scopes: normalizeScopes(['report', 'staff', 'write']) })).toBe(false);
    expect(keyIsFullPower({ keyId: 'k', user: null as never, scopes: normalizeScopes(null) })).toBe(true);
  });
  test('unknownScopeIsRejected', () => {
    expect(scopeFromKey('admin')).toBeNull();
    expect(() => parseScopes('read,admin')).toThrow();
  });
});

describe('SafeRedirectTest', () => {
  test.each(['https://ceitba.org.ar', 'https://ceitba.org.ar/', 'https://ceitba.org.ar/manage?tab=1#x', 'https://CEITBA.org.ar/manage',
    'https://ceitba.org.ar:443/manage', 'http://localhost:3000/callback', 'http://localhost:5175'])('acceptsAllowedOrigins %s', (u) => expect(isSafeRedirect(u)).toBe(true));
  test.each(['', ' ', 'https://ceitba.org.ar.evil.com', 'https://ceitba.org.ar.evil.com/manage', 'https://ceitba.org.ar@evil.com/',
    'https://user@ceitba.org.ar/', 'https://ceitba.org.ar:8443/', 'http://ceitba.org.ar/', 'http://localhost:30001/',
    'http://localhost:3000.evil.com/', 'https://ceitba.org.ar\\@evil.com', '//ceitba.org.ar/manage', '/manage', 'javascript:alert(1)',
    'https://evil.com/?https://ceitba.org.ar'])('rejectsEverythingElse %p', (u) => expect(isSafeRedirect(u)).toBe(false));
  test('rejectsNull', () => expect(isSafeRedirect(null)).toBe(false));
  test('withError', () => {
    expect(withError('https://ceitba.org.ar', 'invalid_state')).toBe('https://ceitba.org.ar?error=invalid_state');
    expect(withError('https://ceitba.org.ar/manage?tab=2', 'x')).toBe('https://ceitba.org.ar/manage?tab=2&error=x');
  });
});

describe('CookieOrHeaderBearerTokenResolverTest', () => {
  const resolve = (method: string, path: string) =>
    resolveBearer(new Request(`http://x/api${path}`, { method, headers: { Cookie: 'ceitba_session=jwt' } }), method, path, 'ceitba_session');
  test('staffMailAccountEndpointsUseTheSessionCookie', () => {
    expect(resolve('GET', '/v1/mail/accounts')).toBe('jwt');
    expect(resolve('POST', '/v1/mail/accounts/ceitba/connect')).toBe('jwt');
    expect(resolve('DELETE', '/v1/mail/accounts/123')).toBe('jwt');
  });
  test('trackingAndOauthCallbackIgnoreTheSessionCookie', () => {
    expect(resolve('GET', '/v1/mail/o/abc.gif')).toBeNull();
    expect(resolve('GET', '/v1/mail/c/abc/def')).toBeNull();
    expect(resolve('GET', '/v1/mail/accounts/oauth/callback')).toBeNull();
  });
  test('tokenEndpointsAreRawPathAndMethodSpecific', () => {
    expect(isTokenEndpoint('POST', '/v1/auth/refresh')).toBe(true);
    expect(isTokenEndpoint('GET', '/v1/auth/refresh')).toBe(false);
    expect(isTokenEndpoint('POST', '/v1/auth/refres%68')).toBe(false);
  });
});

describe('AuthControllerLogoutTest', () => {
  test('logoutExpiresBothDomainScopedAndHostOnlyCookies', async () => {
    const cookies = clearSessionCookies((await cfg({ AUTH_COOKIE_DOMAIN: 'ceitba.org.ar' })).auth);
    expect(cookies).toHaveLength(2);
    for (const c of cookies) expect(c.startsWith('ceitba_session=;') && c.includes('Max-Age=0') && c.includes('Path=/')).toBe(true);
    expect(cookies.some((c) => c.includes('Domain=ceitba.org.ar'))).toBe(true);
    expect(cookies.some((c) => !c.includes('Domain='))).toBe(true);
  });
  test('logoutWithoutConfiguredDomainSendsSingleHostOnlyClear', async () => {
    const cookies = clearSessionCookies((await cfg()).auth);
    expect(cookies).toHaveLength(1);
    expect(cookies[0]!.includes('Domain=')).toBe(false);
  });
});

describe('IssuerAudienceValidatorTest', async () => {
  const enforced = (await cfg()).auth;
  const phaseIn = (await cfg({ AUTH_JWT_ENFORCE_ISS_AUD: 'false' })).auth;
  const now = Date.now() * 1000;
  const jwt = (claims: Record<string, unknown>) => new SignJWT({ email: 'alice@itba.edu.ar', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60, ...claims })
    .setProtectedHeader({ alg: 'HS256' }).sign(Buffer.from(SECRET, 'base64'));
  const ok = async (auth: typeof enforced, claims: Record<string, unknown>) => verifyJwt(auth, await jwt(claims), now).then(() => true, () => false);
  test('phaseIn_acceptsLegacyTokenWithoutIssOrAud', async () => expect(await ok(phaseIn, {})).toBe(true));
  test('phaseIn_acceptsMatchingIssAndAud', async () => expect(await ok(phaseIn, { iss: 'https://ceitba.org.ar/api', aud: ['ceitba-api'] })).toBe(true));
  test('phaseIn_rejectsWrongIssuerWhenPresent', async () => expect(await ok(phaseIn, { iss: 'https://evil.example' })).toBe(false));
  test('phaseIn_rejectsWrongAudienceWhenPresent', async () => expect(await ok(phaseIn, { aud: ['other-api'] })).toBe(false));
  test('enforced_rejectsLegacyTokenWithoutClaims', async () => {
    expect(await ok(enforced, {})).toBe(false);
    expect(await ok(enforced, { iss: 'https://ceitba.org.ar/api' })).toBe(false);
  });
  test('enforced_acceptsMatchingClaims', async () => expect(await ok(enforced, { iss: 'https://ceitba.org.ar/api', aud: ['ceitba-api', 'x'] })).toBe(true));
});

describe('SecurityConfig URL rules', () => {
  const rule = (m: string, p: string, devLogin = false) => matchUrlRule(m, p, { devLogin }).access;
  test('matchers', () => {
    expect(rule('GET', '/v1/careers')).toBe('permitAll');
    expect(rule('GET', '/v1/careers/S/x')).toBe('permitAll');
    expect(rule('HEAD', '/v1/careers')).toBe('authenticatedAllowlisted');
    expect(rule('POST', '/v1/careers')).toBe('authenticatedAllowlisted');
    expect(rule('GET', '/v1/wiki/bookmarks/93.12')).toBe('permitAll');
    expect(rule('POST', '/v1/wiki/bookmarks/93.12')).toBe('authenticatedAllowlisted');
    expect(rule('GET', '/v1/staff/proposals')).toEqual({ role: 'MODERATOR', allowlisted: true });
    expect(rule('GET', '/v1/staff')).toEqual({ role: 'STAFF', allowlisted: true });
    expect(rule('POST', '/v1/sync/all')).toEqual({ role: 'SYNC' });
    expect(rule('POST', '/v1/auth/dev-login')).toBe('authenticatedAllowlisted');
    expect(rule('POST', '/v1/auth/dev-login', true)).toBe('permitAll');
    expect(rule('GET', '/')).toBe('permitAll');
    expect(rule('GET', '/v1/highlights/all')).toBe('authenticatedAllowlisted');
  });
});
