// Intentional hardening vs the Java app (contract/COMPATIBILITY.md "Rate limits"): the per-IP rules match the
// DECODED path inside /api, the one routing and the URL rules use. Java's RateLimitFilter matched the raw request
// URI, so a percent-encoded path reached the route but escaped its bucket (`/v1/articles/x/v%6Ftes` -> no votes
// limit; `/v1/auth/review-l%6Fgin` -> the generic auth bucket). TS-only: the Java reference answers differently.
import { describe, expect, test } from 'bun:test';
import { TARGET, useServer } from '../support';

const api = useServer({
  env: {
    RATE_LIMIT_ENABLED: 'true', RATE_LIMIT_TRUST_FORWARDED_FOR: 'true',
    RATE_LIMIT_AUTH_CAPACITY: '50', RATE_LIMIT_AUTH_PERIOD: '1m',
    RATE_LIMIT_REVIEW_LOGIN_CAPACITY: '1', RATE_LIMIT_REVIEW_LOGIN_PERIOD: '1m',
    RATE_LIMIT_VOTES_CAPACITY: '2', RATE_LIMIT_VOTES_PERIOD: '1m',
  },
});
const from = (ip: string) => ({ headers: { 'X-Forwarded-For': ip } });

describe.skipIf(TARGET === 'java')('RateLimitDecodedPath (TS hardening)', () => {
  test('anEncodedVotesPathSharesTheVotesBucket', async () => {
    const ip = '203.0.113.41';
    const post = (path: string) => api.post(path, { ...from(ip), body: { type: 'up' }, rawPath: true });
    expect((await post('/api/v1/articles/nope/votes')).status).toBe(404);
    const encoded = await post('/api/v1/articles/nope/v%6Ftes');
    expect(encoded.status).toBe(404);
    expect(encoded.headers.get('X-RateLimit-Limit')).toBe('2');
    expect((await post('/api/v1/articles/nope/v%6Ftes')).status).toBe(429);
  });

  test('anEncodedReviewLoginPathUsesTheReviewLoginBucket', async () => {
    const ip = '203.0.113.42';
    const login = (path: string) => api.post(path, { ...from(ip), body: { email: 'x@y.z', password: 'p' }, rawPath: true });
    const first = await login('/api/v1/auth/review-l%6Fgin');
    expect(first.status).not.toBe(429);
    expect(first.headers.get('X-RateLimit-Limit')).toBe('1');
    expect((await login('/api/v1/auth/review-login')).status).toBe(429);
  });
});
