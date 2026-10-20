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
  test('IPv6 keyed by /64, IPv4 (and mapped) by address', () => {
    expect(clientKey('2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1:2:0:0:0:0/64');
    expect(clientKey('[2001:db8::1]')).toBe('2001:db8:0:0:0:0:0:0/64');
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
  test('UserRateLimiter', async () => {
    const cfg = (await loadConfig({ AUTH_JWT_SECRET: 'dGVzdC1qd3Qtc2VjcmV0LWtleS0zMmJ5dGVzLWxvbmch', RATE_LIMIT_PROPOSALS_CAPACITY: '1' })).rateLimit;
    const l = new UserRateLimiter(cfg, () => 0);
    l.consume('proposals', 'u1');
    expect(() => l.consume('proposals', 'u1')).toThrow(RateLimitExceededError);
    l.consume('proposals', 'u2');
    l.consume('unknown-rule', 'u1');
  });
});
