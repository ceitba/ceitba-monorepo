// Port of apps/api/src/main/java/org/ceitba/api/service/mail/MailOAuthStateService.java.
//
// Signed, short-lived OAuth `state` of the sender-account connect flow; binds
// the user who started it and, for an organization's account, the org:
//   state = b64url(userId|expiresAtEpochSec|nonce[|orgSlug]) + "." + b64url(HMAC-SHA256)
// The key is the (base64-decoded) JWT secret under its own domain prefix
// "ceitba-mail-oauth-state:", so it can never be confused with a login state
// or a session JWT.
//
// Browser binding (not in Java): the nonce inside the state is also set as an HttpOnly cookie
// (MAIL_OAUTH_NONCE_COOKIE) by the connect call, and the callback requires the two to match. Without it an org admin
// could send the consent URL to someone else and make that person's mailbox the org's sender.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AuthConfig } from '../../../config/sections/auth';
import { formatCookie } from '../../../http/auth/cookies';
import type { Clock } from '../../../infra/clock';
import {
  base64UrlEncode, JavaIllegalArgument, javaBase64Decode, javaIsBlank, javaParseLong, javaSplit, javaUtf8, javaUuidFromString,
} from '../../../lib/javaCompat';
import { macEquals } from '../../digest/logic/digestUnsubscribeTokens';

export const MAIL_OAUTH_STATE_TTL_MS = 10 * 60_000;
export const MAIL_OAUTH_NONCE_COOKIE = 'ceitba_mail_oauth_nonce';
/** The cookie only travels to the callback. */
export const MAIL_OAUTH_CALLBACK_PATH = '/api/v1/mail/accounts/oauth/callback';
const DOMAIN = 'ceitba-mail-oauth-state:';

/** userId and, for an organization's sender account, its slug (null = the CEITBA account). */
export interface MailOAuthState { userId: string; orgSlug: string | null }

export class MailOAuthStateService {
  private readonly key: Uint8Array;

  constructor(jwtSecret: string | null | undefined, private readonly clock: Clock) {
    // Assert.hasText(auth.jwt().secret(), ...)
    if (jwtSecret == null || jwtSecret.length === 0 || javaIsBlank(jwtSecret)) {
      throw new Error('auth.jwt.secret (AUTH_JWT_SECRET) must not be empty');
    }
    this.key = javaBase64Decode(jwtSecret);
  }

  issue(userId: string, orgSlug: string | null = null): string {
    return this.issueBound(userId, orgSlug).state;
  }

  /** A state and the nonce inside it (the browser-binding cookie's value). */
  issueBound(userId: string, orgSlug: string | null = null): { state: string; nonce: string } {
    const nonce = base64UrlEncode(randomBytes(12));
    const exp = Math.floor((this.clock.now() + MAIL_OAUTH_STATE_TTL_MS * 1000) / 1_000_000);
    const payload = `${userId}|${exp}|${nonce}${orgSlug == null ? '' : `|${orgSlug}`}`;
    return { state: `${base64UrlEncode(javaUtf8(payload))}.${base64UrlEncode(this.sign(payload))}`, nonce };
  }

  /** verifyState, and the state's nonce equals the browser's cookie (constant time). */
  verifyBound(state: string | null | undefined, cookieNonce: string | null | undefined): MailOAuthState | null {
    const verified = this.verifyState(state);
    const nonce = stateNonce(state);
    if (verified == null || nonce == null || cookieNonce == null) return null;
    const a = Buffer.from(nonce, 'utf8');
    const b = Buffer.from(cookieNonce, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b) ? verified : null;
  }

  /** The user bound to `state` when it is authentic and unexpired. */
  verify(state: string | null | undefined): string | null {
    return this.verifyState(state)?.userId ?? null;
  }

  verifyState(state: string | null | undefined): MailOAuthState | null {
    if (state == null) return null;
    const dot = state.indexOf('.');
    if (dot <= 0 || dot === state.length - 1) return null;
    try {
      const payload = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true }).decode(javaBase64Decode(state.slice(0, dot), true));
      if (!macEquals(javaBase64Decode(state.slice(dot + 1), true), this.sign(payload))) return null;
      const parts = javaSplit(payload, /\|/, 4);
      if (parts.length < 3) return null;
      if (Math.floor(this.clock.now() / 1_000_000) > javaParseLong(parts[1]!)) return null;
      return { userId: javaUuidFromString(parts[0]!), orgSlug: parts.length === 4 ? parts[3]! : null };
    } catch (e) {
      if (e instanceof JavaIllegalArgument) return null;
      throw e;
    }
  }

  private sign(payload: string): Uint8Array {
    return new Uint8Array(createHmac('sha256', this.key).update(javaUtf8(DOMAIN + payload)).digest());
  }
}

/** The nonce field of a state's payload (unverified), or null. */
export function stateNonce(state: string | null | undefined): string | null {
  if (state == null) return null;
  const dot = state.indexOf('.');
  if (dot <= 0) return null;
  try {
    const parts = Buffer.from(state.slice(0, dot), 'base64url').toString('utf8').split('|');
    return parts.length >= 3 && parts[2] ? parts[2] : null;
  } catch {
    return null;
  }
}

/** Set-Cookie of the browser-binding nonce (like the session cookie: HttpOnly, Secure per config, SameSite=Lax). */
export function mailOAuthNonceCookie(auth: AuthConfig, nonce: string): string {
  return formatCookie({
    name: MAIL_OAUTH_NONCE_COOKIE, value: nonce, httpOnly: true, secure: auth.cookie.secure, path: MAIL_OAUTH_CALLBACK_PATH,
    sameSite: 'Lax', maxAgeSeconds: MAIL_OAUTH_STATE_TTL_MS / 1000,
  });
}

/** Set-Cookie that expires the nonce (the callback consumes it). */
export function clearMailOAuthNonceCookie(auth: AuthConfig): string {
  return formatCookie({
    name: MAIL_OAUTH_NONCE_COOKIE, value: '', httpOnly: true, secure: auth.cookie.secure, path: MAIL_OAUTH_CALLBACK_PATH,
    sameSite: 'Lax', maxAgeSeconds: 0,
  });
}
