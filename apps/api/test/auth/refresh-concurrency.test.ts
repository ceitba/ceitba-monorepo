// In-process part of apps/api/src/test/java/org/ceitba/api/web/auth/RefreshTokenIT.java:
// a revocation that starts while a rotation of the same family is still
// uncommitted must wait for it (family advisory lock) and revoke the successor too.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { AuthService } from '../../src/features/auth/service';
import { seedRefreshToken, seedUser } from '../../contract/support/identity';
import { testApp, type TestApp } from '../support/app';

let t: TestApp;
let svc: AuthService;
let alice: string;
beforeAll(async () => {
  t = await testApp();
  svc = new AuthService(t.deps);
}, 60_000);
afterAll(() => t?.close());

async function rotateWhileRevoking(token: string, revoke: (token: string) => Promise<void>): Promise<string> {
  let rotated!: () => void;
  const rotatedP = new Promise<void>((r) => { rotated = r; });
  let release!: () => void;
  const releaseP = new Promise<void>((r) => { release = r; });
  const rotation = t.deps.db.transaction(async (tx) => {
    const next = await svc.rotate(token, tx);
    rotated();
    await Promise.race([releaseP, Bun.sleep(10_000)]);
    return next.refresh.token;
  });
  await rotatedP;
  let done = false;
  const revocation = revoke(token).then(() => { done = true; });
  await Bun.sleep(500);
  expect(done).toBe(false); // revocation must wait for the in-flight rotation of the family
  release();
  const successor = await rotation;
  await revocation;
  return successor;
}

describe('RefreshTokenIT (concurrency)', () => {
  beforeEach(async () => {
    await t.sql`TRUNCATE public."user" CASCADE`;
    alice = await seedUser(t.sql, 'alice@itba.edu.ar', { name: 'Alice' });
  });

  test('logoutDuringAnUncommittedRotationAlsoRevokesTheSuccessor', async () => {
    const t1 = await seedRefreshToken(t.sql, alice);
    const successor = await rotateWhileRevoking(t1, (tok) => svc.revokeFamilyOf(tok));
    expect((await t.request('POST', '/v1/auth/refresh', { body: { refreshToken: successor } })).status).toBe(401);
    expect((await t.sql`SELECT revoked_at FROM public.refresh_tokens`).every((r) => r.revoked_at !== null)).toBe(true);
  });

  test('logoutAllDuringAnUncommittedRotationAlsoRevokesTheSuccessor', async () => {
    const t1 = await seedRefreshToken(t.sql, alice);
    const successor = await rotateWhileRevoking(t1, () => svc.logoutAll(alice));
    expect((await t.request('POST', '/v1/auth/refresh', { body: { refreshToken: successor } })).status).toBe(401);
    expect((await t.sql`SELECT revoked_at FROM public.refresh_tokens`).every((r) => r.revoked_at !== null)).toBe(true);
  });
});
