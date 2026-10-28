// Staff edits to a plan's subjects win over ITBA (docs/PLANS.md "Staff edits"):
// the sync keeps replacing ITBA's copy (plan_entry), never the edits
// (plan_entry_override), and every reader sees ITBA's plan with the edits
// applied (plan_entry_effective). Driven end to end: mock gateway, sync key,
// the STAFF routes of /v1/plans and the readers.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { startMockItba } from '../../test/itba/mockItba';
import { apiKey, bearer, mintJwt, seedPlan, seedPlanEntry, seedStaff, TEST_SYNC_KEY, useServer, type As } from '../support';

const itba = startMockItba();
const api = useServer({ env: itba.env });
afterAll(() => itba.stop());
const sync = apiKey(TEST_SYNC_KEY);
let staff: As;

type W = { name: string; code: string; credits: string; creditsRequired?: string };
const term = (year: string, period: string, ...entry: W[]) => ({ year, period, entries: { entry: entry.map((e) => ({ type: 'subject', ...e })) } });
const plan = (algoritmos: W, extra: W[] = []) => ({ careerplan: { name: 'X', section: [
  { name: 'Básico', terms: { term: [term('1', '1', algoritmos, ...extra)] } },
  { name: 'Orientación Imagen', terms: { term: [term('4', '1', { name: 'Visión', code: '72.27', credits: '3' })] } },
  { name: 'Orientación Datos', terms: { term: [term('4', '2', { name: 'Visión', code: '72.27', credits: '3' })] } },
  { name: 'Electivas', withoutTerm: { withoutTerm: { type: 'subject', name: 'Tópicos', code: '93.99', credits: '4', creditsRequired: '120' } } },
] } });
const rows = async (path = '/v1/plans/X-26/subjects') =>
  (await api.get(path)).json.map((r: { subjectId: string; section: string; year: number; creditsRequired: number; subject: { name: string } | null }) =>
    `${r.subjectId}|${r.section}|${r.year}|${r.creditsRequired}|${r.subject?.name ?? '-'}`);

beforeAll(async () => {
  await seedStaff(api.db, 'boss@itba.edu.ar');
  staff = bearer(await mintJwt({ email: 'boss@itba.edu.ar' }));
});

describe('PlanEntryOverridesIT', () => {
  beforeEach(async () => {
    itba.reset();
    await api.db`DELETE FROM public.plan_entry`;
    await api.db`DELETE FROM public.plan WHERE id = 'X-26'`;
    await api.db`INSERT INTO public.careers (id, name, updated_at) VALUES ('XC', 'Carrera X', now()) ON CONFLICT DO NOTHING`;
    await seedPlan(api.db, 'X-26', 'XC', 'Plan X');
    await api.db`INSERT INTO public.subject (id, name, credits, updated_at) VALUES ('61.01', 'Economía', 3, now()) ON CONFLICT DO NOTHING`;
  });

  test('staffEditsSurviveTheSyncAndEveryReaderSeesThem', async () => {
    itba.stubPlanBody('X-26', plan({ name: 'Algoritmos', code: '93.12', credits: '6' }));
    await api.post('/v1/sync/plan/X-26/subjects', { as: sync });
    expect(await rows()).toEqual(['93.12|Básico|1|0|Algoritmos', '72.27|Orientación Imagen|4|0|Visión', '72.27|Orientación Datos|4|0|Visión', '93.99|Electivas|0|120|Tópicos']);
    // One subject in two sections: the single route gives the first.
    expect((await api.get('/v1/plans/X-26/subject/72.27')).json.section).toBe('Orientación Imagen');

    expect((await api.put('/v1/plans/X-26/subject/93.12', { as: staff, body: { year: 2, creditsRequired: 30 } })).json.creditsRequired).toBe(30);
    expect((await api.put('/v1/plans/X-26/subject/72.27', { as: staff, body: { section: 'Orientación' } })).status).toBe(200);
    expect((await api.delete('/v1/plans/X-26/subject/93.99', { as: staff })).status).toBe(204);
    expect((await api.post('/v1/plans/X-26/subject', { as: staff, body: { subjectId: '61.01', section: 'Extra', year: 3, semester: 1 } })).status).toBe(201);

    // ITBA changes the plan: its new values flow in, except where staff decided.
    itba.stubPlanBody('X-26', plan({ name: 'Algoritmos v2', code: '93.12', credits: '6', creditsRequired: '5' }, [{ name: 'Álgebra', code: '93.58', credits: '6' }]));
    await api.post('/v1/sync/subjects', { as: sync });
    const expected = ['93.12|Básico|2|30|Algoritmos v2', '93.58|Básico|1|0|Álgebra', '72.27|Orientación|4|0|Visión', '61.01|Extra|3|0|Economía'];
    expect(await rows()).toEqual(expected);

    const organized = (await api.get('/v1/subjects?plan=X-26')).json;
    expect(Object.keys(organized)).toEqual(['Básico', 'Orientación', 'Extra']);
    expect(organized['Básico']['2']['1'][0]).toMatchObject({ subject_id: '93.12', credits_required: 30, name: 'Algoritmos v2' });
    expect(organized.Extra['3']['1'][0]).toMatchObject({ subject_id: '61.01', name: 'Economía', credits: 3 });
    expect((await api.get('/v1/plans/subjects/93.99/plans')).text).toBe('[]');
  });

  test('deleteHidesAnItbaSubjectAndRemovesAStaffOne_postBringsItBack', async () => {
    itba.stubPlanBody('X-26', plan({ name: 'Algoritmos', code: '93.12', credits: '6' }));
    await api.post('/v1/sync/plan/X-26/subjects', { as: sync });
    await api.post('/v1/plans/X-26/subject', { as: staff, body: { subjectId: '61.01', section: 'Extra' } });
    expect((await api.delete('/v1/plans/X-26/subject/61.01', { as: staff })).status).toBe(204);
    expect((await api.db`SELECT count(*)::int AS n FROM public.plan_entry_override WHERE subject_id = '61.01'`)[0]!.n).toBe(0);
    expect((await api.delete('/v1/plans/X-26/subject/61.01', { as: staff })).status).toBe(404);

    await api.delete('/v1/plans/X-26/subject/93.99', { as: staff });
    expect((await api.get('/v1/plans/X-26/subject/93.99')).status).toBe(404);
    const back = await api.post('/v1/plans/X-26/subject', { as: staff, body: { subjectId: '93.99', section: 'Electivas', creditsRequired: 100 } });
    expect(back.status).toBe(201);
    expect(back.json).toMatchObject({ subjectId: '93.99', section: 'Electivas', creditsRequired: 100 });
  });

  // A plan only copied from plan_subject by the V66 backfill is fetched live once, stored, then read from the database.
  test('aBackfilledPlanIsFetchedOnceAndStored', async () => {
    await seedPlanEntry(api.db, { planId: 'X-26', subjectId: '93.12', section: 'Básico', year: 1, semester: 1, source: 'BACKFILL' });
    itba.stubPlanBody('X-26', plan({ name: 'Algoritmos', code: '93.12', credits: '6' }));
    expect(Object.keys((await api.get('/v1/subjects?plan=X-26')).json)).toEqual(['Básico', 'Orientación Imagen', 'Orientación Datos', 'Electivas']);
    expect(itba.requests.length).toBe(1);
    expect((await api.db`SELECT DISTINCT source FROM public.plan_entry WHERE plan_id = 'X-26'`).map((r) => r.source)).toEqual(['ITBA']);
    await api.get('/v1/subjects?plan=X-26');
    expect(itba.requests.length).toBe(1);
  });
});
