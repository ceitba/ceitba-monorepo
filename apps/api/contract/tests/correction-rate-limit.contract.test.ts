// Ports apps/api/src/test/java/org/ceitba/api/web/correction/ScheduleCorrectionRateLimitIT.java.
// @TestPropertySource lowers the application.yml rules; here the same rules
// get their capacities and periods through their env vars.
import { describe, expect, test } from 'bun:test';
import { bearer, mintJwt, useServer } from '../support';

const api = useServer({
  env: {
    RATE_LIMIT_ENABLED: 'true', RATE_LIMIT_TRUST_FORWARDED_FOR: 'true',
    RATE_LIMIT_SCHEDULE_CORRECTIONS_CAPACITY: '2', RATE_LIMIT_SCHEDULE_CORRECTIONS_PERIOD: '1h',
    RATE_LIMIT_VOTES_CAPACITY: '2', RATE_LIMIT_VOTES_PERIOD: '1m',
  },
});

const user = async (ip: string) => ({ bearer: await mintJwt({ email: 'a@itba.edu.ar' }), ip });
const opts = async (ip: string, body?: string) => {
  const u = await user(ip);
  return { as: bearer(u.bearer), headers: { 'X-Forwarded-For': ip }, body };
};

describe('ScheduleCorrectionRateLimitIT', () => {
  test('suggestionsAreLimitedPerIp', async () => {
    const ip = '203.0.113.20';
    for (let i = 0; i < 2; i++) {
      expect((await api.post('/v1/commissions/nope/schedule-corrections', await opts(ip, '{"schedule":[]}'))).status).toBe(404);
    }
    const limited = await api.post('/v1/commissions/nope/schedule-corrections', await opts(ip, '{"schedule":[]}'));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toMatch(/^\d+$/);
    expect(limited.json.error).toBe('TooManyRequests');
    expect((await api.post('/v1/commissions/nope/schedule-corrections', await opts('203.0.113.21', '{"schedule":[]}'))).status).toBe(404);
  });

  test('votesAreLimitedPerIpOnWritesOnly', async () => {
    const ip = '203.0.113.22';
    const path = `/v1/schedule-corrections/${crypto.randomUUID()}/vote`;
    expect((await api.put(path, await opts(ip, '{"type":"CONFIRM"}'))).status).toBe(404);
    expect((await api.delete(path, await opts(ip))).status).toBe(404);
    expect((await api.delete(path, await opts(ip))).status).toBe(429);
    for (let i = 0; i < 4; i++) expect((await api.get('/v1/careers', { headers: { 'X-Forwarded-For': ip } })).status).toBe(200);
  });
});
