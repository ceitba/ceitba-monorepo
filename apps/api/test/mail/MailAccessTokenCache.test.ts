// Port of apps/api/src/test/java/org/ceitba/api/service/mail/MailAccessTokenCacheTest.java
import { describe, expect, test } from 'bun:test';
import { MailAccessTokenCache } from '../../src/features/mail/logic/mailAccessTokenCache';
import type { MailCredentials } from '../../src/features/mail/logic/types';
import { MutableClock } from './support/MutableClock';

function setup() {
  const clock = new MutableClock('2026-10-04T12:00:00Z');
  let refreshes = 0;
  const cache = new MailAccessTokenCache(async () => {
    const n = ++refreshes;
    return { accessToken: `access-${n}`, refreshToken: null, idToken: null, scope: null, expiresIn: 3600 };
  }, clock);
  const creds: MailCredentials = { accountId: 1, email: 'ceitba@itba.edu.ar', refreshToken: 'refresh', tokenEnc: 'enc-1' };
  return { clock, cache, creds, refreshes: () => refreshes };
}

describe('MailAccessTokenCacheTest', () => {
  test('cachesUntilShortlyBeforeExpiryThenRefreshes', async () => {
    const { clock, cache, creds, refreshes } = setup();
    expect(await cache.get(creds)).toBe('access-1');
    clock.advance(50 * 60_000);
    expect(await cache.get(creds)).toBe('access-1');
    clock.advance(9 * 60_000); // inside the 2 min safety margin
    expect(await cache.get(creds)).toBe('access-2');
    expect(refreshes()).toBe(2);
  });

  test('invalidateAndReconnectionForceARefresh', async () => {
    const { cache, creds } = setup();
    await cache.get(creds);
    cache.invalidate(creds);
    expect(await cache.get(creds)).toBe('access-2');
    const reconnected: MailCredentials = { accountId: 1, email: 'ceitba@itba.edu.ar', refreshToken: 'new', tokenEnc: 'enc-2' };
    expect(await cache.get(reconnected)).toBe('access-3');
  });
});
