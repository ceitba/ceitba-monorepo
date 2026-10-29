// Ports apps/api/src/test/java/org/ceitba/api/web/subject/OrganizedSubjectsIT.java.
// The IT stages FakeItbaApiClient plans; here both servers run their real ITBA
// client against a mock gateway (test/itba/mockItba.ts). The IT's fixed clock
// (2026-10-02 ART) becomes `d()`: every date keeps its distance to the real
// ART today. externalItbaCallRunsOutsideAnyTransaction needs the client inside
// the process: test/subject/organized-subjects-tx.test.ts.
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import type { Sql } from 'postgres';
import { rebase, startMockItba, todayArt } from '../../test/itba/mockItba';
import { apiKey, bearer, mintJwt, seedCareer, seedPlan, seedUser, TEST_SYNC_KEY, useServer } from '../support';

const itba = startMockItba();
const api = useServer({ env: itba.env });
afterAll(() => itba.stop());
const d = rebase('2026-10-02');

async function commission(db: Sql, id: string, subjectCode: string, name: string, start: string, end: string,
  times: [string, string, string, string, string][]) {
  await db`INSERT INTO public.commission (id, subject_code, commission_name, course_start, course_end, enrolled_students, quota, subject_type)
           VALUES (${id}, ${subjectCode}, ${name}, ${start}, ${end}, 0, 0, 'SEMESTRAL')`;
  for (const [day, from, classroom, building, to] of times) {
    await db`INSERT INTO public.commission_time (course_id, day, hour_from, classroom, building, hour_to)
             VALUES (${id}, ${day}::day_of_week, ${from}::time, ${classroom}, ${building}, ${to}::time)`;
  }
}
const saveCommission = (id: string, code: string, name: string, start: string, end: string, classroom: string) =>
  commission(api.db, id, code, name, start, end, [['TUESDAY', '08:00', classroom, 'SDT', '11:00']]);

describe('OrganizedSubjectsIT', () => {
  beforeEach(async () => {
    itba.reset();
    await api.db`DELETE FROM public.commission`;
    // A plan fetched live is stored: each test starts unsynced.
    await api.db`DELETE FROM public.plan_entry`;
  });

  test('getSubjectsByPlanReturnsOrganizedNestedMap', async () => {
    itba.stubPlan('S10-Rev23', [
      { code: '93.12', section: 'Ciclo Básico', year: 1, semester: 1, name: 'Algoritmos', credits: 6 },
      { code: '93.13', section: 'Ciclo Básico', year: 1, semester: 2, dependencies: ['93.12'], name: 'Algoritmos II', credits: 6 },
      { code: '93.99', section: 'Electivas', year: null, semester: null, creditsRequired: 120, name: 'Tópicos Avanzados', credits: 4 },
    ]);
    await commission(api.db, '93.12-A', '93.12', 'A', d('2025-07-21'), d('2025-12-31'), [['MONDAY', '14:00', '102T', 'SDT', '17:00']]);

    const r = await api.get('/v1/subjects?plan=S10-Rev23');
    expect(r.status).toBe(200);
    const s = r.json['Ciclo Básico']['1']['1'][0];
    expect(s.subject_id).toBe('93.12');
    expect(s.name).toBe('Algoritmos');
    expect(s.credits).toBe(6);
    expect(s.commissions[0].name).toBe('A');
    expect(s.commissions[0].schedule[0].day).toBe('MONDAY');
    expect(s.commissions[0].schedule[0].time_from).toBe('14:00:00');
    expect(r.json['Ciclo Básico']['1']['2'][0].dependencies[0]).toBe('93.12');
    expect(r.json.Electivas['0']['0'][0].subject_id).toBe('93.99');
    expect(r.json.Electivas['0']['0'][0].credits_required).toBe(120);
    const today = todayArt();
    expect(r.text).toBe('{"Ciclo Básico":{"1":{"1":[{"section":"Ciclo Básico","subject_id":"93.12","name":"Algoritmos","credits":6,"dependencies":[],"credits_required":null,'
      + `"course_start":"${d('2025-07-21')}","course_end":"${d('2025-12-31')}","commissions":[{"commission_id":"93.12-A","name":"A","course_start":"${d('2025-07-21')}","course_end":"${d('2025-12-31')}",`
      + '"schedule":[{"day":"MONDAY","classroom":"102T","building":"SDT","time_from":"14:00:00","time_to":"17:00:00"}],"corrections":[]}],"past_term":true}],'
      + `"2":[{"section":"Ciclo Básico","subject_id":"93.13","name":"Algoritmos II","credits":6,"dependencies":["93.12"],"credits_required":null,"course_start":"${today}","course_end":"${today}","commissions":[],"past_term":false}]}},`
      + `"Electivas":{"0":{"0":[{"section":"Electivas","subject_id":"93.99","name":"Tópicos Avanzados","credits":4,"dependencies":[],"credits_required":120,"course_start":"${today}","course_end":"${today}","commissions":[],"past_term":false}]}}}`);
    expect(itba.requests).toEqual([`/careerPlans/tok-123?plan=S10-Rev23`]);
  });

  test('pastTermCommissionsAreNotListedAlongsideTheCurrentTerm', async () => {
    itba.stubPlan('S10-Rev23', [{ code: '31.08', section: 'Ciclo Básico', year: 1, semester: 1, name: 'Sistemas de Representación', credits: 3 }]);
    await saveCommission('44001', '31.08', 'G', d('2026-03-01'), d('2026-07-25'), '102T');
    await saveCommission('44002', '31.08', 'B', d('2026-03-01'), d('2026-07-25'), '101T');
    await saveCommission('45120', '31.08', 'G', d('2026-07-26'), d('2026-12-31'), '102T');
    await saveCommission('45114', '31.08', 'B', d('2026-07-26'), d('2026-12-31'), '101T');

    const r = await api.get('/v1/subjects?plan=S10-Rev23');
    expect(r.status).toBe(200);
    const s = r.json['Ciclo Básico']['1']['1'][0];
    expect(s.commissions.length).toBe(2);
    expect(s.commissions.map((c: { name: string }) => c.name)).toEqual(['B', 'G']);
    expect(s.course_start).toBe(d('2026-07-26'));
    expect(s.course_end).toBe(d('2026-12-31'));
    expect(s.past_term).toBe(false);
  });

  test('keepsConcurrentTermsAndFallsBackToMostRecentEndedTerm', async () => {
    itba.stubPlan('S10-Rev23', [
      { code: '81.74', section: 'Electivas', year: null, semester: null, name: 'Electiva bimestral', credits: 3 },
      { code: '72.99', section: 'Electivas', year: null, semester: null, name: 'Electiva de primer cuatrimestre', credits: 3 },
    ]);
    await saveCommission('46512', '81.74', 'A', d('2026-09-14'), d('2026-10-23'), '301F');
    await saveCommission('47536', '81.74', 'A', d('2026-10-26'), d('2026-11-30'), '302F');
    await saveCommission('40001', '72.99', 'A', d('2025-03-01'), d('2025-07-25'), '101T');
    await saveCommission('44100', '72.99', 'A', d('2026-03-01'), d('2026-07-25'), '102T');

    const r = await api.get('/v1/subjects?plan=S10-Rev23');
    expect(r.status).toBe(200);
    const [a, b] = r.json.Electivas['0']['0'];
    expect(a.subject_id).toBe('81.74');
    expect(a.commissions.length).toBe(2);
    expect(a.course_start).toBe(d('2026-09-14'));
    expect(a.past_term).toBe(false);
    expect(a.commissions.map((c: { course_start: string }) => c.course_start)).toEqual([d('2026-09-14'), d('2026-10-26')]);
    expect(a.commissions.map((c: { course_end: string }) => c.course_end)).toEqual([d('2026-10-23'), d('2026-11-30')]);
    expect(b.subject_id).toBe('72.99');
    expect(b.past_term).toBe(true);
    expect(b.commissions.length).toBe(1);
    expect(b.commissions[0].schedule[0].classroom).toBe('102T');
    expect(b.course_start).toBe(d('2026-03-01'));
  });

  test('nextTermSyncedBeforeTheRunningOneEndsReplacesIt', async () => {
    itba.stubPlan('S10-Rev23', [{ code: '31.08', section: 'Ciclo Básico', year: 1, semester: 1, name: 'Sistemas de Representación', credits: 3 }]);
    await saveCommission('45120', '31.08', 'G', d('2026-07-26'), d('2026-12-15'), '102T');
    await saveCommission('45114', '31.08', 'B', d('2026-07-26'), d('2026-12-15'), '101T');
    await saveCommission('48120', '31.08', 'G', d('2027-03-08'), d('2027-07-10'), '202T');
    await saveCommission('48114', '31.08', 'B', d('2027-03-08'), d('2027-07-10'), '201T');

    const r = await api.get('/v1/subjects?plan=S10-Rev23');
    expect(r.status).toBe(200);
    const s = r.json['Ciclo Básico']['1']['1'][0];
    expect(s.commissions.map((c: { commission_id: string }) => c.commission_id)).toEqual(['48114', '48120']);
    expect(s.course_start).toBe(d('2027-03-08'));
    expect(s.course_end).toBe(d('2027-07-10'));
  });

  test('unknownPlanReturns404', async () => {
    const r = await api.get('/v1/subjects?plan=NOPE');
    expect(r.status).toBe(404);
    expect(r.json.error).toBe('ResourceNotFound');
    expect(r.json.message).toBe("Plan with identifier 'NOPE' not found");
  });

  // Not in the IT: the schedule-correction overlay (ScheduleCorrectionService.organizedCommissions).
  test('correctionsOverlayTheScheduleWithMyVote', async () => {
    itba.stubPlan('S10-Rev23', [{ code: '93.12', section: 'Ciclo Básico', year: 1, semester: 1, name: 'Algoritmos', credits: 6 }]);
    await commission(api.db, 'C1', '93.12', 'A', d('2026-08-01'), d('2026-12-01'), [
      ['WEDNESDAY', '09:00', '201', 'SDF', '11:00'], ['MONDAY', '14:00', '102T', 'SDT', '17:00'],
    ]);
    const viewerId = await seedUser(api.db, 'lector@itba.edu.ar');
    const slots = (x: [string, string, string][]) => api.db.json(x.map(([day, from, to]) => ({ day, from, to })));
    const [applied] = await api.db`INSERT INTO public.schedule_correction (commission_id, proposed_slots, sga_snapshot, slots_key, status, confirm_count, reject_count, created_at)
      VALUES ('C1', ${slots([['TUESDAY', '14:00', '17:00'], ['THURSDAY', '09:00', '11:00'], ['FRIDAY', '08:00', '10:00']])}, '[]'::jsonb, 'k1', 'APPLIED', 3, 1, '2026-09-01T10:00:00.123456Z') RETURNING id`;
    const [pending] = await api.db`INSERT INTO public.schedule_correction (commission_id, proposed_slots, sga_snapshot, slots_key, status, confirm_count, reject_count, created_at)
      VALUES ('C1', ${slots([['MONDAY', '15:00', '18:00']])}, '[]'::jsonb, 'k2', 'PENDING', 5, 0, '2026-09-02T10:00:00Z') RETURNING id`;
    await api.db`INSERT INTO public.schedule_correction (commission_id, proposed_slots, sga_snapshot, slots_key, status, confirm_count, reject_count)
      VALUES ('C1', ${slots([['MONDAY', '16:00', '18:00']])}, '[]'::jsonb, 'k3', 'REJECTED', 0, 3)`;
    await api.db`INSERT INTO public.schedule_correction_vote (correction_id, user_id, type) VALUES (${pending!.id}, ${viewerId}, 'CONFIRM')`;

    const anon = await api.get('/v1/subjects?plan=S10-Rev23');
    expect(anon.status).toBe(200);
    const c = anon.json['Ciclo Básico']['1']['1'][0].commissions[0];
    expect(JSON.stringify(c)).toBe(`{"commission_id":"C1","name":"A","course_start":"${d('2026-08-01')}","course_end":"${d('2026-12-01')}",`
      + '"schedule":[{"day":"TUESDAY","classroom":"102T","building":"SDT","time_from":"14:00:00","time_to":"17:00:00"},{"day":"THURSDAY","classroom":"201","building":"SDF","time_from":"09:00:00","time_to":"11:00:00"},{"day":"FRIDAY","classroom":"","building":"","time_from":"08:00:00","time_to":"10:00:00"}],'
      + '"sga_schedule":[{"day":"MONDAY","classroom":"102T","building":"SDT","time_from":"14:00:00","time_to":"17:00:00"},{"day":"WEDNESDAY","classroom":"201","building":"SDF","time_from":"09:00:00","time_to":"11:00:00"}],'
      + `"corrections":[{"id":"${applied!.id}","status":"APPLIED","schedule":[{"day":"TUESDAY","classroom":"102T","building":"SDT","time_from":"14:00:00","time_to":"17:00:00"},{"day":"THURSDAY","classroom":"201","building":"SDF","time_from":"09:00:00","time_to":"11:00:00"},{"day":"FRIDAY","classroom":"","building":"","time_from":"08:00:00","time_to":"10:00:00"}],"confirms":3,"rejects":1,"my_vote":null,"created_at":"2026-09-01T10:00:00.123456Z"},`
      + `{"id":"${pending!.id}","status":"PENDING","schedule":[{"day":"MONDAY","classroom":"102T","building":"SDT","time_from":"15:00:00","time_to":"18:00:00"}],"confirms":5,"rejects":0,"my_vote":null,"created_at":"2026-09-02T10:00:00Z"}]}`);
    // Raw byte check: the response text carries the same object.
    expect(anon.text).toContain(JSON.stringify(c));

    const mine = await api.get('/v1/subjects?plan=S10-Rev23', { as: bearer(await mintJwt({ email: 'lector@itba.edu.ar' })) });
    expect(mine.status).toBe(200);
    const votes = mine.json['Ciclo Básico']['1']['1'][0].commissions[0].corrections.map((x: { my_vote: string | null }) => x.my_vote);
    expect(votes).toEqual([null, 'CONFIRM']);
  });

  // Not in the IT: the ITBA gateway failing is a 502.
  test('gatewayErrorReturns502', async () => {
    itba.stubPlanBody('S10-Rev23', { error: 'boom' }, 500);
    const r = await api.get('/v1/subjects?plan=S10-Rev23');
    expect(r.status).toBe(502);
    expect(r.json.error).toBe('ExternalApiError');
    expect(r.json.message).toBe('External API error in ITBA during getSubjectsByPlan');
    const missing = await api.get('/v1/subjects');
    expect(missing.status).toBe(400);
  });
});

// Not in the IT: once the sync stored a plan (plan_entry, docs/PLANS.md), GET /v1/subjects?plan= is served from the
// database, byte for byte what the live gateway gave, without calling ITBA. Unsynced plans still go to the gateway.
describe('PlanEntriesIT', () => {
  // A subject in two sections (orientations), an elective with no year, nulls ITBA leaves out.
  const body = { careerplan: { name: 'X', section: [
    { name: 'Ciclo Básico', terms: { term: [
      { year: '1', period: '1', entries: { entry: [
        { type: 'subject', name: 'Algoritmos', code: '93.12', credits: '6' },
        { type: 'subject', name: 'Física I', code: '93.41', credits: '6', creditsRequired: '0' },
      ] } },
      { year: '1', period: '2', entries: { entry: { type: 'subject', name: 'Algoritmos II', code: '93.13', credits: '6', dependencies: { dependency: '93.12' } } } },
    ] } },
    { name: 'Orientación Imagen', terms: { term: { year: '4', period: '1', entries: { entry: { type: 'subject', name: 'Visión', code: '72.27', credits: '3', creditsRequired: '144' } } } } },
    { name: 'Orientación Datos', terms: { term: { year: '4', period: '2', entries: { entry: { type: 'subject', name: 'Visión (Datos)', code: '72.27', credits: '4' } } } } },
    { name: 'Electivas', withoutTerm: { withoutTerm: [
      { type: 'subject', name: 'Tópicos', code: '93.99', credits: '4', creditsRequired: '120' },
      { type: 'subject', name: 'Algoritmos', code: '93.12', credits: '6' },
    ] } },
    // A section without a name: keyed "null", section null.
    { withoutTerm: { withoutTerm: { type: 'subject', name: 'Sin sección', code: '94.01', credits: '2' } } },
  ] } };
  const sync = apiKey(TEST_SYNC_KEY);

  beforeEach(async () => {
    itba.reset();
    await api.db`DELETE FROM public.commission`;
    await api.db`DELETE FROM public.plan_entry`;
    await api.db`DELETE FROM public.plan WHERE id = 'X-26'`;
    await seedCareer(api.db, 'XC', 'Carrera X').catch(() => {});
    await seedPlan(api.db, 'X-26', 'XC', 'Plan X');
  });

  test('servedFromTheDatabaseAfterTheSync_noGatewayCall', async () => {
    itba.stubPlanBody('X-26', body);
    await commission(api.db, '72.27-A', '72.27', 'A', d('2026-08-01'), d('2026-12-01'), [['MONDAY', '14:00', '102T', 'SDT', '17:00']]);
    const live = await api.get('/v1/subjects?plan=X-26');
    expect(live.status).toBe(200);
    expect(itba.requests).toEqual(['/careerPlans/tok-123?plan=X-26']);
    // Both sections of 72.27 and the electives, in ITBA's order.
    expect(Object.keys(live.json)).toEqual(['Ciclo Básico', 'Orientación Imagen', 'Orientación Datos', 'Electivas', 'null']);

    expect((await api.post('/v1/sync/subjects', { as: sync })).status).toBe(200);
    itba.reset();
    const stored = await api.get('/v1/subjects?plan=X-26');
    expect(stored.status).toBe(200);
    expect(stored.text).toBe(live.text);
    expect(itba.requests).toEqual([]);
  });

  test('theNextSyncReplacesTheStoredPlan', async () => {
    itba.stubPlanBody('X-26', body);
    await api.post('/v1/sync/plan/X-26/subjects', { as: sync });
    itba.stubPlanBody('X-26', { careerplan: { section: { name: 'Ciclo Básico', terms: { term: { year: '1', period: '1', entries: { entry: {
      type: 'subject', name: 'Álgebra', code: '93.58', credits: '6' } } } } } } });
    // Between syncs the stored plan is served, whatever the gateway has now.
    expect(Object.keys((await api.get('/v1/subjects?plan=X-26')).json)).toEqual(['Ciclo Básico', 'Orientación Imagen', 'Orientación Datos', 'Electivas', 'null']);
    await api.post('/v1/sync/plan/X-26/subjects', { as: sync });
    const r = await api.get('/v1/subjects?plan=X-26');
    expect(Object.keys(r.json)).toEqual(['Ciclo Básico']);
    expect(r.json['Ciclo Básico']['1']['1'].map((s: { subject_id: string }) => s.subject_id)).toEqual(['93.58']);
  });

  test('aPlanNotYetSyncedGoesToTheGateway', async () => {
    itba.stubPlanBody('X-26', body);
    expect((await api.get('/v1/subjects?plan=X-26')).status).toBe(200);
    expect(itba.requests).toEqual(['/careerPlans/tok-123?plan=X-26']);
  });
});
