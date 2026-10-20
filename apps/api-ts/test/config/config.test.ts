// src/config: Spring placeholder semantics and normalization.
import { describe, expect, test } from 'bun:test';
import { loadConfig } from '../../src/config';
import { parseDuration, parseList } from '../../src/config/env';

const base = { AUTH_JWT_SECRET: 'dGVzdC1qd3Qtc2VjcmV0LWtleS0zMmJ5dGVzLWxvbmch' };

describe('durations (Spring DurationStyle)', () => {
  test.each([
    ['PT5M', 300_000], ['P30D', 30 * 86_400_000], ['PT0S', 0], ['PT1.5S', 1500], ['10m', 600_000], ['60s', 60_000],
    ['60d', 60 * 86_400_000], ['500', 500], ['1h', 3_600_000], ['PT24H', 86_400_000], ['500ms', 500],
  ])('%s', (v, ms) => expect(parseDuration(v)).toBe(ms));
  test('rejects garbage', () => expect(() => parseDuration('5 minutes')).toThrow());
});

test('lists are comma separated and trimmed', () => {
  expect(parseList('a, b ,c')).toEqual(['a', 'b', 'c']);
  expect(parseList('')).toEqual([]);
});

describe('defaults and profiles', () => {
  test('application.yml defaults', async () => {
    const c = await loadConfig({ ...base, SPRING_PROFILES_ACTIVE: 'prod' });
    expect(c.server.port).toBe(8080);
    expect(c.db.poolSize).toBe(20);
    expect(c.db.flyway.baselineOnMigrate).toBe(true);
    expect(c.auth.jwt).toMatchObject({ ttlDays: 7, issuer: 'https://ceitba.org.ar/api', enforceIssuerAudience: true, mobileAccessTtlMs: 900_000, refreshTtlMs: 60 * 86_400_000, refreshReuseGraceMs: 60_000 });
    expect(c.auth.cookie).toMatchObject({ name: 'ceitba_session', secure: true, sameSite: 'Lax', path: '/' });
    expect(c.auth.allowedDomains).toEqual(['itba.edu.ar']);
    expect(c.rateLimit.rules[0]).toMatchObject({ name: 'auth', capacity: 20, periodMs: 60_000 });
    expect(c.kb.pipeline.cron).toBe('0 0 3 * * SUN');
  });
  test('the dev profile (the yml default) turns the Secure cookie off unless the env sets it', async () => {
    expect((await loadConfig(base)).auth.cookie.secure).toBe(false);
    expect((await loadConfig({ ...base, AUTH_COOKIE_SECURE: 'true' })).auth.cookie.secure).toBe(true);
  });
  test('jdbc DATABASE_URL + POSTGRES_USER/PASSWORD', async () => {
    const c = await loadConfig({ ...base, DATABASE_URL: 'jdbc:postgresql://db.host:6543/ceitba', POSTGRES_USER: 'u', POSTGRES_PASSWORD: 'p@ss' });
    expect(c.db).toMatchObject({ host: 'db.host', port: 6543, database: 'ceitba', user: 'u', url: 'postgres://u:p%40ss@db.host:6543/ceitba' });
  });
  test('empty values fall back like Spring binds null', async () => {
    const c = await loadConfig({ ...base, AUTH_REFRESH_REUSE_GRACE: '', AUTH_JWT_ENFORCE_ISS_AUD: '', AUTH_COOKIE_NAME: '' });
    expect(c.auth.jwt.refreshReuseGraceMs).toBe(60_000);
    expect(c.auth.jwt.enforceIssuerAudience).toBe(true);
    expect(c.auth.cookie.name).toBe('ceitba_session');
  });
  test('review login status', async () => {
    const hash = '$2a$04$' + 'a'.repeat(53);
    expect((await loadConfig(base)).auth.reviewLogin.status).toBe('DISABLED');
    expect((await loadConfig({ ...base, REVIEW_LOGIN_EMAIL: ' A@B.c ', REVIEW_LOGIN_PASSWORD_HASH: hash })).auth.reviewLogin).toMatchObject({ status: 'ENABLED', email: 'a@b.c', bcryptCost: 4 });
    expect((await loadConfig({ ...base, REVIEW_LOGIN_EMAIL: 'a@b.c', REVIEW_LOGIN_PASSWORD_HASH: '$2a$12%' })).auth.reviewLogin.status).toBe('MISCONFIGURED');
  });
  test('a missing JWT secret fails fast', async () => {
    await expect(loadConfig({})).rejects.toThrow('AUTH_JWT_SECRET');
  });
  test('storage falls back to R2_* only when STORAGE_* is absent', async () => {
    expect((await loadConfig({ ...base, R2_BUCKET: 'r2' })).integrations.storage.bucket).toBe('r2');
    expect((await loadConfig({ ...base, R2_BUCKET: 'r2', STORAGE_BUCKET: '' })).integrations.storage.bucket).toBe('');
  });
});
