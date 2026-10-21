// Ports apps/api/src/test/java/org/ceitba/api/web/ratelimit/RateLimitIT.java
// (application.yml rules with capacities lowered through their env vars).
import { describe, expect, test } from 'bun:test';
import { supports, useServer } from '../support';

const api = useServer({
  env: {
    RATE_LIMIT_ENABLED: 'true', RATE_LIMIT_TRUST_FORWARDED_FOR: 'true',
    RATE_LIMIT_AUTH_CAPACITY: '2', RATE_LIMIT_AUTH_PERIOD: '1m',
    RATE_LIMIT_VOTES_CAPACITY: '2', RATE_LIMIT_VOTES_PERIOD: '1m',
  },
});
const hasVotes = await supports('POST /v1/articles/nope/votes', 'GET /v1/articles/nope/votes');
const from = (ip: string) => ({ headers: { 'X-Forwarded-For': ip } });

describe('RateLimitIT', () => {
  test('authEndpointsAreLimitedPerIp', async () => {
    const ip = '203.0.113.7';
    const first = await api.get('/v1/auth/google', from(ip));
    expect(first.status).toBe(302);
    expect(first.headers.get('X-RateLimit-Limit')).toBe('2');
    expect(first.headers.get('X-RateLimit-Remaining')).toBe('1');
    expect((await api.get('/v1/auth/google', from(ip))).status).toBe(302);
    const limited = await api.get('/v1/auth/google', from(ip));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toMatch(/^\d+$/);
    expect(limited.json.error).toBe('TooManyRequests');
    expect((await api.get('/v1/auth/google', from('203.0.113.8'))).status).toBe(302);
    // The right-most X-Forwarded-For entry is the client.
    expect((await api.get('/v1/auth/google', from('1.2.3.4, 203.0.113.7'))).status).toBe(429);
  });

  test('publicNonAuthEndpointsAreNotLimited', async () => {
    for (let i = 0; i < 5; i++) expect((await api.get('/v1/careers', from('203.0.113.9'))).status).toBe(200);
  });

  test('excludedAuthPathIsNotLimited', async () => {
    for (let i = 0; i < 5; i++) expect((await api.get('/v1/auth/me', from('203.0.113.10'))).status).toBe(401);
  });

  test.skipIf(!hasVotes)('voteWritesAreLimitedButCountReadsAreNot', async () => {
    const ip = '203.0.113.11';
    for (let i = 0; i < 2; i++) {
      expect((await api.post('/v1/articles/nope/votes', { ...from(ip), body: { type: 'up' } })).status).toBe(404);
    }
    expect((await api.delete('/v1/articles/nope/votes', from(ip))).status).toBe(429);
    for (let i = 0; i < 5; i++) expect((await api.get('/v1/articles/nope/votes', from(ip))).status).toBe(200);
  });

  // IPv6 clients share a /64 bucket.
  test('ipv6ClientsAreKeyedByTheirSlash64', async () => {
    expect((await api.get('/v1/auth/google', from('2001:db8:1:2::1'))).status).toBe(302);
    expect((await api.get('/v1/auth/google', from('2001:db8:1:2::ffff'))).status).toBe(302);
    expect((await api.get('/v1/auth/google', from('2001:db8:1:2:aaaa::1'))).status).toBe(429);
    expect((await api.get('/v1/auth/google', from('2001:db8:1:3::1'))).status).toBe(302);
  });
});
