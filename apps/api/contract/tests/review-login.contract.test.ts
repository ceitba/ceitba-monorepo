// Ports apps/api/src/test/java/org/ceitba/api/web/auth/ReviewLoginIT.java.
// googleLoginWithTheReviewEmailIsStillRejected needs a locally signed Google
// ID token: in-process, test/auth/mobile-login.test.ts.
import { beforeEach, describe, expect, test } from 'bun:test';
import bcrypt from 'bcryptjs';
import { bearer, mintJwt, truncateUsers, useServer } from '../support';

const REVIEW_EMAIL = 'appreview@example.com';
const PASSWORD = 'correct horse battery staple';

const api = useServer({
  env: {
    // Odd casing/whitespace on purpose: it is normalized.
    REVIEW_LOGIN_EMAIL: '  AppReview@Example.com ',
    REVIEW_LOGIN_PASSWORD_HASH: bcrypt.hashSync(PASSWORD, 4),
    RATE_LIMIT_ENABLED: 'true',
    RATE_LIMIT_TRUST_FORWARDED_FOR: 'true',
    // The generic auth bucket (which excludes review-login) holds 2; review-login keeps its own 10.
    RATE_LIMIT_AUTH_CAPACITY: '2',
    RATE_LIMIT_AUTH_PERIOD: '1m',
    RATE_LIMIT_REVIEW_LOGIN_CAPACITY: '10',
    RATE_LIMIT_REVIEW_LOGIN_PERIOD: '1m',
  },
});

let ipCounter = 1;
const freshIp = () => {
  const n = ipCounter++;
  return `198.51.${100 + Math.floor(n / 250)}.${1 + (n % 250)}`;
};
const reviewLoginFrom = (ip: string, body: unknown) => api.post('/v1/auth/review-login', { headers: { 'X-Forwarded-For': ip }, body });
const reviewLogin = (email: string | null, password: string | null) =>
  reviewLoginFrom(freshIp(), { email, password, deviceName: 'iPhone 15 (review)' });
const loginOk = async () => {
  const r = await reviewLogin(REVIEW_EMAIL, PASSWORD);
  expect(r.status).toBe(200);
  return r.json;
};
const getWithBearer = (path: string, token: string) => api.get(path, { headers: { 'X-Forwarded-For': freshIp(), Authorization: `Bearer ${token}` } });
const count = async (table: string) => Number((await api.db.unsafe(`SELECT count(*)::int AS n FROM public.${table}`))[0]!.n);

describe('ReviewLoginIT', () => {
  beforeEach(() => truncateUsers(api.db));

  test('successReturnsTheMobileTokenShapeAndAPlainUser', async () => {
    const r = await reviewLogin(REVIEW_EMAIL, PASSWORD);
    expect(r.status).toBe(200);
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    expect(typeof r.json.accessToken).toBe('string');
    expect(typeof r.json.accessTokenExpiresAt).toBe('string');
    expect(typeof r.json.refreshToken).toBe('string');
    expect(typeof r.json.refreshTokenExpiresAt).toBe('string');
    expect(r.json.user).toMatchObject({ email: REVIEW_EMAIL, name: 'App Review', role: 'user', moderator: false });
    const [user] = await api.db`SELECT id, career_id, plan, file_number FROM public."user" WHERE email = ${REVIEW_EMAIL}`;
    expect(user).toMatchObject({ career_id: null, plan: null, file_number: null });
    const tokens = await api.db`SELECT device_name FROM public.refresh_tokens`;
    expect([...tokens]).toEqual([{ device_name: 'iPhone 15 (review)' }]);
    const access = r.json.accessToken;
    const me = await getWithBearer('/v1/auth/me', access);
    expect(me.status).toBe(200);
    expect(me.json).toMatchObject({ id: user!.id, role: 'user', moderator: false });
    expect((await getWithBearer('/v1/staff', access)).status).toBe(403);
    expect((await getWithBearer('/v1/staff/proposals', access)).status).toBe(403);
  });

  test('emailMatchIsCaseInsensitiveAndRepeatedLoginsReuseTheUser', async () => {
    expect((await reviewLogin('  APPREVIEW@example.COM', PASSWORD)).status).toBe(200);
    await loginOk();
    expect(await count('"user"')).toBe(1);
    expect(await count('refresh_tokens')).toBe(2);
  });

  test('wrongPasswordIsRejected', async () => {
    const r = await reviewLogin(REVIEW_EMAIL, 'wrong password');
    expect(r.status).toBe(401);
    expect(r.json).toMatchObject({ error: 'invalid_credentials', message: 'Invalid email or password' });
    expect(await count('"user"')).toBe(0);
    expect(await count('refresh_tokens')).toBe(0);
  });

  test('anyOtherEmailIsRejectedEvenWithTheRightPassword', async () => {
    for (const email of ['alice@itba.edu.ar', 'appreview@example.org', 'someone@gmail.com']) {
      const r = await reviewLogin(email, PASSWORD);
      expect(r.status).toBe(401);
      expect(r.json.error).toBe('invalid_credentials');
    }
    expect(await count('"user"')).toBe(0);
  });

  test('missingOrBlankFieldsAreInvalidCredentials', async () => {
    const r = await reviewLogin(REVIEW_EMAIL, null);
    expect(r.status).toBe(401);
    expect(r.json.error).toBe('invalid_credentials');
    expect((await reviewLogin(null, PASSWORD)).status).toBe(401);
    expect((await reviewLogin(REVIEW_EMAIL, '')).status).toBe(401);
    expect((await reviewLogin(REVIEW_EMAIL, 'x'.repeat(100))).status).toBe(401);
    expect((await api.post('/v1/auth/review-login', { headers: { 'X-Forwarded-For': freshIp() } })).status).toBe(401);
  });

  test('allowlistAdmitsTheReviewEmailButNothingElse', async () => {
    const access = (await loginOk()).accessToken;
    expect((await getWithBearer('/v1/auth/me', access)).status).toBe(200);
    for (const email of ['mallory@gmail.com', 'appreview@example.org', 'x.appreview@example.com']) {
      const other = await mintJwt({ email, name: 'Other', ttlSeconds: 900 });
      expect((await getWithBearer('/v1/auth/me', other)).status).toBe(403);
    }
  });

  test('refreshAndLogoutWorkUnchanged', async () => {
    const login = await loginOk();
    const rotated = await api.post('/v1/auth/refresh', { headers: { 'X-Forwarded-For': freshIp() }, body: { refreshToken: login.refreshToken } });
    expect(rotated.status).toBe(200);
    expect(rotated.json.user).toMatchObject({ email: REVIEW_EMAIL, role: 'user' });
    const next = rotated.json.refreshToken;
    expect(next).not.toBe(login.refreshToken);
    expect((await getWithBearer('/v1/auth/me', rotated.json.accessToken)).status).toBe(200);
    expect((await api.post('/v1/auth/logout', { headers: { 'X-Forwarded-For': freshIp() }, body: { refreshToken: next } })).status).toBe(204);
    expect((await api.post('/v1/auth/refresh', { headers: { 'X-Forwarded-For': freshIp() }, body: { refreshToken: next } })).status).toBe(401);
  });

  test('reviewAccountCannotCreateApiKeys', async () => {
    const access = (await loginOk()).accessToken;
    const r = await api.post('/v1/auth/api-keys', { headers: { 'X-Forwarded-For': freshIp() }, as: bearer(access), body: { name: 'script' } });
    expect(r.status).toBe(403);
    expect(r.json).toMatchObject({ error: 'AccessDenied', message: 'The review account cannot create API keys' });
  });

  test('staleBearerTokenIsIgnored', async () => {
    const r = await api.post('/v1/auth/review-login', {
      headers: { 'X-Forwarded-For': freshIp(), Authorization: 'Bearer not-a-valid-jwt' }, body: { email: REVIEW_EMAIL, password: PASSWORD },
    });
    expect(r.status).toBe(200);
  });

  test('hasItsOwnStrictRateLimitBucket', async () => {
    const ip = '203.0.113.50';
    const wrong = { email: REVIEW_EMAIL, password: 'guess' };
    for (let i = 0; i < 10; i++) {
      const r = await reviewLoginFrom(ip, wrong);
      expect(r.status).toBe(401);
      expect(r.headers.get('X-RateLimit-Limit')).toBe('10');
      expect(r.headers.get('X-RateLimit-Remaining')).toBe(String(9 - i));
    }
    const limited = await reviewLoginFrom(ip, wrong);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).not.toBeNull();
    expect(limited.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(limited.json).toMatchObject({ error: 'TooManyRequests', message: `Rate limit exceeded. Retry in ${limited.headers.get('Retry-After')}s.` });
    expect((await reviewLoginFrom(ip, { email: REVIEW_EMAIL, password: PASSWORD })).status).toBe(429);
    expect((await reviewLoginFrom('203.0.113.51', { email: REVIEW_EMAIL, password: PASSWORD })).status).toBe(200);
  });
});
