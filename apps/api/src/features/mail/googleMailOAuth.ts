// Port of apps/api/src/main/java/org/ceitba/api/service/mail/GoogleMailOAuthClient.java.
//
// Google OAuth for the sender accounts: authorization URL, code exchange,
// refresh-token -> access-token, revoke. Same OAuth client as the login flow
// (auth.google.*), its own redirect URI (mail.oauth.redirect-uri). Tokens are
// never logged; error messages carry only Google's error code.
// Tests replace exchangeCode / refresh / revoke on the instance (the IT's @SpyBean).

import type { Config } from '../../config';
import type { Clock } from '../../infra/clock';
import { javaIsBlank } from '../../lib/javaCompat';
import { GoogleOAuthError, type GoogleTokens } from './logic/types';

export const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
export const SCOPE_SEND = 'https://www.googleapis.com/auth/gmail.send';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

export interface IdClaims { email: string; emailVerified: boolean; hd: string | null }

/** UriComponentsBuilder.encode() of a query parameter value (HierarchicalUriComponents.Type.QUERY_PARAM). */
export function encodeQueryParam(s: string): string {
  let out = '';
  for (const b of new TextEncoder().encode(s)) {
    const c = String.fromCharCode(b);
    const allowed = b < 0x80 && c !== '=' && c !== '&' && /[A-Za-z0-9\-._~!$'()*+,;:@/?]/.test(c);
    out += allowed ? c : `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

function b64urlJson(part: string): Record<string, unknown> {
  const v = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as unknown;
  if (v == null || typeof v !== 'object' || Array.isArray(v)) throw new Error('claims');
  return v as Record<string, unknown>;
}

export class GoogleMailOAuthClient {
  constructor(private readonly config: Config, private readonly redirectUri: string, private readonly clock: Clock,
              private readonly http: typeof fetch = globalThis.fetch) {}

  configured(): boolean {
    const g = this.config.auth.google;
    return g != null && notBlank(g.clientId) && notBlank(g.clientSecret) && !javaIsBlank(this.redirectUri);
  }

  /**
   * access_type=offline + prompt=consent: Google always returns a refresh token.
   * extraScopes: the CEITBA account also asks for the directory (subject reviews name professors with it).
   */
  authorizationUri(state: string, loginHint: string | null, hostedDomain: string | null, extraScopes: string[] = []): string {
    const q: [string, string][] = [
      ['response_type', 'code'],
      ['client_id', this.config.auth.google.clientId],
      ['redirect_uri', this.redirectUri],
      ['scope', [SCOPE_SEND, 'openid', 'email', ...extraScopes].join(' ')],
      ['state', state],
      ['access_type', 'offline'],
      ['prompt', 'consent'],
    ];
    if (loginHint != null) q.push(['login_hint', loginHint]);
    if (hostedDomain != null) q.push(['hd', hostedDomain]);
    return `${AUTH_ENDPOINT}?${q.map(([k, v]) => `${encodeQueryParam(k)}=${encodeQueryParam(v)}`).join('&')}`;
  }

  exchangeCode(code: string): Promise<GoogleTokens> {
    return this.tokens([['grant_type', 'authorization_code'], ['code', code], ['redirect_uri', this.redirectUri]]);
  }

  /** Throws GoogleOAuthError INVALID_GRANT when the refresh token was revoked/expired, TRANSPORT on network and 5xx. */
  refresh(refreshToken: string): Promise<GoogleTokens> {
    return this.tokens([['grant_type', 'refresh_token'], ['refresh_token', refreshToken]]);
  }

  /** Best effort: failures are swallowed (the row is deleted anyway). */
  async revoke(token: string): Promise<void> {
    try {
      const res = await this.http(REVOKE_ENDPOINT, {
        method: 'POST', body: new URLSearchParams({ token }), signal: AbortSignal.timeout(20_000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      await res.arrayBuffer().catch(() => undefined);
    } catch {
      // best effort
    }
  }

  /**
   * The id_token comes straight from Google's token endpoint over TLS (as in the
   * login flow), so its signature is not re-verified; its claims are: iss, aud =
   * our client id, exp, and a verified email.
   */
  parseIdToken(idToken: string | null): IdClaims {
    try {
      if (idToken == null) throw new Error('null');
      const parts = idToken.split('.');
      if (parts.length !== 3) throw new Error('jws');
      b64urlJson(parts[0]!);
      const claims = b64urlJson(parts[1]!);
      if (typeof claims.iss !== 'string' || !ISSUERS.has(claims.iss)) throw new Error('iss');
      const aud = typeof claims.aud === 'string' ? [claims.aud] : Array.isArray(claims.aud) ? claims.aud : null;
      if (aud == null || !aud.includes(this.config.auth.google.clientId)) throw new Error('aud');
      if (typeof claims.exp !== 'number' || claims.exp * 1_000_000 < this.clock.now()) throw new Error('exp');
      const email = claims.email;
      if (email !== undefined && email !== null && typeof email !== 'string') throw new Error('email type');
      if (email == null || javaIsBlank(email)) throw new Error('email');
      const verified = claims.email_verified;
      if (verified !== undefined && verified !== null && typeof verified !== 'boolean') throw new Error('email_verified type');
      const hd = claims.hd;
      if (hd !== undefined && hd !== null && typeof hd !== 'string') throw new Error('hd type');
      return { email, emailVerified: verified === true, hd: (hd as string | undefined) ?? null };
    } catch (e) {
      throw new GoogleOAuthError('REJECTED', `Invalid Google id_token (${(e as Error).message})`);
    }
  }

  private async tokens(form: [string, string][]): Promise<GoogleTokens> {
    const g = this.config.auth.google;
    const body = new URLSearchParams([...form, ['client_id', g.clientId], ['client_secret', g.clientSecret]]);
    let res: Response;
    let text: string;
    try {
      // SimpleClientHttpRequestFactory: connect 5 s, read 15 s.
      res = await this.http(TOKEN_ENDPOINT, {
        method: 'POST', body, signal: AbortSignal.timeout(20_000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      });
      text = await res.text();
    } catch {
      throw new GoogleOAuthError('TRANSPORT', 'Google token endpoint unreachable');
    }
    if (res.status >= 500) throw new GoogleOAuthError('TRANSPORT', `Google token endpoint HTTP ${res.status}`);
    if (res.status >= 400) {
      const code = errorCode(text);
      throw new GoogleOAuthError(code === 'invalid_grant' ? 'INVALID_GRANT' : 'REJECTED', `Google token endpoint: ${code}`);
    }
    let r: Record<string, unknown> | null;
    try {
      r = text.trim() === '' ? null : (JSON.parse(text) as Record<string, unknown>);
    } catch {
      throw new GoogleOAuthError('TRANSPORT', 'Google token endpoint unreachable');
    }
    if (r == null || typeof r.access_token !== 'string') throw new GoogleOAuthError('TRANSPORT', 'Empty token response');
    const str = (v: unknown) => (typeof v === 'string' ? v : null);
    return {
      accessToken: r.access_token,
      refreshToken: str(r.refresh_token),
      idToken: str(r.id_token),
      scope: str(r.scope),
      expiresIn: typeof r.expires_in === 'number' ? r.expires_in : 3600,
    };
  }
}

function errorCode(body: string): string {
  try {
    const e = JSON.parse(body) as { error?: unknown };
    return typeof e?.error === 'string' ? e.error : 'unknown';
  } catch {
    return 'unknown';
  }
}

const notBlank = (s: string | null | undefined) => s != null && !javaIsBlank(s);
