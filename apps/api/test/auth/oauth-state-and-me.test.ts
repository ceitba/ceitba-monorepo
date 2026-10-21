// Ports of OAuthStateServiceTest (the signed, nonce-bound OAuth `state`) and
// UserMeServiceTest (the staff role is evaluated at the injected clock).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { CONTRACT_ENV, TEST_JWT_SECRET } from '../../contract/support/env';
import { seedStaff } from '../../contract/support/identity';
import { loadConfig } from '../../src/config';
import { AuthService, OAUTH_STATE_TTL_SECONDS } from '../../src/features/auth/service';
import { findUserById } from '../../src/http/auth/repo';
import { MutableClock } from '../../src/infra/clock';
import { silentLogger } from '../../src/infra/logger';
import { testApp, type TestApp } from '../support/app';

const SECRET = TEST_JWT_SECRET;
const T0 = '2026-05-01T12:00:00Z';

async function service(secret: string, now: string | number) {
  const config = await loadConfig({ ...CONTRACT_ENV, AUTH_JWT_SECRET: secret, DATABASE_URL: 'jdbc:postgresql://localhost:1/x' });
  const clock = new MutableClock(now);
  return new AuthService({ config, clock, log: silentLogger } as never);
}

describe('OAuthStateServiceTest', () => {
  test('roundTrip_returnsTarget', async () => {
    const svc = await service(SECRET, T0);
    const issued = svc.issueOAuthState('https://ceitba.org.ar/manage?x=1|2');
    expect(svc.verifyOAuthState(issued.state, issued.nonce)).toBe('https://ceitba.org.ar/manage?x=1|2');
  });

  test('statesAreRandom', async () => {
    const svc = await service(SECRET, T0);
    expect(svc.issueOAuthState('https://ceitba.org.ar').state).not.toBe(svc.issueOAuthState('https://ceitba.org.ar').state);
  });

  test('rejectsMissingOrWrongNonce', async () => {
    const svc = await service(SECRET, T0);
    const issued = svc.issueOAuthState('https://ceitba.org.ar');
    const other = svc.issueOAuthState('https://ceitba.org.ar');
    expect(svc.verifyOAuthState(issued.state, null)).toBeNull();
    expect(svc.verifyOAuthState(issued.state, '')).toBeNull();
    expect(svc.verifyOAuthState(issued.state, other.nonce)).toBeNull();
  });

  test('rejectsExpiredState', async () => {
    const issued = (await service(SECRET, T0)).issueOAuthState('https://ceitba.org.ar');
    const later = await service(SECRET, (Date.parse(T0) + (OAUTH_STATE_TTL_SECONDS + 1) * 1000) * 1000);
    expect(later.verifyOAuthState(issued.state, issued.nonce)).toBeNull();
  });

  test('rejectsTamperedPayload', async () => {
    const svc = await service(SECRET, T0);
    const issued = svc.issueOAuthState('https://ceitba.org.ar');
    const sig = issued.state.slice(issued.state.indexOf('.') + 1);
    const forgedPayload = `${issued.nonce}|${Date.parse(T0) / 1000 + 600}|https://evil.com`;
    const forged = `${Buffer.from(forgedPayload).toString('base64url')}.${sig}`;
    expect(svc.verifyOAuthState(forged, issued.nonce)).toBeNull();
  });

  test('rejectsStateSignedWithAnotherKey', async () => {
    const issued = (await service(Buffer.alloc(32).toString('base64'), T0)).issueOAuthState('https://ceitba.org.ar');
    expect((await service(SECRET, T0)).verifyOAuthState(issued.state, issued.nonce)).toBeNull();
  });

  test('rejectsGarbage', async () => {
    const svc = await service(SECRET, T0);
    expect(svc.verifyOAuthState(null, 'n')).toBeNull();
    expect(svc.verifyOAuthState('', 'n')).toBeNull();
    expect(svc.verifyOAuthState('no-dot', 'n')).toBeNull();
    expect(svc.verifyOAuthState('!!!.???', 'n')).toBeNull();
    // Legacy format: plain base64url target, no signature.
    expect(svc.verifyOAuthState(Buffer.from('https://evil.com').toString('base64url'), 'n')).toBeNull();
  });
});

describe('UserMeServiceTest', () => {
  let t: TestApp;
  const clock = new MutableClock('2026-03-01T12:00:00Z');
  beforeAll(async () => { t = await testApp({ overrides: { clock } }); }, 60_000);
  afterAll(() => t?.close());

  // The staff role is evaluated at the injected clock's time, not the system's.
  test('staffRoleIsEvaluatedAtTheInjectedClock', async () => {
    const id = await seedStaff(t.sql, 'a@itba.edu.ar');
    // Active only around the injected "now" (2026-03-01), long over by the system clock.
    await t.sql`UPDATE public.ceitba_staff SET start = '2026-02-01T00:00:00Z', "end" = '2026-03-02T00:00:00Z' WHERE user_id = ${id}`;
    const user = (await findUserById(t.deps.db, id))!;
    expect((await new AuthService(t.deps).describe(user, { apiKey: null })).role).toBe('staff');
    clock.set('2026-04-01T00:00:00Z');
    expect((await new AuthService(t.deps).describe(user, { apiKey: null })).role).toBe('user');
  });
});
