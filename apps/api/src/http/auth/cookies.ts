// web/auth/SessionCookies + Spring's ResponseCookie.toString format:
//   name=value; Path=/; Domain=d; Max-Age=N; Expires=<RFC 1123>; Secure; HttpOnly; SameSite=Lax

import type { AuthConfig } from '../../config/sections/auth';

export interface CookieSpec {
  name: string;
  value: string;
  path?: string;
  domain?: string;
  maxAgeSeconds?: number;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: string;
}

export function formatCookie(c: CookieSpec, nowMs = Date.now()): string {
  let s = `${c.name}=${c.value}`;
  if (c.path) s += `; Path=${c.path}`;
  if (c.domain) s += `; Domain=${c.domain}`;
  if (c.maxAgeSeconds !== undefined && c.maxAgeSeconds >= 0) {
    s += `; Max-Age=${c.maxAgeSeconds}`;
    const millis = c.maxAgeSeconds > 0 ? nowMs + c.maxAgeSeconds * 1000 : 0;
    s += `; Expires=${new Date(millis).toUTCString()}`;
  }
  if (c.secure) s += '; Secure';
  if (c.httpOnly) s += '; HttpOnly';
  if (c.sameSite) s += `; SameSite=${c.sameSite}`;
  return s;
}

/** SessionCookies.issue: the session JWT cookie (AUTH_JWT_TTL_DAYS, 7 when <= 0). */
export function sessionCookie(auth: AuthConfig, token: string): string {
  const ttlDays = auth.jwt.ttlDays > 0 ? auth.jwt.ttlDays : 7;
  return formatCookie({
    name: auth.cookie.name, value: token, httpOnly: true, secure: auth.cookie.secure, path: auth.cookie.path,
    sameSite: auth.cookie.sameSite, maxAgeSeconds: ttlDays * 86_400, domain: auth.cookie.domain,
  });
}

/** SessionCookies.clearHeaders: expire the Domain-scoped cookie and the host-only one. */
export function clearSessionCookies(auth: AuthConfig): string[] {
  const clear = (domain?: string) => formatCookie({
    name: auth.cookie.name, value: '', httpOnly: true, secure: auth.cookie.secure, path: auth.cookie.path,
    sameSite: auth.cookie.sameSite, maxAgeSeconds: 0, domain,
  });
  return auth.cookie.domain ? [clear(auth.cookie.domain), clear()] : [clear()];
}

export function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq >= 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}
