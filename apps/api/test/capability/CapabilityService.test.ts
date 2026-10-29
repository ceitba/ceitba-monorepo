// Port of apps/api/src/test/java/org/ceitba/api/service/capability/CapabilityServiceTest.java.
// The effective-capability rule: staff, enabled_for_all, email grant, org grant.
// Java stubs the repositories; here the rule runs on real rows of a test database.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { seedApiKey, seedStaff, seedUser } from '../../contract/support/identity';
import { CapabilityRequiredError } from '../../src/http/errors';
import { CapabilityService } from '../../src/features/capability/service';
import { testApp, type TestApp } from '../support/app';

let t: TestApp;
let svc: CapabilityService;
beforeAll(async () => {
  t = await testApp();
  svc = new CapabilityService(t.deps);
}, 60_000);
afterAll(() => t?.close());

let USER: { id: string; email: string };

describe('CapabilityServiceTest', () => {
  beforeEach(async () => {
    await t.sql`TRUNCATE public."user", public.organizations, public.capability_settings, public.capability_user_grants CASCADE`;
    USER = { id: await seedUser(t.sql, 'Alumno@ITBA.edu.ar', { name: 'A' }), email: 'Alumno@ITBA.edu.ar' };
  });

  test('effectiveCapabilityRule', async () => {
    expect(await svc.effective(USER)).toEqual([]);
    await expect(svc.require(USER, 'apuntes')).rejects.toBeInstanceOf(CapabilityRequiredError);

    await t.sql`INSERT INTO public.capability_settings (capability, enabled_for_all) VALUES ('apuntes', true)`;
    expect(await svc.effective(USER)).toEqual(['apuntes']);
    await t.sql`DELETE FROM public.capability_settings`;

    // Email grants are looked up lowercased; unknown keys in the tables are ignored.
    await t.sql`INSERT INTO public.capability_user_grants (capability, email) VALUES ('apuntes', 'alumno@itba.edu.ar'), ('gone', 'alumno@itba.edu.ar')`;
    expect(await svc.effective(USER)).toEqual(['apuntes']);
    await t.sql`DELETE FROM public.capability_user_grants`;

    await t.sql`INSERT INTO public.organizations (slug, name, full_name) VALUES ('it', 'IT', 'IT')`;
    await t.sql`INSERT INTO public.user_organizations (user_id, org_slug) VALUES (${USER.id}, 'it')`;
    await t.sql`INSERT INTO public.capability_org_grants (capability, org_slug) VALUES ('apuntes', 'it')`;
    expect(await svc.effective(USER)).toEqual(['apuntes']);
    await svc.require(USER, 'apuntes');

    await seedStaff(t.sql, USER.email);
    expect(await svc.effective(USER)).toEqual(['apuntes', 'asistentes_ia', 'resumen_semanal']);
    expect(await svc.effective(null)).toEqual([]);
  });

  // Capabilities are not staff powers: a staff member's key without the "staff" scope keeps them.
  test('aKeyWithoutStaffScopeKeepsStaffCapabilities', async () => {
    await seedStaff(t.sql, USER.email);
    const { key } = await seedApiKey(t.sql, USER.id, []);
    const r = await t.request('GET', '/v1/auth/me', { headers: { 'X-Api-Key': key } });
    expect(r.status).toBe(200);
    expect(r.json.capabilities).toEqual(['apuntes', 'asistentes_ia', 'resumen_semanal']);
  });

  test('enabledForAllIgnoresUnknownKeys', async () => {
    expect(await svc.enabledForAll()).toEqual([]);
    await t.sql`INSERT INTO public.capability_settings (capability, enabled_for_all) VALUES ('resumen_semanal', true), ('gone', true), ('apuntes', true)`;
    expect(await svc.enabledForAll()).toEqual(['apuntes', 'resumen_semanal']);
  });

  test('holdersOfACapability', async () => {
    const other = { id: await seedUser(t.sql, 'other@itba.edu.ar', { name: 'O' }), email: 'other@itba.edu.ar' };
    expect(await svc.holders('apuntes', [USER, other])).toEqual(new Set());
    await t.sql`INSERT INTO public.capability_user_grants (capability, email) VALUES ('apuntes', 'alumno@itba.edu.ar')`;
    expect(await svc.holders('apuntes', [USER, other])).toEqual(new Set([USER.id]));
    await t.sql`INSERT INTO public.capability_settings (capability, enabled_for_all) VALUES ('apuntes', true)`;
    expect(await svc.holders('apuntes', [USER, other])).toEqual(new Set([USER.id, other.id]));
    expect(await svc.holders('apuntes', [])).toEqual(new Set());
  });
});
