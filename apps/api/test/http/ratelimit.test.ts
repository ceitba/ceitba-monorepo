// Ports of RateLimitFilterTest (client keys, private peers, buckets) and UserRateLimiter.
import { describe, expect, test } from 'bun:test';
import { loadConfig } from '../../src/config';
import { clientKey, IpRateLimiter, isPrivatePeer, resolveClientIp, retryAfterSeconds, TokenBucket, UserRateLimiter } from '../../src/http/ratelimit';
import { RateLimitExceededError } from '../../src/http/errors';

describe('client ip', () => {
  test('private peers', () => {
    for (const a of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.1.1', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', 'fec0::1']) expect(isPrivatePeer(a)).toBe(true);
    for (const a of ['8.8.8.8', '172.32.0.1', '2001:db8::1', 'example.com', '', '::ffff:8.8.8.8']) expect(isPrivatePeer(a)).toBe(false);
  });
  test('right-most X-Forwarded-For entry, only from a private peer', () => {
    expect(resolveClientIp('127.0.0.1', '1.1.1.1, 2.2.2.2', true)).toBe('2.2.2.2');
    expect(resolveClientIp('8.8.8.8', '1.1.1.1', true)).toBe('8.8.8.8');
    expect(resolveClientIp('127.0.0.1', '1.1.1.1', false)).toBe('127.0.0.1');
    expect(resolveClientIp('127.0.0.1', ' ', true)).toBe('127.0.0.1');
  });
  test('clientKeyNormalization', () => {
    expect(clientKey('2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1:2:0:0:0:0/64');
    expect(clientKey('[2001:db8:1:2::7]')).toBe('2001:db8:1:2:0:0:0:0/64');
    expect(clientKey('[2001:db8::1]')).toBe('2001:db8:0:0:0:0:0:0/64');
    expect(clientKey('not:an-ip')).toBe('not:an-ip');
    expect(clientKey('fe80::1%eth0')).toBe('fe80:0:0:0:0:0:0:0/64');
    expect(clientKey('::ffff:1.2.3.4')).toBe('1.2.3.4');
    expect(clientKey('1.2.3.4')).toBe('1.2.3.4');
  });
});

describe('buckets', () => {
  test('greedy refill', () => {
    const b = new TokenBucket(2, 60_000, 0);
    expect(b.tryConsume(0)).toMatchObject({ consumed: true, remaining: 1 });
    expect(b.tryConsume(0)).toMatchObject({ consumed: true, remaining: 0 });
    const denied = b.tryConsume(0);
    expect(denied.consumed).toBe(false);
    expect(retryAfterSeconds(denied.waitMs)).toBe(30);
    expect(b.tryConsume(30_000).consumed).toBe(true);
  });
  test('first matching rule, excludes, methods', async () => {
    const cfg = (await loadConfig({ AUTH_JWT_SECRET: 'dGVzdC1qd3Qtc2VjcmV0LWtleS0zMmJ5dGVzLWxvbmch', RATE_LIMIT_AUTH_CAPACITY: '1' })).rateLimit;
    let now = 0;
    const l = new IpRateLimiter(cfg, () => now);
    expect(l.check('GET', '/v1/auth/google', '1.1.1.1')?.rule.name).toBe('auth');
    expect(l.check('GET', '/v1/auth/google', '1.1.1.1')?.rejected).toBeDefined();
    expect(l.check('GET', '/v1/auth/me', '1.1.1.1')).toBeNull();
    expect(l.check('GET', '/v1/auth/refresh', '1.1.1.1')?.rule.name).toBe('auth-refresh');
    expect(l.check('GET', '/v1/articles/x/votes', '1.1.1.1')).toBeNull();
    expect(l.check('POST', '/v1/articles/x/votes', '1.1.1.1')?.rule.name).toBe('votes');
    expect(l.check('OPTIONS', '/v1/auth/google', '1.1.1.1')).toBeNull();
    now = 60_000;
    expect(l.check('GET', '/v1/auth/google', '1.1.1.1')?.rejected).toBeUndefined();
  });
  test('UserRateLimiter (proposals rule from the env)', async () => {
    const cfg = (await loadConfig({ AUTH_JWT_SECRET: 'dGVzdC1qd3Qtc2VjcmV0LWtleS0zMmJ5dGVzLWxvbmch', RATE_LIMIT_PROPOSALS_CAPACITY: '1' })).rateLimit;
    const l = new UserRateLimiter(cfg, () => 0);
    l.consume('proposals', 'u1');
    expect(() => l.consume('proposals', 'u1')).toThrow(RateLimitExceededError);
    l.consume('proposals', 'u2');
    l.consume('unknown-rule', 'u1');
  });
});

// UserRateLimiterTest: per-user buckets, greedy refill, Retry-After, disabled/unknown rules.
describe('UserRateLimiterTest', () => {
  const SECRET = 'dGVzdC1qd3Qtc2VjcmV0LWtleS0zMmJ5dGVzLWxvbmch';
  const limiter = async (enabled: boolean, now: () => number) => new UserRateLimiter((await loadConfig({
    AUTH_JWT_SECRET: SECRET, RATE_LIMIT_ENABLED: String(enabled), RATE_LIMIT_ORG_IMAGES_CAPACITY: '2', RATE_LIMIT_ORG_IMAGES_PERIOD: 'PT1M',
  })).rateLimit, now);

  test('exhaustsPerUserAndReportsRetryAfter', async () => {
    let t = 0;
    const l = await limiter(true, () => t);
    l.consume('org-images', 'alice');
    l.consume('org-images', 'alice');
    let err: unknown;
    try { l.consume('org-images', 'alice'); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(RateLimitExceededError);
    expect((err as RateLimitExceededError).message).toBe('Rate limit exceeded. Retry in 30s.');
    l.consume('org-images', 'bob'); // buckets are per user
    t += 30_000; // greedy refill: one token back after period / capacity
    l.consume('org-images', 'alice');
  });

  test('disabledOrUnknownRuleNeverLimits', async () => {
    const off = await limiter(false, () => 0);
    const on = await limiter(true, () => 0);
    for (let i = 0; i < 10; i++) {
      off.consume('org-images', 'alice');
      on.consume('other', 'alice');
    }
  });

  test('userRuleRejectsNonPositiveValues', async () => {
    await expect(loadConfig({ AUTH_JWT_SECRET: SECRET, RATE_LIMIT_ORG_IMAGES_CAPACITY: '0' })).rejects.toThrow();
    await expect(loadConfig({ AUTH_JWT_SECRET: SECRET, RATE_LIMIT_ORG_IMAGES_PERIOD: 'PT0S' })).rejects.toThrow();
  });
});
