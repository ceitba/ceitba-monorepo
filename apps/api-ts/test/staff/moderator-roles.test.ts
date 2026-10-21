// In-process part of apps/api/src/test/java/org/ceitba/api/web/staff/ModeratorIT.java:
// the authoritiesOf(...) assertions (StaffAwareJwtAuthenticationConverter -> jwtRoles)
// across a grant/revoke made through the real endpoints. HTTP assertions are in
// contract/tests/staff-moderators.contract.test.ts.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mintJwt, seedStaff, seedUser } from '../../contract/support/identity';
import { jwtRoles } from '../../src/http/security';
import { testApp, type TestApp } from '../support/app';

let t: TestApp;
beforeAll(async () => { t = await testApp(); }, 60_000);
afterAll(() => t?.close());

const BOSS = 'boss@itba.edu.ar';
const ALICE = 'alice@itba.edu.ar';
const authoritiesOf = async (email: string) => [...(await jwtRoles(t.deps, email))].sort();
const asBoss = async () => ({ Authorization: `Bearer ${await mintJwt({ email: BOSS, name: BOSS })}` });

describe('ModeratorIT (authorities)', () => {
  let aliceId: string;
  beforeEach(async () => {
    await t.sql`TRUNCATE public."user" CASCADE`;
    await seedUser(t.sql, BOSS, { name: 'Boss' });
    await seedStaff(t.sql, BOSS);
    aliceId = await seedUser(t.sql, ALICE, { name: 'Alice' });
  });

  test('staffGrantsAndRevokesModerator', async () => {
    expect(await authoritiesOf(ALICE)).toEqual(['USER']);
    const g = await t.request('POST', '/v1/staff/moderators', { headers: await asBoss(), body: { email: ALICE } });
    expect(g.status).toBe(201);
    expect(await authoritiesOf(ALICE)).toEqual(['MODERATOR', 'USER']);
    const d = await t.request('DELETE', `/v1/staff/moderators/${aliceId}`, { headers: await asBoss() });
    expect(d.status).toBe(204);
    expect(await authoritiesOf(ALICE)).toEqual(['USER']);
  });

  test('staffImpliesModerator', async () => {
    expect(await authoritiesOf(BOSS)).toEqual(['MODERATOR', 'STAFF', 'USER']);
  });
});
