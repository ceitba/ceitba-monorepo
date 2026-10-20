// The Spring Security filter chain, in its order:
//   HeaderWriterFilter (headers on every response, written at commit)
//   CorsFilter         (SecurityConfig.corsSource)
//   RateLimitFilter    (right after CORS, before any authentication work)
//   ApiKeyFilter       (X-Api-Key: ceitba_ user keys / AUTH_SYNC_API_KEY)
//   BearerTokenAuthenticationFilter (Authorization: Bearer, else the session cookie)
//   AuthorizationFilter (URL_RULES)

import { timingSafeEqual } from 'node:crypto';
import type { Deps } from '../deps';
import { formatInstant, systemNowMicros } from '../lib/time';
import { toJavaJson } from '../lib/json';
import { API_KEY_HEADER, API_KEY_PREFIX, INSUFFICIENT_SCOPE, scopeDenial, validateApiKey } from './auth/apikeys';
import { sessionAdmits } from './auth/allowlist';
import { JwtValidationFailure, stringClaim, verifyJwt } from './auth/jwt';
import { matchUrlRule } from './auth/policy';
import { hasRole, keyHas, type Principal, type Role } from './auth/principal';
import { findUserByEmail, isActiveModerator, isActiveStaff, membershipsOf } from './auth/repo';
import type { RequestState } from './context';
import type { IpRateLimiter } from './ratelimit';

// ------------------------------------------------------------------ headers

/** Spring Security's default response headers (no HSTS: the app sees plain HTTP behind Caddy). */
export function applySecurityHeaders(res: Response): Response {
  const h = res.headers;
  if (!h.has('X-Content-Type-Options')) h.set('X-Content-Type-Options', 'nosniff');
  if (!h.has('X-XSS-Protection')) h.set('X-XSS-Protection', '0');
  // CacheControlHeadersWriter: skipped when the controller set any cache header, or on 304.
  if (res.status !== 304 && !h.has('Cache-Control') && !h.has('Expires') && !h.has('Pragma')) {
    h.set('Cache-Control', 'no-cache, no-store, max-age=0, must-revalidate');
    h.set('Pragma', 'no-cache');
    h.set('Expires', '0');
  }
  if (!h.has('X-Frame-Options')) h.set('X-Frame-Options', 'DENY');
  return res;
}

// --------------------------------------------------------------------- CORS

export const CORS_ALLOWED_ORIGINS = [
  'https://ceitba.org.ar',
  'https://itbanews.ar', 'https://www.itbanews.ar',
  'http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173', 'http://localhost:5175',
];
export const CORS_ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'];
export const CORS_ALLOWED_HEADERS = ['Content-Type', 'Authorization', 'X-Requested-With', API_KEY_HEADER];
const VARY = ['Origin', 'Access-Control-Request-Method', 'Access-Control-Request-Headers'];

export type CorsResult =
  | { kind: 'continue'; headers: Record<string, string> }
  | { kind: 'respond'; response: Response };

function addVary(h: Headers) {
  const existing = (h.get('Vary') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const merged = [...existing];
  for (const v of VARY) if (!existing.some((e) => e.toLowerCase() === v.toLowerCase())) merged.push(v);
  h.set('Vary', merged.join(', '));
}

/** DefaultCorsProcessor + CorsFilter: Vary always; reject = 403 "Invalid CORS request"; preflight answered here. */
export function processCors(req: Request, url: URL): CorsResult & { vary: true } {
  const origin = req.headers.get('Origin');
  const sameOrigin = origin !== null && (() => {
    try {
      const o = new URL(origin);
      return o.protocol === url.protocol && o.host === url.host;
    } catch {
      return false;
    }
  })();
  if (origin === null || sameOrigin) return { kind: 'continue', headers: {}, vary: true };
  const preflight = req.method === 'OPTIONS' && req.headers.has('Access-Control-Request-Method');
  const reject = (): CorsResult & { vary: true } => {
    const h = new Headers();
    addVary(h);
    // Spring writes the text without a Content-Type; Bun adds one to string/byte bodies, not to streams.
    const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('Invalid CORS request')); c.close(); } });
    return { kind: 'respond', response: new Response(body, { status: 403, headers: h }), vary: true };
  };
  const allowedOrigin = CORS_ALLOWED_ORIGINS.find((o) => o.toLowerCase() === origin.replace(/\/+$/, '').toLowerCase());
  if (!allowedOrigin) return reject();
  const method = preflight ? (req.headers.get('Access-Control-Request-Method') ?? '').toUpperCase() : req.method.toUpperCase();
  if (!CORS_ALLOWED_METHODS.includes(method)) return reject();
  const headers: Record<string, string> = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' };
  if (preflight) {
    const requested = (req.headers.get('Access-Control-Request-Headers') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const allowed = requested.filter((r) => CORS_ALLOWED_HEADERS.some((a) => a.toLowerCase() === r.toLowerCase()));
    if (requested.length && allowed.length !== requested.length) return reject();
    headers['Access-Control-Allow-Methods'] = CORS_ALLOWED_METHODS.join(',');
    if (allowed.length) headers['Access-Control-Allow-Headers'] = allowed.join(', ');
    const h = new Headers(headers);
    addVary(h);
    return { kind: 'respond', response: new Response(null, { status: 200, headers: h }), vary: true };
  }
  return { kind: 'continue', headers, vary: true };
}

export function withVary(res: Response): Response {
  addVary(res.headers);
  return res;
}

// ------------------------------------------------------------------ errors

export function jsonError(status: number, error: string, message: string, requestUri: string, nowMicros: number, headers: Record<string, string> = {}): Response {
  return new Response(toJavaJson({ error, message, path: requestUri, timestamp: formatInstant(nowMicros) }), {
    status, headers: { 'Content-Type': 'application/json', ...headers },
  });
}

const RFC6750 = 'https://tools.ietf.org/html/rfc6750#section-3.1';

/** BearerTokenAuthenticationEntryPoint: 401, empty body. */
export function unauthorized(invalidToken?: string): Response {
  const www = invalidToken === undefined
    ? 'Bearer'
    : `Bearer error="invalid_token", error_description="${invalidToken}", error_uri="${RFC6750}"`;
  return new Response(null, { status: 401, headers: { 'WWW-Authenticate': www } });
}

/** BearerTokenAccessDeniedHandler: 403, empty body; insufficient_scope only for JWT principals. */
export function forbidden(p: Principal): Response {
  const www = p.kind === 'jwt'
    ? `Bearer error="insufficient_scope", error_description="The request requires higher privileges than provided by the access token.", error_uri="${RFC6750}"`
    : 'Bearer';
  return new Response(null, { status: 403, headers: { 'WWW-Authenticate': www } });
}

// --------------------------------------------------------- token resolution

// CookieOrHeaderBearerTokenResolver: endpoints that never read a bearer token.
const TOKEN_ENDPOINTS = new Set(['/v1/auth/google/mobile', '/v1/auth/refresh', '/v1/auth/logout', '/v1/auth/review-login', '/v1/digests/unsubscribe']);
const TOKEN_PATHS_ANY_METHOD = new Set(['/v1/digests/correction-vote']);
const PUBLIC_MAIL_PREFIXES = ['/v1/mail/o/', '/v1/mail/c/'];
const MAIL_OAUTH_CALLBACK = '/v1/mail/accounts/oauth/callback';

export function isTokenEndpoint(method: string, rawPath: string): boolean {
  if (TOKEN_PATHS_ANY_METHOD.has(rawPath) || rawPath === MAIL_OAUTH_CALLBACK) return true;
  if (PUBLIC_MAIL_PREFIXES.some((p) => rawPath.startsWith(p))) return true;
  return method.toUpperCase() === 'POST' && TOKEN_ENDPOINTS.has(rawPath);
}

const BEARER = /^Bearer (?<token>[a-zA-Z0-9\-._~+/]+=*)$/i;

/** Returns the token, null for none, or throws JwtValidationFailure("Bearer token is malformed"). */
export function resolveBearer(req: Request, method: string, rawPath: string, cookieName: string): string | null {
  if (isTokenEndpoint(method, rawPath)) return null;
  const auth = req.headers.get('Authorization');
  if (auth && /^bearer/i.test(auth)) {
    const m = BEARER.exec(auth);
    if (!m) throw new JwtValidationFailure('Bearer token is malformed');
    return m.groups!.token!;
  }
  const cookie = req.headers.get('Cookie');
  if (!cookie) return null;
  for (const part of cookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === cookieName) {
      const v = part.slice(eq + 1).trim().replace(/^"(.*)"$/, '$1');
      return v === '' ? null : v;
    }
  }
  return null;
}

/** StaffAwareJwtAuthenticationConverter: ROLE_USER + STAFF/MODERATOR/ORG_MEMBER from the DB. */
export async function jwtRoles(deps: Deps, email: string | null): Promise<Set<Role>> {
  const roles = new Set<Role>(['USER']);
  if (email === null) return roles;
  const u = await findUserByEmail(deps.db, email);
  if (!u) return roles;
  const staff = await isActiveStaff(deps.db, u.id, systemNowMicros());
  if (staff) roles.add('STAFF');
  if (staff || (await isActiveModerator(deps.db, u.id))) roles.add('MODERATOR');
  if ((await membershipsOf(deps.db, u.id)).length > 0) roles.add('ORG_MEMBER');
  return roles;
}

/** ApiKeyFilter.authorities: ROLE_USER, STAFF/MODERATOR only with the "staff" scope. */
async function apiKeyRoles(deps: Deps, k: Parameters<typeof keyHas>[0]): Promise<Set<Role>> {
  const roles = new Set<Role>(['USER']);
  if (!keyHas(k, 'staff')) return roles;
  const staff = await isActiveStaff(deps.db, k.user.id, systemNowMicros());
  if (staff) roles.add('STAFF');
  if (staff || (await isActiveModerator(deps.db, k.user.id))) roles.add('MODERATOR');
  return roles;
}

function constantTimeEquals(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

/** Session allowlist gate (SecurityConfig.emailAllowlisted). The sync principal passes. */
export function allowlisted(deps: Deps, p: Principal): boolean {
  if (p.kind === 'jwt') return sessionAdmits(deps.config.auth, stringClaim(p.claims, 'email'));
  if (p.kind === 'apiKey') return sessionAdmits(deps.config.auth, p.key.user.email);
  return true;
}

/**
 * Runs ApiKeyFilter, the bearer filter and the URL authorization. Returns a
 * Response to send right away (401/403), or null to continue to routing.
 */
export async function authenticateAndAuthorize(deps: Deps, req: Request, state: RequestState, limiter: IpRateLimiter): Promise<Response | null> {
  // Instant.now()/OffsetDateTime.now() in Java (system time, not the injected Clock).
  const now = systemNowMicros();
  // RateLimitFilter (after CORS, before authentication).
  const rl = limiter.check(state.method, state.rawPath, state.clientIp);
  if (rl) {
    Object.assign(state.extraHeaders, rl.headers);
    if (rl.rejected) {
      return jsonError(429, 'TooManyRequests', `Rate limit exceeded. Retry in ${rl.rejected.retryAfterSeconds}s.`, state.requestUri, now, rl.headers);
    }
  }

  // ApiKeyFilter.
  const key = req.headers.get(API_KEY_HEADER);
  if (key !== null) {
    if (key.startsWith(API_KEY_PREFIX)) {
      const validated = await validateApiKey(deps.db, key, now);
      if (validated) {
        const denial = scopeDenial(validated, state.method, state.rawPath);
        if (denial) return jsonError(403, INSUFFICIENT_SCOPE, denial, state.requestUri, now);
        state.principal = { kind: 'apiKey', key: validated, roles: await apiKeyRoles(deps, validated) };
      }
    } else if (deps.config.auth.syncApiKey.trim() !== '' && constantTimeEquals(key, deps.config.auth.syncApiKey)) {
      state.principal = { kind: 'sync', roles: new Set<Role>(['SYNC']) };
    }
  }

  // BearerTokenAuthenticationFilter: a resolved token always authenticates
  // (replacing an API-key authentication); a bad one is a 401 even on public routes.
  let token: string | null;
  try {
    token = resolveBearer(req, state.method, state.rawPath, deps.config.auth.cookie.name);
  } catch (e) {
    return unauthorized((e as JwtValidationFailure).description);
  }
  if (token !== null) {
    try {
      const claims = await verifyJwt(deps.config.auth, token, now);
      const email = stringClaim(claims, 'email');
      state.principal = { kind: 'jwt', token, claims, email, roles: await jwtRoles(deps, email) };
    } catch (e) {
      if (e instanceof JwtValidationFailure) return unauthorized(e.description);
      throw e;
    }
  }

  // AuthorizationFilter.
  const rule = matchUrlRule(state.method, state.path, { devLogin: deps.config.auth.devLoginEnabled });
  const p = state.principal;
  const anonymous = p.kind === 'anonymous';
  const access = rule.access;
  if (access === 'permitAll') return null;
  if (access === 'authenticatedAllowlisted') {
    if (anonymous) return unauthorized();
    return allowlisted(deps, p) ? null : forbidden(p);
  }
  const granted = hasRole(p, access.role) && (!access.allowlisted || allowlisted(deps, p));
  if (granted) return null;
  return anonymous ? unauthorized() : forbidden(p);
}
