// Google sign-in: the web OAuth code flow (service/auth/GoogleOAuthService)
// and the mobile ID-token verifier (service/auth/JwksGoogleIdTokenVerifier).
// Both are interfaces so tests can stub the exchange (AuthOAuthFlowIT) and sign
// "Google" tokens with a local RSA key (TestGoogleIdTokens).

import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';

type KeyLike = CryptoKey;
import type { AuthConfig } from '../config/sections/auth';
import { FeatureNotConfiguredError, InvalidTokenError } from '../http/errors';

export interface IdTokenClaims {
  sub: string | null;
  email: string | null;
  name: string | null;
  picture: string | null;
  emailVerified: boolean;
  hd: string | null;
}

export interface GoogleOAuthClient {
  /** https://accounts.google.com/o/oauth2/v2/auth?... (exactly Java's query order and encoding). */
  buildAuthorizationUri(state: string): string;
  /** Exchanges the code at Google's token endpoint and decodes (does not re-verify) the id_token. */
  exchangeCode(code: string): Promise<IdTokenClaims>;
}

export interface GoogleIdTokenVerifier {
  /** Throws InvalidTokenError (401) or FeatureNotConfiguredError (501 when no audiences). */
  verify(idToken: string, expectedNonce: string | null): Promise<IdTokenClaims>;
}

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const SCOPE = 'openid email profile';
export const GOOGLE_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';
export const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

/**
 * UriComponentsBuilder.queryParam(...).build().toUri(): Spring encodes each
 * query value with HierarchicalUriComponents' QUERY_PARAM rules. Only
 * characters illegal in a query param are encoded; `:` `/` `@` `?` stay, a
 * space becomes %20, `&` `=` `+` `#` are encoded.
 */
export function springQueryEncode(v: string): string {
  let out = '';
  for (const ch of v) {
    if (/[A-Za-z0-9\-._~!$'()*,;:@/?]/.test(ch)) out += ch;
    else out += [...new TextEncoder().encode(ch)].map((b) => `%${b.toString(16).toUpperCase().padStart(2, '0')}`).join('');
  }
  return out;
}

const formEnc = (v: string | null | undefined) => (v == null ? '' : encodeURIComponent(v).replace(/%20/g, '+').replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`));

function claimsOf(p: Record<string, unknown>): IdTokenClaims {
  const s = (v: unknown) => (typeof v === 'string' ? v : v == null ? null : String(v));
  return {
    sub: s(p.sub), email: s(p.email), name: s(p.name), picture: s(p.picture),
    emailVerified: p.email_verified === true, hd: s(p.hd),
  };
}

export class HttpGoogleOAuthClient implements GoogleOAuthClient {
  constructor(private readonly auth: AuthConfig) {}

  buildAuthorizationUri(state: string): string {
    const g = this.auth.google;
    const params: [string, string][] = [
      ['response_type', 'code'],
      ['client_id', g.clientId],
      ['redirect_uri', g.redirectUri],
      ['scope', SCOPE],
      ['state', state],
      ['access_type', 'offline'],
    ];
    // hd= hint pre-filters Google's account picker; the hd claim is what is enforced.
    const hint = this.auth.allowedDomains[0];
    if (hint !== undefined) params.push(['hd', hint]);
    return `${AUTH_ENDPOINT}?${params.map(([k, v]) => `${k}=${springQueryEncode(v)}`).join('&')}`;
  }

  async exchangeCode(code: string): Promise<IdTokenClaims> {
    const g = this.auth.google;
    const body = `grant_type=authorization_code&code=${formEnc(code)}&redirect_uri=${formEnc(g.redirectUri)}`
      + `&client_id=${formEnc(g.clientId)}&client_secret=${formEnc(g.clientSecret)}`;
    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} from POST ${TOKEN_ENDPOINT}`);
    const json = (await res.json()) as { id_token?: string };
    try {
      const payload = JSON.parse(Buffer.from(String(json.id_token).split('.')[1]!, 'base64url').toString('utf8'));
      return claimsOf(payload);
    } catch (e) {
      throw new Error('Failed to parse Google id_token', { cause: e });
    }
  }
}

/**
 * JwksGoogleIdTokenVerifier: RS256 against Google's JWKS (5 s timeout, keys
 * cached 5 min, refetch at most every 30 s), iss in GOOGLE_ISSUERS,
 * aud ∩ AUTH_GOOGLE_MOBILE_AUDIENCES, exp required (60 s skew), nonce when sent,
 * email and sub required.
 */
/**
 * How Google's JWKS is fetched: 5 s timeout (Java: 3 s connect + 5 s read; fetch has one
 * timeout), keys cached 5 min, and an unknown `kid` refetches at most every 30 s, so tokens
 * with made-up key ids never trigger a download each.
 */
export const GOOGLE_JWKS_OPTIONS = { timeoutDuration: 5000, cooldownDuration: 30_000, cacheMaxAge: 5 * 60_000 } as const;

/** JwksGoogleIdTokenVerifier.googleJwkSource (the URL is a parameter for tests). */
export function googleJwkSet(url: string = GOOGLE_JWKS): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(url), GOOGLE_JWKS_OPTIONS);
}

export class JwksGoogleIdTokenVerifier implements GoogleIdTokenVerifier {
  private readonly keys: JWTVerifyGetKey | KeyLike | Uint8Array;
  constructor(private readonly auth: AuthConfig, keys?: JWTVerifyGetKey | KeyLike) {
    this.keys = keys ?? googleJwkSet();
  }

  async verify(idToken: string, expectedNonce: string | null): Promise<IdTokenClaims> {
    const audiences = this.auth.google.mobileAudiences;
    if (audiences.length === 0) {
      throw new FeatureNotConfiguredError('Mobile Google login is not configured (AUTH_GOOGLE_MOBILE_AUDIENCES is empty)');
    }
    let payload: JWTPayload;
    try {
      if (decodeProtectedHeader(idToken).alg !== 'RS256') throw new Error('alg');
      const r = await jwtVerify(idToken, this.keys as JWTVerifyGetKey, {
        algorithms: ['RS256'], clockTolerance: 60, issuer: GOOGLE_ISSUERS, audience: audiences,
      });
      payload = r.payload;
      if (payload.exp === undefined) throw new Error('The exp claim is required');
    } catch {
      throw new InvalidTokenError('Google ID token is invalid');
    }
    if (expectedNonce !== null && expectedNonce !== (payload as Record<string, unknown>).nonce) {
      throw new InvalidTokenError('Google ID token is invalid');
    }
    const claims = claimsOf(payload as Record<string, unknown>);
    if (!claims.email || claims.email.trim() === '' || claims.sub === null) {
      throw new InvalidTokenError('Google ID token is invalid');
    }
    return claims;
  }
}

/** Test double for the web flow: the exchange returns fixed claims and counts calls. */
export class StubGoogleOAuthClient implements GoogleOAuthClient {
  exchanges = 0;
  constructor(private readonly delegate: GoogleOAuthClient, public claims: IdTokenClaims) {}
  buildAuthorizationUri(state: string) { return this.delegate.buildAuthorizationUri(state); }
  async exchangeCode(): Promise<IdTokenClaims> {
    this.exchanges++;
    return this.claims;
  }
}

export interface GoogleClients {
  oauth: GoogleOAuthClient;
  idTokens: GoogleIdTokenVerifier;
}

export function createGoogleClients(auth: AuthConfig): GoogleClients {
  return { oauth: new HttpGoogleOAuthClient(auth), idTokens: new JwksGoogleIdTokenVerifier(auth) };
}
