// Ports apps/api/src/test/java/org/ceitba/api/web/plan/SubjectPlanEndpointsIT.java
// and SubjectPlanWritesIT.java. ROLE_STAFF comes from a real ceitba_staff row.
import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import type { Sql } from 'postgres';
import { bearer, mintJwt, seedCareer, seedPlan, seedPlanEntry, seedStaff, useServer, type As } from '../support';

const api = useServer();
let user: As;
let staff: As;

beforeAll(async () => {
  await seedStaff(api.db, 'boss@itba.edu.ar');
  user = bearer(await mintJwt({ email: 'regular@itba.edu.ar' }));
  staff = bearer(await mintJwt({ email: 'boss@itba.edu.ar' }));
});

// The plan as the sync stores it (plan_entry); the routes read it with the staff edits applied.
async function planSubject(db: Sql, subjectId: string, planId: string, section: string, year: number, semester: number, credits: number, deps: string[]) {
  await seedPlanEntry(db, { planId, subjectId, section, year, semester, creditsRequired: credits, dependencies: deps });
}
async function subject(db: Sql, id: string, name: string, credits: number) {
  await db`INSERT INTO public.subject (id, name, credits, updated_at) VALUES (${id}, ${name}, ${credits}, now())`;
}

describe('SubjectPlanEndpointsIT', () => {
  beforeEach(async () => {
    await api.db`DELETE FROM public.plan_entry`;
    await api.db`DELETE FROM public.plan_entry_override`;
    await planSubject(api.db, '93.12', 'S10-Rev23', 'Ciclo Básico', 1, 1, 0, []);
    await planSubject(api.db, '93.13', 'S10-Rev23', 'Ciclo Básico', 1, 2, 0, ['93.12']);
    await planSubject(api.db, '93.99', 'S10-Rev23', 'Electivas', 0, 0, 120, []);
  });

  test('noFiltersReturnsAll', async () => {
    const r = await api.get('/v1/plans/S10-Rev23/subjects');
    expect(r.status).toBe(200);
    expect(r.json.length).toBe(3);
  });

  test('filterByYearReturnsOnlyMatching', async () => {
    const r = await api.get('/v1/plans/S10-Rev23/subjects?year=1');
    expect(r.status).toBe(200);
    expect(r.json.length).toBe(2);
  });

  test('filterByYearAndSemesterReturnsOne', async () => {
    const r = await api.get('/v1/plans/S10-Rev23/subjects?year=1&semester=2');
    expect(r.status).toBe(200);
    expect(r.json.length).toBe(1);
    expect(r.json[0].subjectId).toBe('93.13');
    expect(r.json[0].dependencies[0]).toBe('93.12');
    // No subject row: the inline shape is null.
    expect(r.text).toBe('[{"subjectId":"93.13","planId":"S10-Rev23","section":"Ciclo Básico","year":1,"semester":2,"dependencies":["93.12"],"creditsRequired":0,"subject":null}]');
  });

  test('electiveTypeReturnsYear0Semester0', async () => {
    const r = await api.get('/v1/plans/S10-Rev23/subjects?type=elective');
    expect(r.status).toBe(200);
    expect(r.json.length).toBe(1);
    expect(r.json[0].subjectId).toBe('93.99');
    expect(r.json[0].creditsRequired).toBe(120);
  });

  test('filterBySection', async () => {
    const r = await api.get('/v1/plans/S10-Rev23/subjects?section=Electivas');
    expect(r.status).toBe(200);
    expect(r.json.length).toBe(1);
    expect(r.json[0].section).toBe('Electivas');
  });

  // Not in the IT: semester alone is ignored; a non-numeric year is a 400.
  test('semesterAloneIsIgnoredAndBadYearIs400', async () => {
    expect((await api.get('/v1/plans/S10-Rev23/subjects?semester=2')).json.length).toBe(3);
    const bad = await api.get('/v1/plans/S10-Rev23/subjects?year=x');
    expect(bad.status).toBe(400);
    expect(bad.json.error).toBe('BadRequest');
  });
});

describe('SubjectPlanWritesIT', () => {
  beforeEach(async () => {
    await api.db`DELETE FROM public.plan_entry`;
    await api.db`DELETE FROM public.plan_entry_override`;
    await api.db`DELETE FROM public.subject`;
    await api.db`DELETE FROM public.plan`;
    await api.db`DELETE FROM public.careers`;
    await seedCareer(api.db, 'S', 'Sistemas');
    await seedPlan(api.db, 'S10-Rev23', 'S', 'Plan 2023');
    await seedPlan(api.db, 'S10-Rev18', 'S', 'Plan 2018');
    await subject(api.db, '93.12', 'Algoritmos', 6);
    await subject(api.db, '93.13', 'Algoritmos II', 6);
  });

  const CREATE = { subjectId: '93.12', section: 'Ciclo Básico', year: 1, semester: 1, creditsRequired: 0, dependencies: [] };

  test('getOneReturnsTheRow', async () => {
    await planSubject(api.db, '93.12', 'S10-Rev23', 'Ciclo Básico', 1, 1, 0, []);
    const r = await api.get('/v1/plans/S10-Rev23/subject/93.12');
    expect(r.status).toBe(200);
    expect(r.json.subjectId).toBe('93.12');
    expect(r.json.planId).toBe('S10-Rev23');
    expect(r.json.subject.name).toBe('Algoritmos');
    expect(r.json.subject.credits).toBe(6);
    expect(r.text).toBe('{"subjectId":"93.12","planId":"S10-Rev23","section":"Ciclo Básico","year":1,"semester":1,"dependencies":[],"creditsRequired":0,"subject":{"id":"93.12","name":"Algoritmos","credits":6}}');
  });

  test('getOneUnknownReturns404', async () => {
    const r = await api.get('/v1/plans/S10-Rev23/subject/93.12');
    expect(r.status).toBe(404);
    expect(r.json.error).toBe('ResourceNotFound');
    expect(r.json.message).toBe("SubjectPlan with identifier 'S10-Rev23/93.12' not found");
  });

  test('getPlansForSubjectReturnsAllContainingPlans', async () => {
    await planSubject(api.db, '93.12', 'S10-Rev23', 'Ciclo Básico', 1, 1, 0, []);
    await planSubject(api.db, '93.12', 'S10-Rev18', 'Ciclo Básico', 1, 2, 0, []);
    const r = await api.get('/v1/plans/subjects/93.12/plans');
    expect(r.status).toBe(200);
    expect(r.json.length).toBe(2);
  });

  test('getPlansForUnknownSubjectReturnsEmptyList', async () => {
    const r = await api.get('/v1/plans/subjects/99.99/plans');
    expect(r.status).toBe(200);
    expect(r.text).toBe('[]');
  });

  test('anonymousCannotCreate', async () => {
    expect((await api.post('/v1/plans/S10-Rev23/subject', { body: CREATE })).status).toBe(401);
  });

  test('regularUserCannotCreate', async () => {
    expect((await api.post('/v1/plans/S10-Rev23/subject', { as: user, body: CREATE })).status).toBe(403);
  });

  test('staffCanCreate_returns201', async () => {
    const r = await api.post('/v1/plans/S10-Rev23/subject', { as: staff, body: CREATE });
    expect(r.status).toBe(201);
    expect(r.json.subjectId).toBe('93.12');
    expect(r.json.planId).toBe('S10-Rev23');
    expect(r.json.year).toBe(1);
    expect(r.json.subject.name).toBe('Algoritmos');
    expect(r.text).toBe('{"subjectId":"93.12","planId":"S10-Rev23","section":"Ciclo Básico","year":1,"semester":1,"dependencies":[],"creditsRequired":0,"subject":{"id":"93.12","name":"Algoritmos","credits":6}}');
  });

  // Not in the IT: nulls are stored as 0 / [] (the NestJS defaults).
  test('createWithNullsStoresDefaults', async () => {
    const r = await api.post('/v1/plans/S10-Rev23/subject', { as: staff, body: { subjectId: '93.13', section: 'Electivas' } });
    expect(r.status).toBe(201);
    expect(r.text).toBe('{"subjectId":"93.13","planId":"S10-Rev23","section":"Electivas","year":0,"semester":0,"dependencies":[],"creditsRequired":0,"subject":{"id":"93.13","name":"Algoritmos II","credits":6}}');
    const [row] = await api.db`SELECT hidden, dependencies, credits_required FROM public.plan_entry_override WHERE subject_id = '93.13'`;
    expect(row).toEqual({ hidden: false, dependencies: [], credits_required: 0 });
  });

  test('createWithUnknownPlanReturns404', async () => {
    const r = await api.post('/v1/plans/NOPE/subject', { as: staff, body: { ...CREATE, section: 'x' } });
    expect(r.status).toBe(404);
    expect(r.json.message).toContain('Plan');
  });

  test('createWithUnknownSubjectReturns404', async () => {
    const r = await api.post('/v1/plans/S10-Rev23/subject', { as: staff, body: { ...CREATE, subjectId: '99.99', section: 'x' } });
    expect(r.status).toBe(404);
    expect(r.json.message).toContain('Subject');
  });

  test('createDuplicateReturns409', async () => {
    await planSubject(api.db, '93.12', 'S10-Rev23', 'Ciclo Básico', 1, 1, 0, []);
    const r = await api.post('/v1/plans/S10-Rev23/subject', { as: staff, body: { ...CREATE, section: 'Other', year: 2 } });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe('ResourceAlreadyExists');
  });

  test('createWithMissingFieldsReturns400', async () => {
    const r = await api.post('/v1/plans/S10-Rev23/subject', { as: staff, body: { section: 'x' } });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('ValidationError');
    expect(r.json.message).toBe('subjectId: must not be blank');
  });

  test('putUpdatesOnlyProvidedFields', async () => {
    await planSubject(api.db, '93.12', 'S10-Rev23', 'Ciclo Básico', 1, 1, 0, ['93.11']);
    const r = await api.put('/v1/plans/S10-Rev23/subject/93.12', { as: staff, body: { year: 2, semester: 2 } });
    expect(r.status).toBe(200);
    expect(r.json.year).toBe(2);
    expect(r.json.semester).toBe(2);
    expect(r.json.section).toBe('Ciclo Básico');
    expect(r.json.dependencies[0]).toBe('93.11');
  });

  test('putUnknownReturns404', async () => {
    expect((await api.put('/v1/plans/S10-Rev23/subject/93.12', { as: staff, body: { year: 2 } })).status).toBe(404);
  });

  test('deleteReturns204', async () => {
    await planSubject(api.db, '93.12', 'S10-Rev23', 'Ciclo Básico', 1, 1, 0, []);
    expect((await api.delete('/v1/plans/S10-Rev23/subject/93.12', { as: staff })).status).toBe(204);
    expect((await api.get('/v1/plans/S10-Rev23/subject/93.12')).status).toBe(404);
  });

  test('deleteUnknownReturns404', async () => {
    expect((await api.delete('/v1/plans/S10-Rev23/subject/93.12', { as: staff })).status).toBe(404);
  });

  test('regularUserCannotDelete', async () => {
    await planSubject(api.db, '93.12', 'S10-Rev23', 'Ciclo Básico', 1, 1, 0, []);
    expect((await api.delete('/v1/plans/S10-Rev23/subject/93.12', { as: user })).status).toBe(403);
  });
});
