// In-process port of apps/api/src/test/java/org/ceitba/api/web/auth/StaffRoleDetectionIT.java:
// the JWT -> roles conversion (StaffAwareJwtAuthenticationConverter) with real rows.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { jwtRoles } from '../../src/http/security';
import { seedStaff, seedUser } from '../../contract/support/identity';
import { testApp, type TestApp } from '../support/app';

let t: TestApp;
beforeAll(async () => { t = await testApp(); }, 60_000);
afterAll(() => t?.close());
const roles = async (email: string) => [...(await jwtRoles(t.deps, email))].sort();

describe('StaffRoleDetectionIT', () => {
  beforeEach(async () => { await t.sql`TRUNCATE public."user" CASCADE`; });

  test('freshUserGetsRoleUserOnly', async () => {
    expect(await roles('alice@itba.edu.ar')).toEqual(['USER']);
  });
  test('existingUserWithoutStaffRowGetsRoleUserOnly', async () => {
    await seedUser(t.sql, 'alice@itba.edu.ar', { name: 'Alice' });
    expect(await roles('alice@itba.edu.ar')).toEqual(['USER']);
  });
  test('userWithActiveStaffRowGetsRoleStaff', async () => {
    await seedStaff(t.sql, 'alice@itba.edu.ar', { startOffsetDays: -1, endOffsetDays: 30 });
    expect(await roles('alice@itba.edu.ar')).toEqual(['MODERATOR', 'STAFF', 'USER']);
  });
  test('userWithExpiredStaffRowGetsRoleUserOnly', async () => {
    await seedStaff(t.sql, 'alice@itba.edu.ar', { startOffsetDays: -60, endOffsetDays: -30 });
    expect(await roles('alice@itba.edu.ar')).toEqual(['USER']);
  });
  test('userWithFutureStaffRowGetsRoleUserOnly', async () => {
    await seedStaff(t.sql, 'alice@itba.edu.ar', { startOffsetDays: 30, endOffsetDays: 60 });
    expect(await roles('alice@itba.edu.ar')).toEqual(['USER']);
  });
});
