// Exact in-process port of apps/api/src/test/java/org/ceitba/api/service/sync/DataSyncServiceIT.java:
// DataSyncService driven directly with a staged FakeItbaApiClient, so the
// counters Jackson never serializes (subjects, commissions) are asserted too.
// The black-box version (real client + mock gateway, both servers) is
// contract/tests/sync-data-sync.contract.test.ts.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { FakeItbaApiClient, type CommissionProjection, type SubjectPlanProjection, type TimeSlot } from '../../src/external/itba';
import { CareerService } from '../../src/features/career/service';
import { DataSyncService } from '../../src/features/sync/dataSync';
import { testApp, type TestApp } from '../support/app';

const fake = new FakeItbaApiClient();
let t: TestApp;
let sync: DataSyncService;
beforeAll(async () => {
  t = await testApp({ overrides: { itba: fake } });
  sync = new DataSyncService(t.deps);
}, 60_000);
afterAll(async () => { await t?.close(); });

const DEFAULTS = { year: null, period: null, levels: null };
const sp = (subjectId: string, planId: string, section: string, year: number | null, semester: number | null, deps: string[], cr: number | null, name: string | null, credits: number): SubjectPlanProjection =>
  ({ subjectId, planId, section, year, semester, dependencies: deps, creditsRequired: cr, subjectName: name, subjectCredits: credits });
const slot = (day: TimeSlot['day'], classroom: string, building: string, from: string, to: string): TimeSlot => ({ day, classroom, building, hourFrom: `${from}:00`, hourTo: `${to}:00` });
const cp = (id: string, code: string, subjectName: string | null, name: string | null, start: string, end: string, enrolled: number, quota: number,
  type: CommissionProjection['subjectType'], times: TimeSlot[]): CommissionProjection =>
  ({ id, subjectCode: code, subjectName, commissionName: name as string, courseStart: start, courseEnd: end, enrolledStudents: enrolled, quota, subjectType: type, times });
const commission = (enrolled: number, quota: number, times: TimeSlot[]) => cp('93.12-A', '93.12', 'Algoritmos', 'A', '2025-07-21', '2025-12-31', enrolled, quota, 'SEMESTRAL', times);
const count = async (table: string) => Number((await t.sql.unsafe(`SELECT count(*)::int AS n FROM public.${table}`))[0]!.n);
async function times(id: string) {
  const rows = await t.sql`SELECT ct.day::text AS day, to_char(ct.hour_from, 'HH24:MI') AS f, to_char(ct.hour_to, 'HH24:MI') AS tt, ct.classroom
    FROM public.commission_time ct WHERE ct.course_id = ${id} ORDER BY ct.day, ct.hour_from`;
  return rows.map((r) => `${r.day} ${r.f}-${r.tt} ${r.classroom}`);
}
const today = () => t.deps.clock.today();

describe('DataSyncServiceIT', () => {
  beforeEach(async () => {
    await t.sql`DELETE FROM public.commission`;
    await t.sql`DELETE FROM public.plan_subject`;
    await t.sql`DELETE FROM public.subject`;
    await t.sql`DELETE FROM public.plan`;
    await t.sql`DELETE FROM public.careers`;
    fake.reset();
    await t.sql`INSERT INTO public.careers (id, name, updated_at) VALUES ('S', 'Sistemas', now())`;
    await t.sql`INSERT INTO public.plan (id, career_id, name, updated_at) VALUES ('S10-Rev23', 'S', 'Plan 2023', now())`;
  });

  test('syncAllCreatesSubjectsPlansAndCommissions', async () => {
    fake.stubPlan('S10-Rev23', [sp('93.12', 'S10-Rev23', 'Ciclo Básico', 1, 1, [], 0, 'Algoritmos', 6), sp('93.13', 'S10-Rev23', 'Ciclo Básico', 1, 2, ['93.12'], 0, 'Algoritmos II', 6)]);
    fake.stubCommissions([commission(10, 30, [slot('MONDAY', '102T', 'SDT', '14:00', '17:00')])]);
    const r = await sync.syncAll(DEFAULTS);
    expect(r.subjects.created).toBe(2);
    expect(r.subjectPlans.created).toBe(2);
    expect(r.commissions.created).toBe(1);
    expect(await count('subject')).toBe(2);
    expect(await count('plan_subject')).toBe(2);
    expect(await count('commission')).toBe(1);
  });

  // Not in the Java IT: the elective-group credits (term entries of type "section") are replaced on every sync.
  test('syncReplacesPlanSectionRequirements', async () => {
    const req = (section: string, credits: number, year: number, semester: number) => ({ planId: 'S10-Rev23', section, credits, year, semester });
    const rows = async () => (await t.sql`SELECT section, credits, year, semester FROM public.plan_section_requirement
      WHERE plan_id = 'S10-Rev23' ORDER BY section`).map((r) => `${r.section}:${r.credits}@${r.year}.${r.semester}`);
    fake.stubPlan('S10-Rev23', [sp('93.12', 'S10-Rev23', 'Ciclo Básico', 1, 1, [], 0, 'Algoritmos', 6)],
      [req('Electivas Gestíon', 18, 3, 1), req('Electivas Social', 12, 3, 2)]);
    await sync.syncSubjectsAndPlansOnly();
    expect(await rows()).toEqual(['Electivas Gestíon:18@3.1', 'Electivas Social:12@3.2']);

    fake.stubPlan('S10-Rev23', [sp('93.12', 'S10-Rev23', 'Ciclo Básico', 1, 1, [], 0, 'Algoritmos', 6)],
      [req('Electivas Social', 15, 4, 1), req('Electivas', 27, 4, 2)]);
    const second = await sync.syncSubjectsAndPlansOnly();
    expect(second.subjectPlans.errors).toBe(0);
    expect(await rows()).toEqual(['Electivas:27@4.2', 'Electivas Social:15@4.1']);

    fake.stubPlan('S10-Rev23', [sp('93.12', 'S10-Rev23', 'Ciclo Básico', 1, 1, [], 0, 'Algoritmos', 6)]);
    await sync.syncByPlan('S10-Rev23');
    expect(await rows()).toEqual([]);
  });

  // plan_entry keeps the plan exactly as fetched (every section, ITBA's order, its nulls) and is replaced each sync.
  test('syncStoresThePlanEntriesAsFetched', async () => {
    const rows = async () => (await t.sql`SELECT position, subject_id, section, year, semester, dependencies, credits_required, subject_name, subject_credits
      FROM public.plan_entry WHERE plan_id = 'S10-Rev23' ORDER BY position`).map((r) => ({ ...r }));
    fake.stubPlan('S10-Rev23', [
      sp('72.27', 'S10-Rev23', 'Orientación Imagen', 4, 1, ['72.10'], 144, 'Visión', 3),
      sp('72.27', 'S10-Rev23', 'Orientación Datos', 4, 2, [], null, 'Visión (Datos)', 4),
      sp('93.99', 'S10-Rev23', 'Electivas', null, null, [], null, 'Tópicos', 4),
    ]);
    const r = await sync.syncSubjectsAndPlansOnly();
    expect(r.subjectPlans.errors).toBe(0);
    expect(await rows()).toEqual([
      { position: 0, subject_id: '72.27', section: 'Orientación Imagen', year: 4, semester: 1, dependencies: ['72.10'], credits_required: 144, subject_name: 'Visión', subject_credits: 3 },
      { position: 1, subject_id: '72.27', section: 'Orientación Datos', year: 4, semester: 2, dependencies: [], credits_required: null, subject_name: 'Visión (Datos)', subject_credits: 4 },
      { position: 2, subject_id: '93.99', section: 'Electivas', year: null, semester: null, dependencies: [], credits_required: null, subject_name: 'Tópicos', subject_credits: 4 },
    ]);
    fake.stubPlan('S10-Rev23', [sp('93.12', 'S10-Rev23', 'Ciclo Básico', 1, 1, [], null, 'Algoritmos', 6)]);
    await sync.syncByPlan('S10-Rev23');
    expect((await rows()).map((x) => x.subject_id)).toEqual(['93.12']);
  });

  // The plan_subject side rolls back as a whole when the database rejects a row (a subject without a name);
  // plan_entry is refreshed anyway, so /v1/subjects never goes stale over it.
  test('aRejectedPlanSubjectRowStillRefreshesThePlanEntries', async () => {
    fake.stubPlan('S10-Rev23', [sp('93.12', 'S10-Rev23', 'Ciclo Básico', 1, 1, [], null, 'Algoritmos', 6), sp('93.77', 'S10-Rev23', 'Ciclo Básico', 1, 2, [], null, null, 3)]);
    const r = await sync.syncSubjectsAndPlansOnly();
    expect(r.subjectPlans.errors).toBe(1);
    expect(await count('plan_subject')).toBe(0);
    expect((await t.sql`SELECT subject_id, subject_name FROM public.plan_entry ORDER BY position`).map((x) => [x.subject_id, x.subject_name]))
      .toEqual([['93.12', 'Algoritmos'], ['93.77', null]]);
  });

  // A requirement the database rejects (a name over 255 chars) is logged: the subjects sync, the stored groups stay.
  test('aRejectedRequirementNeverFailsThePlanSubjects', async () => {
    fake.stubPlan('S10-Rev23', [], [{ planId: 'S10-Rev23', section: 'Electivas', credits: 27, year: 4, semester: 2 }]);
    await sync.syncSubjectsAndPlansOnly();
    fake.stubPlan('S10-Rev23', [sp('93.12', 'S10-Rev23', 'Ciclo Básico', 1, 1, [], 0, 'Algoritmos', 6)],
      [{ planId: 'S10-Rev23', section: 'x'.repeat(256), credits: 3, year: 1, semester: 1 }]);
    const r = await sync.syncSubjectsAndPlansOnly();
    expect(r.subjectPlans.errors).toBe(0);
    expect(r.subjectPlans.created).toBe(1);
    expect((await t.sql`SELECT section FROM public.plan_section_requirement`).map((x) => x.section)).toEqual(['Electivas']);
  });

  // A plan synced by id before staff added it: its subjects are kept as before, its requirements wait for the plan row.
  test('syncByPlanOfAnUnknownPlanKeepsSubjectsAndSkipsRequirements', async () => {
    fake.stubPlan('X-NEW', [sp('93.12', 'X-NEW', 'Ciclo Básico', 1, 1, [], 0, 'Algoritmos', 6)],
      [{ planId: 'X-NEW', section: 'Electivas', credits: 9, year: 4, semester: 2 }]);
    const subjects = await sync.syncByPlan('X-NEW');
    expect(subjects.map((s) => s.subjectId)).toEqual(['93.12']);
    expect(await count('plan_subject')).toBe(1);
    expect(await count('plan_section_requirement')).toBe(0);
    expect(await count('plan_entry')).toBe(0);
  });

  test('rerunIsIdempotent_noNewCreates', async () => {
    fake.stubPlan('S10-Rev23', [sp('93.12', 'S10-Rev23', 'Ciclo Básico', 1, 1, [], 0, 'Algoritmos', 6)]);
    fake.stubCommissions([]);
    await sync.syncAll(DEFAULTS);
    const second = await sync.syncAll(DEFAULTS);
    expect(second.subjects.created).toBe(0);
    expect(second.subjectPlans.created).toBe(0);
    expect(second.subjects.updated).toBe(0);
  });

  test('detectsSubjectChange_marksUpdated', async () => {
    fake.stubPlan('S10-Rev23', [sp('93.12', 'S10-Rev23', 'Ciclo Básico', 1, 1, [], 0, 'Algoritmos', 6)]);
    fake.stubCommissions([]);
    await sync.syncAll(DEFAULTS);
    fake.stubPlan('S10-Rev23', [sp('93.12', 'S10-Rev23', 'Ciclo Básico', 1, 1, [], 0, 'Algoritmos (Rev)', 7)]);
    const second = await sync.syncAll(DEFAULTS);
    expect(second.subjects.updated).toBe(1);
    const [s] = await t.sql`SELECT name, credits FROM public.subject WHERE id = '93.12'`;
    expect([s!.name, s!.credits]).toEqual(['Algoritmos (Rev)', 7]);
  });

  test('backfillsMissingSubjectFromCommission_usesNameWhenAvailable', async () => {
    fake.stubPlan('S10-Rev23', []);
    fake.stubCommissions([cp('X-A', '99.99', 'Some Real Name', 'A', today(), today(), 0, 30, 'SEMESTRAL', [])]);
    const r = await sync.syncAll(DEFAULTS);
    expect((await t.sql`SELECT name FROM public.subject WHERE id = '99.99'`)[0]!.name).toBe('Some Real Name');
    expect(r.subjects.created).toBe(1);
    expect(r.commissions.created).toBe(1);
  });

  test('backfillsMissingSubject_fallsBackToCodeWhenNameAbsent', async () => {
    fake.stubPlan('S10-Rev23', []);
    fake.stubCommissions([cp('X-A', '99.99', null, 'A', today(), today(), 0, 30, 'SEMESTRAL', [])]);
    await sync.syncAll(DEFAULTS);
    expect((await t.sql`SELECT name FROM public.subject WHERE id = '99.99'`)[0]!.name).toBe('99.99');
  });

  test('planAddedByStaffIsPickedUpByTheNextSync', async () => {
    await t.sql`INSERT INTO public.careers (id, name, updated_at) VALUES ('ENT', 'Programa de ingreso', now())`;
    await new CareerService(t.deps).addPlan('ENT', { id: 'ENT-2027', name: null });
    fake.stubPlan('ENT-2027', [sp('10.01', 'ENT-2027', 'Ingreso', 1, 1, [], 0, 'Matemática de ingreso', 3)]);
    const r = await sync.syncSubjectsAndPlansOnly();
    expect(r.subjectPlans.errors).toBe(0);
    expect(r.subjectPlans.created).toBe(1);
    expect((await t.sql`SELECT 1 FROM public.plan_subject WHERE subject_id = '10.01' AND plan_id = 'ENT-2027'`).length).toBe(1);
  });

  test('resyncUpdatesExistingCommission', async () => {
    fake.stubPlan('S10-Rev23', []);
    fake.stubCommissions([commission(10, 30, [slot('MONDAY', '102T', 'SDT', '14:00', '17:00'), slot('WEDNESDAY', '201F', 'SDF', '09:00', '11:00')])]);
    await sync.syncAll(DEFAULTS);
    fake.stubCommissions([commission(25, 40, [slot('MONDAY', '103T', 'SDT', '14:00', '18:00'), slot('FRIDAY', '301F', 'SDF', '10:00', '12:00')])]);
    const second = await sync.syncCommissionsOnly(DEFAULTS);
    expect(second.commissions.errors).toBe(0);
    expect(second.commissions.updated).toBe(1);
    const [c] = await t.sql`SELECT enrolled_students, quota FROM public.commission WHERE id = '93.12-A'`;
    expect([c!.enrolled_students, c!.quota]).toEqual([25, 40]);
    expect(await times('93.12-A')).toEqual(['MONDAY 14:00-18:00 103T', 'FRIDAY 10:00-12:00 301F']);
  });

  test('syncCommissionsBySubjectUpdatesExistingCommission', async () => {
    fake.stubPlan('S10-Rev23', []);
    fake.stubCommissions([commission(10, 30, [slot('MONDAY', '102T', 'SDT', '14:00', '17:00')])]);
    await sync.syncAll(DEFAULTS);
    fake.stubCommissions([commission(12, 35, [slot('TUESDAY', '102T', 'SDT', '08:00', '10:00')])]);
    await sync.syncCommissionsBySubject('93.12', DEFAULTS);
    const [c] = await t.sql`SELECT enrolled_students, quota FROM public.commission WHERE id = '93.12-A'`;
    expect([c!.enrolled_students, c!.quota]).toEqual([12, 35]);
    expect(await times('93.12-A')).toEqual(['TUESDAY 08:00-10:00 102T']);
  });

  test('resyncStampsTheQueriedTermAndRefreshesNameDatesAndType', async () => {
    fake.stubPlan('S10-Rev23', []);
    fake.stubCommissions([commission(10, 30, [])]);
    await sync.syncAll({ year: 2025, period: 'SecondSemester', levels: null });
    const [stored] = await t.sql`SELECT term_year, term_period FROM public.commission WHERE id = '93.12-A'`;
    expect([stored!.term_year, stored!.term_period]).toEqual([2025, 'SecondSemester']);
    fake.stubCommissions([cp('93.12-A', '93.12', 'Algoritmos', 'A1', '2025-08-04', '2026-07-24', 10, 30, 'ANNUAL', [])]);
    await sync.syncCommissionsBySubject('93.12', { year: 2026, period: 'FirstSemester', levels: null });
    const [c] = await t.sql`SELECT commission_name, course_start::text AS s, course_end::text AS e, subject_type::text AS ty, term_year, term_period FROM public.commission WHERE id = '93.12-A'`;
    expect(c).toEqual({ commission_name: 'A1', s: '2025-08-04', e: '2026-07-24', ty: 'ANNUAL', term_year: 2026, term_period: 'FirstSemester' });
  });

  test('resyncKeepsNameAndTypeWhenUpstreamOmitsThem', async () => {
    fake.stubPlan('S10-Rev23', []);
    fake.stubCommissions([cp('93.12-A', '93.12', 'Algoritmos', 'A', '2026-03-01', '2026-12-31', 10, 30, 'ANNUAL', [])]);
    await sync.syncAll(DEFAULTS);
    fake.stubCommissions([cp('93.12-A', '93.12', 'Algoritmos', null, '2026-03-01', '2026-12-31', 12, 30, null, [])]);
    const second = await sync.syncCommissionsOnly(DEFAULTS);
    expect(second.commissions.errors).toBe(0);
    const [c] = await t.sql`SELECT commission_name, subject_type::text AS ty, enrolled_students FROM public.commission WHERE id = '93.12-A'`;
    expect(c).toEqual({ commission_name: 'A', ty: 'ANNUAL', enrolled_students: 12 });
  });
});
