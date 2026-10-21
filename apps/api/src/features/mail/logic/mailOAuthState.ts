// Port of apps/api/src/main/java/org/ceitba/api/service/mail/MailOAuthStateService.java.
//
// Signed, short-lived OAuth `state` of the sender-account connect flow; binds
// the user who started it and, for an organization's account, the org:
//   state = b64url(userId|expiresAtEpochSec|nonce[|orgSlug]) + "." + b64url(HMAC-SHA256)
// The key is the (base64-decoded) JWT secret under its own domain prefix
// "ceitba-mail-oauth-state:", so it can never be confused with a login state
// or a session JWT.

import { createHmac, randomBytes } from 'node:crypto';
import type { Clock } from '../../../infra/clock';
import {
  base64UrlEncode, JavaIllegalArgument, javaBase64Decode, javaIsBlank, javaParseLong, javaSplit, javaUtf8, javaUuidFromString,
} from '../../../lib/javaCompat';
import { macEquals } from '../../digest/logic/digestUnsubscribeTokens';

export const MAIL_OAUTH_STATE_TTL_MS = 10 * 60_000;
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
    const n = randomBytes(12);
    const exp = Math.floor((this.clock.now() + MAIL_OAUTH_STATE_TTL_MS * 1000) / 1_000_000);
    const payload = `${userId}|${exp}|${base64UrlEncode(n)}${orgSlug == null ? '' : `|${orgSlug}`}`;
    return `${base64UrlEncode(javaUtf8(payload))}.${base64UrlEncode(this.sign(payload))}`;
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
