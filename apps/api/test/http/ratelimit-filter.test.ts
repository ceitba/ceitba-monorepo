// Port of RateLimitFilterTest: the per-IP limiter (src/http/ratelimit.ts) with the
// test's own rule (/v1/auth/** except /v1/auth/me, `capacity` per minute) and a
// manually advanced clock; the 429 response shape goes through the real app.
import { describe, expect, test } from 'bun:test';
import { CONTRACT_ENV } from '../../contract/support/env';
import { loadConfig } from '../../src/config';
import type { RateLimitConfig } from '../../src/config/sections/rateLimit';
import { buildDeps } from '../../src/deps';
import { createApp } from '../../src/http/app';
import { IpRateLimiter, isPrivatePeer, resolveClientIp } from '../../src/http/ratelimit';
import { silentLogger } from '../../src/infra/logger';

const authRule = (capacity: number) => ({ name: 'auth', paths: ['/v1/auth/**'], excludePaths: ['/v1/auth/me'], methods: [], capacity, periodMs: 60_000 });
const cfg = (enabled: boolean, trustXff: boolean, capacity: number): RateLimitConfig =>
  ({ enabled, trustForwardedFor: trustXff, maxTrackedClients: 1000, rules: [authRule(capacity)], userRules: {} });

/** The filter: client IP as RateLimitFilter resolves it, then the limiter. */
function filter(enabled: boolean, trustXff: boolean, capacity: number) {
  let now = 0;
  const limiter = new IpRateLimiter(cfg(enabled, trustXff, capacity), () => now);
  const call = (path: string, ip: string, o: { method?: string; xff?: string } = {}) => {
    const d = limiter.check(o.method ?? 'GET', path, resolveClientIp(ip, o.xff, trustXff));
    return { status: d?.rejected ? 429 : 200, headers: d?.headers ?? {} };
  };
  return { call, advance: (ms: number) => { now += ms; }, clientIp: (ip: string, xff?: string) => resolveClientIp(ip, xff, trustXff) };
}

describe('RateLimitFilterTest', () => {
  test('allowsUpToCapacity_thenReturns429WithRetryAfter', async () => {
    const f = filter(true, false, 3);
    for (let i = 0; i < 3; i++) {
      const ok = f.call('/v1/auth/google', '1.1.1.1');
      expect(ok.status).toBe(200);
      expect(ok.headers['X-RateLimit-Remaining']).toBe(String(2 - i));
    }
    const limited = f.call('/v1/auth/google', '1.1.1.1');
    expect(limited.status).toBe(429);
    expect(limited.headers['Retry-After']).toBe('20'); // 60 s / 3 tokens

    // The response the app writes for it.
    const config = await loadConfig({ ...CONTRACT_ENV, DATABASE_URL: 'jdbc:postgresql://localhost:1/x', RATE_LIMIT_ENABLED: 'true', RATE_LIMIT_AUTH_CAPACITY: '1' });
    const deps = await buildDeps(config, { log: silentLogger, push: null });
    try {
      const app = await createApp(deps);
      expect((await app.request('http://localhost/api/v1/auth/google', undefined, '1.1.1.1')).status).not.toBe(429);
      const r = await app.request('http://localhost/api/v1/auth/google', undefined, '1.1.1.1');
      expect(r.status).toBe(429);
      expect(r.headers.get('Content-Type')).toBe('application/json');
      const body = await r.text();
      expect(body).toContain('"error":"TooManyRequests"');
      expect(body).toContain('"path":"/api/v1/auth/google"');
    } finally {
      await deps.close();
    }
  });

  test('refillsOverTime', () => {
    const f = filter(true, false, 2);
    f.call('/v1/auth/callback', '1.1.1.1');
    f.call('/v1/auth/callback', '1.1.1.1');
    expect(f.call('/v1/auth/callback', '1.1.1.1').status).toBe(429);
    f.advance(30_000); // one token back (2 per minute)
    expect(f.call('/v1/auth/callback', '1.1.1.1').status).toBe(200);
    expect(f.call('/v1/auth/callback', '1.1.1.1').status).toBe(429);
  });

  test('bucketsArePerIp', () => {
    const f = filter(true, false, 1);
    expect(f.call('/v1/auth/google', '1.1.1.1').status).toBe(200);
    expect(f.call('/v1/auth/google', '1.1.1.1').status).toBe(429);
    expect(f.call('/v1/auth/google', '2.2.2.2').status).toBe(200);
  });

  test('unmatchedAndExcludedPathsAreNotLimited', () => {
    const f = filter(true, false, 1);
    for (let i = 0; i < 5; i++) {
      expect(f.call('/v1/careers', '1.1.1.1').status).toBe(200);
      expect(f.call('/v1/auth/me', '1.1.1.1').status).toBe(200);
    }
    expect(f.call('/v1/careers', '1.1.1.1').headers['X-RateLimit-Limit']).toBeUndefined();
  });

  test('disabled_neverLimits', () => {
    const f = filter(false, false, 1);
    for (let i = 0; i < 5; i++) expect(f.call('/v1/auth/google', '1.1.1.1').status).toBe(200);
  });

  test('corsPreflightIsNotCounted', () => {
    const f = filter(true, false, 1);
    f.call('/v1/auth/google', '1.1.1.1', { method: 'OPTIONS' });
    f.call('/v1/auth/google', '1.1.1.1', { method: 'OPTIONS' });
    expect(f.call('/v1/auth/google', '1.1.1.1').status).toBe(200);
  });

  test('trustedXff_usesRightMostEntry_soSpoofedLeftEntriesDontHelp', () => {
    const f = filter(true, true, 1);
    expect(f.call('/v1/auth/google', '10.0.0.2', { xff: '6.6.6.1, 9.9.9.9' }).status).toBe(200); // 10.0.0.2: Caddy
    expect(f.call('/v1/auth/google', '10.0.0.2', { xff: '6.6.6.2, 9.9.9.9' }).status).toBe(429);
    expect(f.clientIp('10.0.0.2', '6.6.6.1, 9.9.9.9')).toBe('9.9.9.9');
  });

  test('untrustedXff_isIgnored', () => {
    expect(filter(true, false, 1).clientIp('5.5.5.5', '1.2.3.4')).toBe('5.5.5.5');
  });

  test('retryAfterRoundsUp', () => {
    const f = filter(true, false, 1);
    f.call('/v1/auth/google', '1.1.1.1');
    f.advance(59_500);
    expect(f.call('/v1/auth/google', '1.1.1.1').headers['Retry-After']).toBe('1');
  });

  test('trustedXff_isIgnoredWhenThePeerIsPublic_soDirectCallersCantSpoofIt', () => {
    const f = filter(true, true, 1);
    expect(f.clientIp('203.0.113.7', '1.1.1.1')).toBe('203.0.113.7'); // skipped the proxy
    expect(f.call('/v1/auth/google', '203.0.113.7', { xff: '1.1.1.1' }).status).toBe(200);
    expect(f.call('/v1/auth/google', '203.0.113.7', { xff: '2.2.2.2' }).status).toBe(429);
  });

  test('privatePeerDetection', () => {
    for (const a of ['127.0.0.1', '10.1.2.3', '172.18.0.5', '192.168.1.1', '::1', 'fd00::1']) expect(isPrivatePeer(a)).toBe(true);
    for (const a of ['8.8.8.8', '2001:db8::1', 'example.com']) expect(isPrivatePeer(a)).toBe(false);
    expect(isPrivatePeer(null)).toBe(false);
  });

  test('ipv6ClientsShareABucketPerSlash64', () => {
    const f = filter(true, false, 1);
    expect(f.call('/v1/auth/google', '2001:db8:1:2::1').status).toBe(200);
    // Same /64, another interface id: rotating addresses does not help.
    expect(f.call('/v1/auth/google', '2001:db8:1:2:abcd::99').status).toBe(429);
    // Another /64 is another client.
    expect(f.call('/v1/auth/google', '2001:db8:1:3::1').status).toBe(200);
  });

  test('ipv6ForwardedClientsShareABucketPerSlash64', () => {
    const f = filter(true, true, 1);
    expect(f.call('/v1/auth/google', '10.0.0.2', { xff: '2001:db8:aa:bb::1' }).status).toBe(200);
    expect(f.call('/v1/auth/google', '10.0.0.2', { xff: '2001:db8:aa:bb:ffff::2' }).status).toBe(429);
  });

  // A rule with `methods` limits only those methods on its paths; other methods fall through.
  test('methodScopedRuleLimitsOnlyItsMethods', () => {
    const now = 0;
    const limiter = new IpRateLimiter({
      enabled: true, trustForwardedFor: false, maxTrackedClients: 1000, userRules: {},
      // RateLimitProperties upper-cases `methods` (Java's test gives "post", "DELETE").
      rules: [{ name: 'votes', paths: ['/v1/articles/*/votes'], excludePaths: [], methods: ['POST', 'DELETE'], capacity: 1, periodMs: 60_000 }],
    }, () => now);
    expect(limiter.check('POST', '/v1/articles/a1/votes', '1.1.1.1')?.rejected).toBeUndefined();
    expect(limiter.check('DELETE', '/v1/articles/a1/votes', '1.1.1.1')?.rejected).toBeDefined();
    for (let i = 0; i < 3; i++) expect(limiter.check('GET', '/v1/articles/a1/votes', '1.1.1.1')).toBeNull();
  });
});
