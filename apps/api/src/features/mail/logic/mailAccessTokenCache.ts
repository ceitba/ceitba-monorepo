// Port of apps/api/src/main/java/org/ceitba/api/service/mail/MailAccessTokenCache.java.
//
// Access tokens of the connected sender accounts, kept until shortly before
// they expire (they live ~1h). Keyed by account id AND stored token, so a
// reconnection (new refresh token) never reuses the old account's token.

import type { Clock } from '../../../infra/clock';
import { javaHashCode } from '../../../lib/javaCompat';
import type { Micros } from '../../../lib/time';
import type { GoogleTokens, MailCredentials } from './types';

export const SKEW_MS = 2 * 60_000;

interface Entry { token: string; expiresAt: Micros }

export class MailAccessTokenCache {
  private readonly cache = new Map<string, Entry>();

  /** refresher: refresh token -> new access token (GoogleMailOAuthClient.refresh; throws GoogleOAuthError). */
  constructor(private readonly refresher: (refreshToken: string) => Promise<GoogleTokens>, private readonly clock: Clock) {}

  async get(c: MailCredentials): Promise<string> {
    const key = cacheKey(c);
    const e = this.cache.get(key);
    const now = this.clock.now();
    if (e && e.expiresAt - SKEW_MS * 1000 > now) return e.token;
    const t = await this.refresher(c.refreshToken);
    this.cache.set(key, { token: t.accessToken, expiresAt: now + t.expiresIn * 1_000_000 });
    return t.accessToken;
  }

  invalidate(c: MailCredentials): void {
    this.cache.delete(cacheKey(c));
  }
}

function cacheKey(c: MailCredentials): string {
  return `${c.accountId}:${javaHashCode(c.tokenEnc)}`;
}
