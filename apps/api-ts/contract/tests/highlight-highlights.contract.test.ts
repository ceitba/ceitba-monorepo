// Ports apps/api/src/test/java/org/ceitba/api/web/highlight/HighlightsIT.java.
// The IT pins the clock at 2026-09-21T15:00Z; a black-box jar runs on real
// time, so every window is relative to the moment the test runs (at(h) =
// now + h hours, BODY's window contains now). The exact-instant boundaries
// (starts_at == now, ends_at == now) are pinned in-process:
// test/highlight/highlights-clock.test.ts.
import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { bearer, mintJwt, seedStaff, useServer, type As } from '../support';

const api = useServer();
let user: As;
let staff: As;

const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');
const at = (hours: number) => iso(Date.now() + hours * 3_600_000);
const DAY = 24;

function body(): Record<string, unknown> {
  return {
    title: 'Semana del estudiante', description: 'Actividades', imageUrl: 'https://img.example/a.png',
    linkUrl: 'https://ceitba.org.ar', position: 2,
    startsAt: iso(Math.floor((Date.now() - DAY * 3_600_000) / 1000) * 1000),
    endsAt: iso(Math.floor((Date.now() + 9 * DAY * 3_600_000) / 1000) * 1000),
  };
}

let seq = 0;
async function save(title: string, position: number, starts: string | null, ends: string | null, active: boolean): Promise<string> {
  seq++;
  const [row] = await api.db`
    INSERT INTO public.home_highlights (title, image_url, position, starts_at, ends_at, active, created_at, updated_at)
    VALUES (${title}, ${`https://img.example/${title}.png`}, ${position}, ${starts}, ${ends}, ${active},
            now() + make_interval(secs => ${seq} / 1000.0), now())
    RETURNING id`;
  return row!.id as string;
}

beforeAll(async () => {
  await seedStaff(api.db, 'boss@itba.edu.ar');
  user = bearer(await mintJwt({ email: 'regular@itba.edu.ar' }));
  staff = bearer(await mintJwt({ email: 'boss@itba.edu.ar' }));
});

describe('HighlightsIT', () => {
  beforeEach(async () => { await api.db`DELETE FROM public.home_highlights`; });

  test('publicListShowsOnlyActiveInsideWindowOrderedByPosition', async () => {
    await save('third', 3, null, null, true);
    await save('first', 1, at(-1), at(1), true);
    await save('second', 2, null, at(24), true);
    await save('inactive', 0, null, null, false);
    await save('expired', 0, null, at(-1), true);
    await save('endsNow', 0, null, at(0), true);
    await save('scheduled', 0, at(1), null, true);
    await save('startsNow', 4, at(0), null, true);
    await Bun.sleep(5);

    const r = await api.get('/v1/highlights');
    expect(r.status).toBe(200);
    expect(r.json.map((h: { title: string }) => h.title)).toEqual(['first', 'second', 'third', 'startsNow']);
    expect(r.json[0].imageUrl).toBe('https://img.example/first.png');
    expect(r.json[0].active).toBe(true);
    // Byte shape of a row read back from the database (OffsetDateTime in UTC, Z).
    const third = r.json[2];
    expect(JSON.stringify(third)).toBe(`{"id":"${third.id}","title":"third","description":null,"imageUrl":"https://img.example/third.png","linkUrl":null,"position":3,"startsAt":null,"endsAt":null,"active":true}`);
    expect(r.text).toContain(`"title":"first"`);
    expect(r.json[0].startsAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
  });

  test('writesRequireStaff', async () => {
    const id = await save('x', 0, null, null, true);
    expect((await api.post('/v1/highlights', { body: body() })).status).toBe(401);
    expect((await api.post('/v1/highlights', { as: user, body: body() })).status).toBe(403);
    expect((await api.put(`/v1/highlights/${id}`, { as: user, body: body() })).status).toBe(403);
    expect((await api.delete(`/v1/highlights/${id}`, { as: user })).status).toBe(403);
    expect((await api.get('/v1/highlights/all')).status).toBe(401);
    expect((await api.get('/v1/highlights/all', { as: user })).status).toBe(403);
    const [row] = await api.db`SELECT title FROM public.home_highlights WHERE id = ${id}`;
    expect(row!.title).toBe('x');
  });

  test('staffCrudRoundTrip', async () => {
    const b = body();
    const created = await api.post('/v1/highlights', { as: staff, body: b });
    expect(created.status).toBe(201);
    expect(created.json.title).toBe('Semana del estudiante');
    expect(created.json.position).toBe(2);
    expect(created.json.active).toBe(true);
    const id = created.json.id as string;
    expect(created.text).toBe(`{"id":"${id}","title":"Semana del estudiante","description":"Actividades","imageUrl":"https://img.example/a.png","linkUrl":"https://ceitba.org.ar","position":2,"startsAt":"${b.startsAt}","endsAt":"${b.endsAt}","active":true}`);

    const list = await api.get('/v1/highlights');
    expect(list.json.length).toBe(1);
    expect(list.json[0].linkUrl).toBe('https://ceitba.org.ar');
    expect(list.text).toBe(`[${created.text}]`);

    const deactivate = { ...b, position: 5, active: false };
    const updated = await api.put(`/v1/highlights/${id}`, { as: staff, body: deactivate });
    expect(updated.status).toBe(200);
    expect(updated.json.position).toBe(5);
    expect(updated.json.active).toBe(false);

    expect((await api.get('/v1/highlights')).json.length).toBe(0);
    const all = await api.get('/v1/highlights/all', { as: staff });
    expect(all.status).toBe(200);
    expect(all.json.length).toBe(1);

    expect((await api.delete(`/v1/highlights/${id}`, { as: staff })).status).toBe(204);
    expect((await api.delete(`/v1/highlights/${id}`, { as: staff })).status).toBe(404);
    const missing = await api.put(`/v1/highlights/${crypto.randomUUID()}`, { as: staff, body: b });
    expect(missing.status).toBe(404);
    expect(missing.json.error).toBe('ResourceNotFound');
  });

  test('invalidBodiesReturn400', async () => {
    const b = body();
    const inverted = await api.post('/v1/highlights', { as: staff, body: { ...b, endsAt: at(-10 * DAY) } });
    expect(inverted.status).toBe(400);
    expect(inverted.json.error).toBe('ValidationError');

    expect((await api.post('/v1/highlights', { as: staff, body: { ...b, imageUrl: ' ' } })).status).toBe(400);

    for (const bad of ['javascript:alert(1)', 'intent://x#Intent;end', 'ceitba.org.ar', `https://ceitba.org.ar/${'a'.repeat(2048)}`]) {
      const r = await api.post('/v1/highlights', { as: staff, body: { ...b, linkUrl: bad } });
      expect(r.status).toBe(400);
      expect(r.json.error).toBe('ValidationError');
    }
    expect((await api.post('/v1/highlights', { as: staff, body: { ...b, imageUrl: 'ftp://img.example/a.png' } })).status).toBe(400);
    const [n] = await api.db`SELECT count(*)::int AS n FROM public.home_highlights`;
    expect(n!.n).toBe(0);
  });

  test('emptyLinkUrlIsStoredAsNoLink', async () => {
    const r = await api.post('/v1/highlights', { as: staff, body: { ...body(), linkUrl: '' } });
    expect(r.status).toBe(201);
    expect(r.json.linkUrl).toBeNull();
  });

  // Not in the IT: exact messages of the single-violation cases.
  test('validationMessagesMatch', async () => {
    const b = body();
    const link = await api.post('/v1/highlights', { as: staff, body: { ...b, linkUrl: 'ceitba.org.ar' } });
    expect(link.json.message).toBe('linkUrl: must be an http(s) URL');
    const inverted = await api.post('/v1/highlights', {
      as: staff, body: { ...b, startsAt: '2026-09-20T00:00:00-03:00', endsAt: '2026-09-10T00:00:00.5Z' },
    });
    expect(inverted.json.message).toBe("Validation failed for field 'startsAt' with value '2026-09-20T03:00Z': must be before endsAt");
    const offset = await api.post('/v1/highlights', {
      as: staff, body: { ...b, startsAt: '2026-09-20T00:00:00-03:00', endsAt: '2027-09-10T00:00:00.5Z' },
    });
    expect(offset.status).toBe(201);
    expect(offset.json.startsAt).toBe('2026-09-20T03:00:00Z');
    expect(offset.json.endsAt).toBe('2027-09-10T00:00:00.5Z');
    const badId = await api.put('/v1/highlights/not-a-uuid', { as: staff, body: b });
    expect(badId.status).toBe(400);
  });
});
