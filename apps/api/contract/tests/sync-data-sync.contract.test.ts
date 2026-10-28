// Ports apps/api/src/test/java/org/ceitba/api/web/sync/DataSyncControllerIT.java
// and service/sync/DataSyncServiceIT.java. DataSyncServiceIT calls the service
// with a stubbed FakeItbaApiClient; here both servers run their real ITBA
// client against a mock gateway (test/itba/mockItba.ts) and the service is
// driven through POST /v1/sync/* with the sync key. Counters the IT reads from
// DataSyncResult that Jackson does not serialize (subjects, commissions: see
// features/sync/dto.ts) are asserted on the database instead.
// CareerService.addPlan in planAddedByStaff... is POST /v1/careers/{id}/plans as staff.
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { startMockItba, todayArt, type CommissionSpec } from '../../test/itba/mockItba';
import { apiKey, bearer, mintJwt, seedCareer, seedPlan, seedStaff, TEST_SYNC_KEY, useServer } from '../support';

const itba = startMockItba();
const api = useServer({ env: itba.env });
afterAll(() => itba.stop());
const sync = apiKey(TEST_SYNC_KEY);

const count = async (table: string) => Number((await api.db.unsafe(`SELECT count(*)::int AS n FROM public.${table}`))[0]!.n);
async function times(id: string): Promise<string[]> {
  const rows = await api.db`SELECT day::text AS day, to_char(hour_from, 'HH24:MI') AS f, to_char(hour_to, 'HH24:MI') AS t, classroom
    FROM public.commission_time ct WHERE course_id = ${id} ORDER BY ct.day, ct.hour_from`;
  return rows.map((r) => `${r.day} ${r.f}-${r.t} ${r.classroom}`);
}
function commission(enrolled: number, quota: number, slots: CommissionSpec['times']): CommissionSpec {
  return { id: '93.12-A', subjectCode: '93.12', subjectName: 'Algoritmos', commissionName: 'A', courseStart: '2025-07-21', courseEnd: '2025-12-31',
    enrolled, quota, subjectType: 'SEMESTRAL', times: slots };
}

describe('DataSyncControllerIT', () => {
  test('rejectsAnUnknownPeriod', async () => {
    const r = await api.post('/v1/sync/commissions?year=2026&period=SegundoCuatrimestre', { as: sync });
    expect(r.status).toBe(400);
    expect(r.json.message).toBe("Validation failed for field 'period' with value 'SegundoCuatrimestre': must be one of [FirstSemester, SecondSemester]");
  });

  test('rejectsAnOutOfRangeYear', async () => {
    const r = await api.post('/v1/sync/commissions?year=40000', { as: sync });
    expect(r.status).toBe(400);
    expect(r.json.message).toBe("Validation failed for field 'year' with value '40000': must be between 2000 and 2999");
  });

  // Not in the IT: the sync routes need ROLE_SYNC.
  test('requiresTheSyncKey', async () => {
    expect((await api.post('/v1/sync/all')).status).toBe(401);
    expect((await api.post('/v1/sync/all', { as: bearer(await mintJwt({ email: 'u@itba.edu.ar' })) })).status).toBe(403);
  });
});

describe('DataSyncServiceIT', () => {
  beforeEach(async () => {
    itba.reset();
    await api.db`DELETE FROM public.commission`;
    await api.db`DELETE FROM public.plan_subject`;
    await api.db`DELETE FROM public.subject`;
    await api.db`DELETE FROM public.plan`;
    await api.db`DELETE FROM public.careers`;
    await seedCareer(api.db, 'S', 'Sistemas');
    await seedPlan(api.db, 'S10-Rev23', 'S', 'Plan 2023');
  });

  test('syncAllCreatesSubjectsPlansAndCommissions', async () => {
    itba.stubPlan('S10-Rev23', [
      { code: '93.12', section: 'Ciclo Básico', year: 1, semester: 1, creditsRequired: 0, name: 'Algoritmos', credits: 6 },
      { code: '93.13', section: 'Ciclo Básico', year: 1, semester: 2, dependencies: ['93.12'], creditsRequired: 0, name: 'Algoritmos II', credits: 6 },
    ]);
    itba.stubCommissions([commission(10, 30, [{ day: 'MONDAY', classroom: '102T', building: 'SDT', from: '14:00', to: '17:00' }])]);

    const r = await api.post('/v1/sync/all', { as: sync });
    expect(r.status).toBe(200);
    expect(r.json.subjectPlans.created).toBe(2);
    expect(r.text).toMatch(/^\{"totalProcessed":5,"duration":\d+,"subjectPlans":\{"created":2,"updated":0,"errors":0\}\}$/);
    expect(await count('subject')).toBe(2);
    expect(await count('plan_subject')).toBe(2);
    expect(await count('commission')).toBe(1);
    expect(await times('93.12-A')).toEqual(['MONDAY 14:00-17:00 102T']);
    const year = Number(todayArt().slice(0, 4));
    const month = Number(todayArt().slice(5, 7));
    const [c] = await api.db`SELECT term_year, term_period FROM public.commission WHERE id = '93.12-A'`;
    expect(c!.term_year).toBe(year);
    expect(c!.term_period).toBe(month >= 2 && month <= 6 ? 'FirstSemester' : 'SecondSemester');
  });

  test('rerunIsIdempotent_noNewCreates', async () => {
    itba.stubPlan('S10-Rev23', [{ code: '93.12', section: 'Ciclo Básico', year: 1, semester: 1, creditsRequired: 0, name: 'Algoritmos', credits: 6 }]);
    await api.post('/v1/sync/all', { as: sync });
    const [before] = await api.db`SELECT updated_at::text AS u FROM public.subject WHERE id = '93.12'`;

    const second = await api.post('/v1/sync/all', { as: sync });
    expect(second.status).toBe(200);
    expect(second.json.subjectPlans.created).toBe(0);
    // subjects created/updated are not serialized: nothing changed means totalProcessed 0 and an untouched row.
    expect(second.json.totalProcessed).toBe(0);
    const [after] = await api.db`SELECT updated_at::text AS u FROM public.subject WHERE id = '93.12'`;
    expect(after!.u).toBe(before!.u);
  });

  test('detectsSubjectChange_marksUpdated', async () => {
    itba.stubPlan('S10-Rev23', [{ code: '93.12', section: 'Ciclo Básico', year: 1, semester: 1, creditsRequired: 0, name: 'Algoritmos', credits: 6 }]);
    await api.post('/v1/sync/all', { as: sync });
    itba.stubPlan('S10-Rev23', [{ code: '93.12', section: 'Ciclo Básico', year: 1, semester: 1, creditsRequired: 0, name: 'Algoritmos (Rev)', credits: 7 }]);

    const second = await api.post('/v1/sync/all', { as: sync });
    // subjects.updated == 1 and nothing else: totalProcessed 1.
    expect(second.json.totalProcessed).toBe(1);
    const [s] = await api.db`SELECT name, credits FROM public.subject WHERE id = '93.12'`;
    expect(s!.name).toBe('Algoritmos (Rev)');
    expect(s!.credits).toBe(7);
  });

  test('backfillsMissingSubjectFromCommission_usesNameWhenAvailable', async () => {
    const today = todayArt();
    itba.stubCommissions([{ id: 'X-A', subjectCode: '99.99', subjectName: 'Some Real Name', commissionName: 'A', courseStart: today, courseEnd: today, quota: 30 }]);
    const r = await api.post('/v1/sync/all', { as: sync });
    expect(r.status).toBe(200);
    const [s] = await api.db`SELECT name FROM public.subject WHERE id = '99.99'`;
    expect(s!.name).toBe('Some Real Name');
    // subjects.created 1 is not part of totalProcessed? It is: subject created + commission created.
    expect(r.json.totalProcessed).toBe(2);
    expect(await count('commission')).toBe(1);
  });

  test('backfillsMissingSubject_fallsBackToCodeWhenNameAbsent', async () => {
    const today = todayArt();
    itba.stubCommissions([{ id: 'X-A', subjectCode: '99.99', subjectName: null, commissionName: 'A', courseStart: today, courseEnd: today }]);
    await api.post('/v1/sync/all', { as: sync });
    const [s] = await api.db`SELECT name FROM public.subject WHERE id = '99.99'`;
    expect(s!.name).toBe('99.99');
  });

  test('planAddedByStaffIsPickedUpByTheNextSync', async () => {
    await seedCareer(api.db, 'ENT', 'Programa de ingreso');
    await seedStaff(api.db, 'boss@itba.edu.ar');
    const add = await api.post('/v1/careers/ENT/plans', { as: bearer(await mintJwt({ email: 'boss@itba.edu.ar' })), body: { id: 'ENT-2027' } });
    expect(add.status).toBe(201);
    itba.stubPlan('ENT-2027', [{ code: '10.01', section: 'Ingreso', year: 1, semester: 1, creditsRequired: 0, name: 'Matemática de ingreso', credits: 3 }]);

    const r = await api.post('/v1/sync/subjects', { as: sync });
    expect(r.json.subjectPlans.errors).toBe(0);
    expect(r.json.subjectPlans.created).toBe(1);
    const [ps] = await api.db`SELECT count(*)::int AS n FROM public.plan_subject WHERE subject_id = '10.01' AND plan_id = 'ENT-2027'`;
    expect(ps!.n).toBe(1);
  });

  test('resyncUpdatesExistingCommission', async () => {
    itba.stubCommissions([commission(10, 30, [
      { day: 'MONDAY', classroom: '102T', building: 'SDT', from: '14:00', to: '17:00' },
      { day: 'WEDNESDAY', classroom: '201F', building: 'SDF', from: '09:00', to: '11:00' },
    ])]);
    await api.post('/v1/sync/all', { as: sync });
    itba.stubCommissions([commission(25, 40, [
      { day: 'MONDAY', classroom: '103T', building: 'SDT', from: '14:00', to: '18:00' },
      { day: 'FRIDAY', classroom: '301F', building: 'SDF', from: '10:00', to: '12:00' },
    ])]);

    const second = await api.post('/v1/sync/commissions', { as: sync });
    expect(second.status).toBe(200);
    // commissions.updated 1 (errors are not serialized: a failed upsert would leave the row unchanged).
    expect(second.json.totalProcessed).toBe(1);
    const [c] = await api.db`SELECT enrolled_students, quota FROM public.commission WHERE id = '93.12-A'`;
    expect(c!.enrolled_students).toBe(25);
    expect(c!.quota).toBe(40);
    expect(await times('93.12-A')).toEqual(['MONDAY 14:00-18:00 103T', 'FRIDAY 10:00-12:00 301F']);
  });

  test('syncCommissionsBySubjectUpdatesExistingCommission', async () => {
    itba.stubCommissions([commission(10, 30, [{ day: 'MONDAY', classroom: '102T', building: 'SDT', from: '14:00', to: '17:00' }])]);
    await api.post('/v1/sync/all', { as: sync });
    itba.stubCommissions([commission(12, 35, [{ day: 'TUESDAY', classroom: '102T', building: 'SDT', from: '08:00', to: '10:00' }])]);

    const r = await api.post('/v1/sync/subject/93.12/commissions', { as: sync });
    expect(r.status).toBe(200);
    expect(r.text).toBe('[{"id":"93.12-A","subjectCode":"93.12","subjectName":"Algoritmos","commissionName":"A","courseStart":"2025-07-21","courseEnd":"2025-12-31","enrolledStudents":12,"quota":35,"subjectType":"SEMESTRAL","times":[{"day":"TUESDAY","classroom":"102T","building":"SDT","hourFrom":"08:00:00","hourTo":"10:00:00"}]}]');
    const [c] = await api.db`SELECT enrolled_students, quota FROM public.commission WHERE id = '93.12-A'`;
    expect(c!.enrolled_students).toBe(12);
    expect(c!.quota).toBe(35);
    expect(await times('93.12-A')).toEqual(['TUESDAY 08:00-10:00 102T']);
  });

  test('resyncStampsTheQueriedTermAndRefreshesNameDatesAndType', async () => {
    itba.stubCommissions([commission(10, 30, [])]);
    await api.post('/v1/sync/all?year=2025&period=SecondSemester', { as: sync });
    const [stored] = await api.db`SELECT term_year, term_period FROM public.commission WHERE id = '93.12-A'`;
    expect(stored!.term_year).toBe(2025);
    expect(stored!.term_period).toBe('SecondSemester');

    itba.stubCommissions([{ id: '93.12-A', subjectCode: '93.12', subjectName: 'Algoritmos', commissionName: 'A1', courseStart: '2025-08-04', courseEnd: '2026-07-24',
      enrolled: 10, quota: 30, subjectType: 'ANNUAL', times: [] }]);
    const r = await api.post('/v1/sync/subject/93.12/commissions?year=2026&period=FirstSemester', { as: sync });
    expect(r.status).toBe(200);
    expect(itba.requests.at(-1)).toBe('/courseCommissions/tok-123?level=UNDERGRADUATE&year=2026&period=FirstSemester');
    const [c] = await api.db`SELECT commission_name, course_start::text AS s, course_end::text AS e, subject_type::text AS t, term_year, term_period
      FROM public.commission WHERE id = '93.12-A'`;
    expect(c).toEqual({ commission_name: 'A1', s: '2025-08-04', e: '2026-07-24', t: 'ANNUAL', term_year: 2026, term_period: 'FirstSemester' });
  });

  test('resyncKeepsNameAndTypeWhenUpstreamOmitsThem', async () => {
    itba.stubCommissions([{ id: '93.12-A', subjectCode: '93.12', subjectName: 'Algoritmos', commissionName: 'A', courseStart: '2026-03-01', courseEnd: '2026-12-31',
      enrolled: 10, quota: 30, subjectType: 'ANNUAL', times: [] }]);
    await api.post('/v1/sync/all', { as: sync });
    itba.stubCommissions([{ id: '93.12-A', subjectCode: '93.12', subjectName: 'Algoritmos', commissionName: null, courseStart: '2026-03-01', courseEnd: '2026-12-31',
      enrolled: 12, quota: 30, subjectType: null, times: [] }]);

    const second = await api.post('/v1/sync/commissions', { as: sync });
    expect(second.json.totalProcessed).toBe(1);
    const [c] = await api.db`SELECT commission_name, subject_type::text AS t, enrolled_students FROM public.commission WHERE id = '93.12-A'`;
    expect(c).toEqual({ commission_name: 'A', t: 'ANNUAL', enrolled_students: 12 });
  });

  // Not in the IT: a slot change ends the open schedule corrections made against the old slots.
  test('slotChangeResolvesOrSupersedesOpenCorrections', async () => {
    itba.stubCommissions([commission(10, 30, [{ day: 'MONDAY', classroom: '102T', building: 'SDT', from: '14:00', to: '17:00' }])]);
    await api.post('/v1/sync/all', { as: sync });
    const snap = api.db.json([{ day: 'MONDAY', from: '14:00', to: '17:00' }]);
    await api.db`INSERT INTO public.schedule_correction (commission_id, proposed_slots, sga_snapshot, slots_key, status)
      VALUES ('93.12-A', ${api.db.json([{ day: 'TUESDAY', from: '08:00', to: '10:00' }])}, ${snap}, 'a', 'PENDING'),
             ('93.12-A', ${api.db.json([{ day: 'FRIDAY', from: '08:00', to: '10:00' }])}, ${snap}, 'b', 'APPLIED')`;
    itba.stubCommissions([commission(10, 30, [{ day: 'TUESDAY', classroom: '102T', building: 'SDT', from: '08:00', to: '10:00' }])]);
    await api.post('/v1/sync/commissions', { as: sync });
    const rows = await api.db`SELECT slots_key, status FROM public.schedule_correction ORDER BY slots_key`;
    expect(rows.map((r) => `${r.slots_key}:${r.status}`)).toEqual(['a:RESOLVED', 'b:SUPERSEDED']);
  });

  // Not in the IT: a DB failure inside a plan's transaction (subject.name NOT NULL) rolls the whole plan back.
  test('aBadEntryRollsBackItsPlan', async () => {
    await seedPlan(api.db, 'S10-Rev18', 'S', 'Plan 2018');
    itba.stubPlan('S10-Rev23', [
      { code: '93.10', section: 'Ciclo Básico', year: 1, semester: 1, creditsRequired: 0, name: null, credits: 6 },
      { code: '93.12', section: 'Ciclo Básico', year: 1, semester: 1, creditsRequired: 0, name: 'Algoritmos', credits: 6 },
      { code: '93.13', section: 'Ciclo Básico', year: 1, semester: 2, creditsRequired: 0, name: 'Algoritmos II', credits: 6 },
    ]);
    itba.stubPlan('S10-Rev18', [{ code: '93.20', section: 'Ciclo Básico', year: 1, semester: 1, creditsRequired: 0, name: 'Física', credits: 3 }]);
    const r = await api.post('/v1/sync/subjects', { as: sync });
    expect(r.status).toBe(200);
    const plans = await api.db`SELECT plan_id, subject_id FROM public.plan_subject ORDER BY 1, 2`;
    expect(plans.map((p) => `${p.plan_id}/${p.subject_id}`)).toEqual(['S10-Rev18/93.20']);
    // Hibernate flushes at commit: the bad plan's entries are counted, then the commit fails once.
    expect(r.text).toMatch(/^\{"totalProcessed":8,"duration":\d+,"subjectPlans":\{"created":4,"updated":0,"errors":1\}\}$/);
  });

  // Not in the IT: term entries of type "section" become the plan's requirements, replaced on every sync;
  // the per-plan sync response stays the subjects only.
  test('sectionEntriesAreStoredAsPlanRequirements', async () => {
    const plan = (groups: { name: string; credits: string; year: string; period: string }[]) => ({ careerplan: { name: 'S', section: [
      { name: 'Básico', terms: { term: groups.map((g) => ({ year: g.year, period: g.period, entries: { entry: [
        { type: 'subject', name: 'Algoritmos', code: `93.1${g.year}${g.period}`, credits: '6' },
        { type: 'section', name: g.name, credits: g.credits, dependencies: null },
      ] } })) } },
    ] } });
    itba.stubPlanBody('S10-Rev23', plan([{ name: 'Electivas Gestíon', credits: '18', year: '3', period: '1' }, { name: 'Electivas Social', credits: '12', year: '3', period: '2' }]));
    expect((await api.post('/v1/sync/subjects', { as: sync })).json.subjectPlans.errors).toBe(0);
    expect((await api.get('/v1/plans/S10-Rev23/requirements')).text)
      .toBe('[{"section":"Electivas Gestíon","credits":18,"year":3,"semester":1},{"section":"Electivas Social","credits":12,"year":3,"semester":2}]');

    itba.stubPlanBody('S10-Rev23', plan([{ name: 'Electivas', credits: '27', year: '4', period: '2' }]));
    const r = await api.post('/v1/sync/plan/S10-Rev23/subjects', { as: sync });
    expect(r.status).toBe(200);
    expect(r.json.map((s: { subjectId: string }) => s.subjectId)).toEqual(['93.142']);
    expect((await api.get('/v1/plans/S10-Rev23/requirements')).text).toBe('[{"section":"Electivas","credits":27,"year":4,"semester":2}]');
  });

  // Not in the IT: per-plan endpoint, wire edge cases and gateway errors.
  test('syncByPlanReturnsTheProjectionsAndGatewayErrorsAre502', async () => {
    itba.stubPlanBody('S10-Rev23', { careerplan: { name: 'S', section: { name: 'Electivas', withoutTerm: { withoutTerm: [
      { type: 'subject', name: 'Tópicos', code: '93.99', credits: 4, creditsRequired: '120' }, { type: 'note', name: 'x', code: 'n', credits: '0' },
    ] } } } });
    const r = await api.post('/v1/sync/plan/S10-Rev23/subjects', { as: sync });
    expect(r.text).toBe('[{"subjectId":"93.99","planId":"S10-Rev23","section":"Electivas","year":null,"semester":null,"dependencies":[],"creditsRequired":120,"subjectName":"Tópicos","subjectCredits":4}]');
    const [ps] = await api.db`SELECT year, semester, credits_required FROM public.plan_subject WHERE subject_id = '93.99'`;
    expect(ps).toEqual({ year: 0, semester: 0, credits_required: 120 });

    itba.stubPlanBody('S10-Rev23', { careerplan: { section: { name: 'x', terms: { term: { year: '1', period: '1', entries: { entry: { type: 'subject', code: '1', credits: 'six' } } } } } } });
    const bad = await api.post('/v1/sync/plan/S10-Rev23/subjects', { as: sync });
    expect(bad.status).toBe(502);
    expect(bad.json.message).toBe('External API error in ITBA during getSubjectsByPlan');

    itba.stubCommissionsBody('GRADUATE', { oops: true }, 503);
    const c = await api.post('/v1/sync/commissions', { as: sync });
    expect(c.status).toBe(502);
    expect(c.json.message).toBe('External API error in ITBA during getCommissions(level=GRADUATE)');

    // A failing plan is counted as an error, not a 502.
    itba.stubPlanBody('S10-Rev23', {}, 500);
    const all = await api.post('/v1/sync/subjects', { as: sync });
    expect(all.json.subjectPlans.errors).toBe(1);
  });
});
