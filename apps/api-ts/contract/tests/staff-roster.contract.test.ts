// No Java IT covers StaffRosterController
// (apps/api/src/main/java/org/ceitba/api/web/staff/StaffRosterController.java);
// written for coverage and checked on the jar first. Public reads, STAFF writes.
import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { bearer, mintJwt, seedStaff, useServer, type As } from '../support';

const api = useServer();
let staff: As;
let user: As;

beforeAll(async () => {
  await seedStaff(api.db, 'boss@itba.edu.ar');
  staff = bearer(await mintJwt({ email: 'boss@itba.edu.ar' }));
  user = bearer(await mintJwt({ email: 'regular@itba.edu.ar' }));
});

beforeEach(async () => {
  await api.db`DELETE FROM public.staff_members`;
  await api.db`DELETE FROM public.staff_departments`;
  await api.db`INSERT INTO public.staff_departments (slug, color_var, display_order) VALUES ('it', '--dept-color-it', 2), ('media', '--dept-color-media', 1)`;
});

const member = (o: Record<string, unknown> = {}) => ({
  year: 2026, departmentSlug: 'it', displayOrder: 1, name: 'Ana', roleEs: 'Líder', roleEn: 'Lead',
  photoUrl: 'https://img.example/ana.png', linkedinUrl: null, email: 'ana@itba.edu.ar', ...o,
});

describe('StaffRosterController', () => {
  test('departmentsAreListedInDisplayOrderAndUpdatedByStaff', async () => {
    let r = await api.get('/v1/staff-departments');
    expect(r.status).toBe(200);
    expect(r.text).toBe('[{"slug":"media","colorVar":"--dept-color-media","displayOrder":1},{"slug":"it","colorVar":"--dept-color-it","displayOrder":2}]');
    expect((await api.put('/v1/staff-departments/it', { as: user, body: { colorVar: '--x', displayOrder: 0 } })).status).toBe(403);
    expect((await api.put('/v1/staff-departments/it', { body: { colorVar: '--x', displayOrder: 0 } })).status).toBe(401);
    r = await api.put('/v1/staff-departments/it', { as: staff, body: { colorVar: '--x', displayOrder: 0 } });
    expect(r.status).toBe(200);
    expect(r.text).toBe('{"slug":"it","colorVar":"--x","displayOrder":0}');
    expect((await api.get('/v1/staff-departments')).json[0].slug).toBe('it');
    r = await api.put('/v1/staff-departments/nope', { as: staff, body: { colorVar: '--x', displayOrder: 0 } });
    expect(r.status).toBe(404);
    expect(r.json.message).toBe("StaffDepartment with identifier 'nope' not found");
    r = await api.put('/v1/staff-departments/it', { as: staff, body: { colorVar: ' ', displayOrder: 0 } });
    expect(r.status).toBe(400);
    expect(r.json.message).toBe('colorVar: must not be blank');
  });

  test('yearsFallBackToTheCurrentYearAndListDistinctDescending', async () => {
    let r = await api.get('/v1/staff-members/years');
    expect(r.status).toBe(200);
    expect(r.json).toEqual([Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric' }).format(new Date()))]);
    for (const y of [2024, 2026, 2024]) expect((await api.post('/v1/staff-members', { as: staff, body: member({ year: y }) })).status).toBe(201);
    r = await api.get('/v1/staff-members/years');
    expect(r.text).toBe('[2026,2024]');
  });

  test('membersCrudAndOrdering', async () => {
    const c = await api.post('/v1/staff-members', { as: staff, body: member() });
    expect(c.status).toBe(201);
    expect(c.text).toBe(`{"id":"${c.json.id}","year":2026,"departmentSlug":"it","displayOrder":1,"name":"Ana","roleEs":"Líder","roleEn":"Lead","photoUrl":"https://img.example/ana.png","linkedinUrl":null,"email":"ana@itba.edu.ar"}`);
    expect((await api.post('/v1/staff-members', { as: staff, body: member({ name: 'Beto', departmentSlug: 'media', displayOrder: 5 }) })).status).toBe(201);
    expect((await api.post('/v1/staff-members', { as: staff, body: member({ name: 'Abel', displayOrder: 1 }) })).status).toBe(201);
    expect((await api.post('/v1/staff-members', { as: staff, body: member({ name: 'Old', year: 2020 }) })).status).toBe(201);

    let r = await api.get('/v1/staff-members?year=2026');
    expect(r.status).toBe(200);
    // department, display order, name.
    expect(r.json.map((m: { name: string }) => m.name)).toEqual(['Abel', 'Ana', 'Beto']);

    r = await api.put(`/v1/staff-members/${c.json.id}`, { as: staff, body: member({ name: 'Ana María', linkedinUrl: 'https://linkedin.com/in/ana', email: null }) });
    expect(r.status).toBe(200);
    expect(r.json.name).toBe('Ana María');
    expect(r.json.linkedinUrl).toBe('https://linkedin.com/in/ana');
    expect(r.json.email).toBeNull();

    expect((await api.delete(`/v1/staff-members/${c.json.id}`, { as: staff })).status).toBe(204);
    r = await api.delete(`/v1/staff-members/${c.json.id}`, { as: staff });
    expect(r.status).toBe(404);
    expect(r.json.message).toBe(`StaffMember with identifier '${c.json.id}' not found`);
    expect((await api.put(`/v1/staff-members/${crypto.randomUUID()}`, { as: staff, body: member() })).status).toBe(404);
  });

  test('memberValidationAndAccess', async () => {
    let r = await api.get('/v1/staff-members');
    expect(r.status).toBe(400);
    expect(r.json.message).toBe("Required request parameter 'year' for method parameter type int is not present");
    r = await api.get('/v1/staff-members?year=abc');
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('BadRequest');
    r = await api.post('/v1/staff-members', { as: staff, body: member({ year: 1999 }) });
    expect(r.status).toBe(400);
    expect(r.json.message).toBe('year: must be greater than or equal to 2000');
    r = await api.post('/v1/staff-members', { as: staff, body: member({ photoUrl: 'javascript:alert(1)' }) });
    expect(r.status).toBe(400);
    expect(r.json.message).toBe('photoUrl: must be an http(s) URL');
    r = await api.post('/v1/staff-members', { as: staff, body: member({ departmentSlug: 'nope' }) });
    expect(r.status).toBe(404);
    expect(r.json.message).toBe("StaffDepartment with identifier 'nope' not found");
    expect((await api.post('/v1/staff-members', { as: user, body: member() })).status).toBe(403);
    expect((await api.delete(`/v1/staff-members/${crypto.randomUUID()}`, { as: user })).status).toBe(403);
    expect((await api.post('/v1/staff-members', { body: member() })).status).toBe(401);
    expect(Number((await api.db`SELECT count(*)::int AS n FROM public.staff_members`)[0]!.n)).toBe(0);
  });
});
