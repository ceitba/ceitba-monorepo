// Ports apps/api/src/test/java/org/ceitba/api/web/career/CareerEndpointsIT.java
// and CareerWritesIT.java. ROLE_STAFF comes from a real ceitba_staff row.
import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { apiKey, bearer, mintJwt, seedApiKey, seedCareer, seedPlan, seedStaff, useServer, type As } from '../support';

const api = useServer();
let user: As;
let staff: As;

beforeAll(async () => {
  await seedStaff(api.db, 'boss@itba.edu.ar');
  user = bearer(await mintJwt({ email: 'regular@itba.edu.ar' }));
  staff = bearer(await mintJwt({ email: 'boss@itba.edu.ar' }));
});

const reset = async () => {
  await api.db`DELETE FROM public.plan`;
  await api.db`DELETE FROM public.careers`;
};

describe('CareerEndpointsIT', () => {
  beforeEach(async () => {
    await reset();
    await seedCareer(api.db, 'S', 'Sistemas');
    await seedCareer(api.db, 'I', 'Industrial');
    await seedPlan(api.db, 'S10-Rev23', 'S', 'Plan 2023');
    await seedPlan(api.db, 'S10-Rev18', 'S', 'Plan 2018');
    await seedPlan(api.db, 'I07-Rev22', 'I', 'Plan 2022');
  });

  test('getAllCareersReturnsListWithEmptyPlansArrays', async () => {
    const r = await api.get('/v1/careers');
    expect(r.status).toBe(200);
    expect(r.text).toBe('[{"id":"I","name":"Industrial","plans":[]},{"id":"S","name":"Sistemas","plans":[]}]');
  });

  test('getCareerByIdReturnsTheOne', async () => {
    const r = await api.get('/v1/careers/S');
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ id: 'S', name: 'Sistemas', plans: [] });
  });

  test('getCareerByUnknownIdReturns404', async () => {
    const r = await api.get('/v1/careers/NOPE');
    expect(r.status).toBe(404);
    expect(r.json.error).toBe('ResourceNotFound');
    expect(r.json.message).toBe("Career with identifier 'NOPE' not found");
  });

  test('getCareersWithPlansReturnsMapKeyedByIdWithPlanIdArrays', async () => {
    const r = await api.get('/v1/careers/plans');
    expect(r.status).toBe(200);
    expect(r.text).toBe('{"I":{"id":"I","name":"Industrial","plans":["I07-Rev22"]},"S":{"id":"S","name":"Sistemas","plans":["S10-Rev18","S10-Rev23"]}}');
  });
});

describe('CareerWritesIT', () => {
  beforeEach(reset);

  test('anonymousCannotCreate', async () => {
    expect((await api.post('/v1/careers', { body: { id: 'S', name: 'Sistemas' } })).status).toBe(401);
  });

  test('regularUserCannotCreate', async () => {
    const r = await api.post('/v1/careers', { as: user, body: { id: 'S', name: 'Sistemas' } });
    expect(r.status).toBe(403);
    expect(r.json).toMatchObject({ error: 'AccessDenied', message: 'Insufficient permissions', path: '/api/v1/careers' });
  });

  test('staffCanCreate_returns201', async () => {
    const r = await api.post('/v1/careers', { as: staff, body: { id: 'S', name: 'Sistemas' } });
    expect(r.status).toBe(201);
    expect(r.text).toBe('{"id":"S","name":"Sistemas","plans":[]}');
  });

  test('duplicateIdReturns409', async () => {
    await seedCareer(api.db, 'S', 'Sistemas');
    const r = await api.post('/v1/careers', { as: staff, body: { id: 'S', name: 'Sistemas v2' } });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe('ResourceAlreadyExists');
    expect(r.json.message).toBe("Career with identifier 'S' already exists");
  });

  test('missingNameReturns400', async () => {
    const r = await api.post('/v1/careers', { as: staff, body: { id: 'S', name: '' } });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('ValidationError');
    expect(r.json.message).toBe('name: must not be blank');
  });

  test('putUpdatesNameOnly', async () => {
    await seedCareer(api.db, 'S', 'Sistemas');
    const r = await api.put('/v1/careers/S', { as: staff, body: { name: 'Sistemas (Reformado)' } });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ id: 'S', name: 'Sistemas (Reformado)', plans: [] });
  });

  test('putUnknownIdReturns404', async () => {
    const r = await api.put('/v1/careers/NOPE', { as: staff, body: { name: 'x' } });
    expect(r.status).toBe(404);
    expect(r.json.error).toBe('ResourceNotFound');
  });

  test('deleteReturns204AndRemoves', async () => {
    await seedCareer(api.db, 'X', 'Removable');
    const r = await api.delete('/v1/careers/X', { as: staff });
    expect(r.status).toBe(204);
    expect(r.text).toBe('');
    expect((await api.get('/v1/careers/X')).status).toBe(404);
  });

  test('deleteUnknownReturns404', async () => {
    expect((await api.delete('/v1/careers/NOPE', { as: staff })).status).toBe(404);
  });

  test('deleteCareerWithPlansReturns409', async () => {
    await seedCareer(api.db, 'S', 'Sistemas');
    await seedPlan(api.db, 'S10-Rev23', 'S', 'Plan 2023');
    const r = await api.delete('/v1/careers/S', { as: staff });
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ error: 'DataIntegrityViolation', message: 'Operation violates a database constraint' });
  });

  test('regularUserCannotDelete', async () => {
    await seedCareer(api.db, 'X', 'x');
    expect((await api.delete('/v1/careers/X', { as: user })).status).toBe(403);
  });

  test('staffCanAddPlanToCareer', async () => {
    await seedCareer(api.db, 'PAI', 'Proceso de Admisión');
    const r = await api.post('/v1/careers/PAI/plans', { as: staff, body: { id: ' PX27 Proceso I ' } });
    expect(r.status).toBe(201);
    expect(r.text).toBe('{"id":"PX27 Proceso I","careerId":"PAI","name":"PX27 Proceso I"}');
    const plans = await api.get('/v1/careers/plans');
    expect(plans.json.PAI.plans[0]).toBe('PX27 Proceso I');
  });

  test('addPlanKeepsExplicitName', async () => {
    await seedCareer(api.db, 'S', 'Sistemas');
    const r = await api.post('/v1/careers/S/plans', { as: staff, body: { id: 'S30', name: 'Plan 2030' } });
    expect(r.status).toBe(201);
    expect(r.json.name).toBe('Plan 2030');
  });

  test('addPlanWithIdUsedByAnyCareerReturns409', async () => {
    await seedCareer(api.db, 'S', 'Sistemas');
    await seedCareer(api.db, 'I', 'Industrial');
    await seedPlan(api.db, 'S10-Rev23', 'S', 'Plan 2023');
    const r = await api.post('/v1/careers/I/plans', { as: staff, body: { id: 'S10-Rev23' } });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe('ResourceAlreadyExists');
  });

  test('addPlanToUnknownCareerReturns404', async () => {
    expect((await api.post('/v1/careers/NOPE/plans', { as: staff, body: { id: 'X1' } })).status).toBe(404);
  });

  test('addPlanValidatesId', async () => {
    await seedCareer(api.db, 'S', 'Sistemas');
    const r = await api.post('/v1/careers/S/plans', { as: staff, body: { id: 'x'.repeat(26) } });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('ValidationError');
    expect(r.json.message).toBe('id: size must be between 0 and 25');
  });

  test('regularUserCannotAddPlan', async () => {
    await seedCareer(api.db, 'S', 'Sistemas');
    expect((await api.post('/v1/careers/S/plans', { as: user, body: { id: 'S30' } })).status).toBe(403);
    expect((await api.post('/v1/careers/S/plans', { body: { id: 'S30' } })).status).toBe(401);
  });

  // Not in CareerWritesIT: the plans of one career with their names (the /manage editor) and renaming a plan.
  test('getCareerPlansListsThemWithNamesInIdOrder', async () => {
    await seedCareer(api.db, 'S', 'Sistemas');
    await seedCareer(api.db, 'I', 'Industrial');
    await seedPlan(api.db, 'S10-Rev23', 'S', 'Plan 2023');
    await seedPlan(api.db, 'S10-Rev18', 'S', null);
    await seedPlan(api.db, 'I07-Rev22', 'I', 'Plan 2022');
    const r = await api.get('/v1/careers/S/plans');
    expect(r.status).toBe(200);
    expect(r.text).toBe('[{"id":"S10-Rev18","careerId":"S","name":null},{"id":"S10-Rev23","careerId":"S","name":"Plan 2023"}]');
    expect((await api.get('/v1/careers/I/plans', { as: user })).json.map((p: { id: string }) => p.id)).toEqual(['I07-Rev22']);
    await seedCareer(api.db, 'E', 'Vacía');
    expect((await api.get('/v1/careers/E/plans')).text).toBe('[]');
    const missing = await api.get('/v1/careers/NOPE/plans');
    expect(missing.status).toBe(404);
    expect(missing.json.error).toBe('ResourceNotFound');
  });

  test('staffCanRenameAPlan', async () => {
    await seedCareer(api.db, 'S', 'Sistemas');
    await seedPlan(api.db, 'S10-Rev23', 'S', 'Plan 2023');
    const r = await api.put('/v1/careers/S/plans/S10-Rev23', { as: staff, body: { name: '  Plan 2023 (rev.)  ' } });
    expect(r.status).toBe(200);
    expect(r.text).toBe('{"id":"S10-Rev23","careerId":"S","name":"Plan 2023 (rev.)"}');
    const [row] = await api.db`SELECT name FROM public.plan WHERE id = 'S10-Rev23'`;
    expect(row!.name).toBe('Plan 2023 (rev.)');
  });

  test('renamePlanErrors', async () => {
    await seedCareer(api.db, 'S', 'Sistemas');
    await seedCareer(api.db, 'I', 'Industrial');
    await seedPlan(api.db, 'S10-Rev23', 'S', 'Plan 2023');
    // The plan must belong to the career in the path.
    expect((await api.put('/v1/careers/I/plans/S10-Rev23', { as: staff, body: { name: 'x' } })).status).toBe(404);
    expect((await api.put('/v1/careers/S/plans/NOPE', { as: staff, body: { name: 'x' } })).status).toBe(404);
    expect((await api.put('/v1/careers/NOPE/plans/S10-Rev23', { as: staff, body: { name: 'x' } })).status).toBe(404);
    const blank = await api.put('/v1/careers/S/plans/S10-Rev23', { as: staff, body: { name: ' ' } });
    expect(blank.status).toBe(400);
    expect(blank.json.error).toBe('ValidationError');
    expect((await api.put('/v1/careers/S/plans/S10-Rev23', { as: staff, body: { name: 'x'.repeat(256) } })).status).toBe(400);
  });

  test('regularUserCannotRenameAPlan', async () => {
    await seedCareer(api.db, 'S', 'Sistemas');
    await seedPlan(api.db, 'S10-Rev23', 'S', 'Plan 2023');
    expect((await api.put('/v1/careers/S/plans/S10-Rev23', { as: user, body: { name: 'x' } })).status).toBe(403);
    expect((await api.put('/v1/careers/S/plans/S10-Rev23', { body: { name: 'x' } })).status).toBe(401);
    // A staff member's API key without the staff scope is a plain USER.
    const staffId = await seedStaff(api.db, 'boss@itba.edu.ar');
    const key = await seedApiKey(api.db, staffId, ['read', 'write']);
    expect((await api.put('/v1/careers/S/plans/S10-Rev23', { as: apiKey(key.key), body: { name: 'x' } })).status).toBe(403);
    const [row] = await api.db`SELECT name FROM public.plan WHERE id = 'S10-Rev23'`;
    expect(row!.name).toBe('Plan 2023');
  });

  // Not in CareerWritesIT: Jackson scalar coercion and @PreAuthorize after validation.
  test('jacksonCoercesScalarsToStrings', async () => {
    const r = await api.post('/v1/careers', { as: staff, body: { id: 123, name: true } });
    expect(r.status).toBe(201);
    expect(r.text).toBe('{"id":"123","name":"true","plans":[]}');
  });

  test('validationRunsBeforePreAuthorize', async () => {
    const r = await api.post('/v1/careers', { as: user, body: { id: 'x'.repeat(26), name: 'ok' } });
    expect(r.status).toBe(400);
  });
});
