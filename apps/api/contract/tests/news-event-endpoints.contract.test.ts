// Ports apps/api/src/test/java/org/ceitba/api/web/news/NewsEventEndpointsIT.java.
import { beforeEach, describe, expect, test } from 'bun:test';
import { useServer, type As } from '../support';
import { as, seedEvent, seedOrg, staff, wipeNews } from '../../test/news/support/fixtures';

const api = useServer();
let boss: As;
const user = () => as('user@itba.edu.ar', 'User');
const ids = (r: { json: any }) => (r.json.data as { id: string }[]).map((a) => a.id);
const BODY = '{"title":"T","eventDate":"2026-08-01","startTime":"10:00","endTime":"12:00","location":"L","category":"General"}';

describe('NewsEventEndpointsIT', () => {
  beforeEach(async () => {
    await wipeNews(api.db);
    boss = await staff(api.db);
    await seedOrg(api.db, 'it', 'IT', 'IT Branch');
    await seedEvent(api.db, { id: 'e1', title: 'Hackathon', eventDate: '2026-06-15', startTime: '09:00', endTime: '18:00', location: 'Aula Magna', category: 'academic' });
    await seedEvent(api.db, { id: 'e2', title: 'Talk', eventDate: '2026-07-01', startTime: '18:00', endTime: '20:00', location: 'SUM', category: 'tech' });
  });

  test('listReturnsAllEvents', async () => {
    const r = await api.get('/v1/news/events');
    expect(r.status).toBe(200);
    expect(r.json.data).toHaveLength(2);
    expect(r.json.meta).toEqual({ total: 2, page: 1, limit: 50 });
    expect(Object.keys(r.json.data[0])).toEqual(['id', 'title', 'eventDate', 'startTime', 'endTime', 'location', 'category',
      'organization', 'description', 'createdAt', 'coverImage', 'onlineUrl', 'signupMode', 'signupUrl', 'capacity', 'rsvpCount']);
    expect(r.json.data[0]).toMatchObject({ id: 'e1', eventDate: '2026-06-15', startTime: '09:00:00', endTime: '18:00:00',
      organization: null, description: null, coverImage: null, onlineUrl: null, signupMode: 'none', signupUrl: null, capacity: null, rsvpCount: 0 });
  });

  test('paginationIsStrictWhenDatesTie', async () => {
    for (const id of ['x3', 'x1', 'x2']) {
      await seedEvent(api.db, { id, title: `Tied ${id}`, eventDate: '2026-08-01', startTime: '10:00', endTime: '12:00', location: 'SUM', category: 'tech' });
    }
    await seedEvent(api.db, { id: 'x0', title: 'Earlier same day', eventDate: '2026-08-01', startTime: '08:00', endTime: '09:00', location: 'SUM', category: 'tech' });
    const seen: string[] = [];
    for (let page = 1; page <= 3; page++) {
      const r = await api.get(`/v1/news/events?limit=2&page=${page}`);
      expect(r.status).toBe(200);
      seen.push(...ids(r));
    }
    expect(seen).toEqual(['e1', 'e2', 'x0', 'x1', 'x2', 'x3']);
  });

  test('listClampsLimit', async () => {
    const r = await api.get('/v1/news/events?limit=0');
    expect(r.status).toBe(200);
    expect(r.json.data).toHaveLength(1);
    expect(r.json.meta.total).toBe(2);
    expect(r.json.meta.limit).toBe(1);
    const r2 = await api.get('/v1/news/events?limit=1000000');
    expect(r2.json.data).toHaveLength(2);
    expect(r2.json.meta.limit).toBe(100);
  });

  test('listFiltersByCategory', async () => {
    const r = await api.get('/v1/news/events?category=tech');
    expect(r.status).toBe(200);
    expect(ids(r)).toEqual(['e2']);
  });

  test('listFiltersByDateRange', async () => {
    const r = await api.get('/v1/news/events?from=2026-07-01');
    expect(r.status).toBe(200);
    expect(ids(r)).toEqual(['e2']);
    expect(ids(await api.get('/v1/news/events?to=2026-06-15'))).toEqual(['e1']);
    const bad = await api.get('/v1/news/events?from=yesterday');
    expect(bad.status).toBe(400);
    expect(bad.json.error).toBe('BadRequest');
    expect(bad.json.message).toBe("Method parameter 'from': Failed to convert value of type 'java.lang.String' to required type 'java.time.LocalDate'; "
      + 'Failed to convert from type [java.lang.String] to type [@org.springframework.web.bind.annotation.RequestParam '
      + '@org.springframework.format.annotation.DateTimeFormat java.time.LocalDate] for value [yesterday]');
  });

  test('dateFiltersParseLikeIsoDate', async () => {
    // @DateTimeFormat(iso = DATE): ISO_DATE accepts (and ignores) an offset and the proleptic year 0000.
    for (const ok of ['2026-07-01Z', '2026-07-01%2B03:00', '0000-02-29', '2024-02-29', '%20']) {
      expect((await api.get(`/v1/news/events?from=${ok}`)).status).toBe(200);
    }
    expect(ids(await api.get('/v1/news/events?from=2026-07-01Z'))).toEqual(['e2']);
    for (const bad of ['2026-02-30', '%202026-07-01', '2026-07-01%20', '%2B2026-07-01', '2026-7-01', '2026-07-01%2B03:60']) {
      const r = await api.get(`/v1/news/events?from=${bad}`);
      expect(r.status).toBe(400);
      expect(r.json.message).toEndWith(`java.time.LocalDate] for value [${decodeURIComponent(bad)}]`);
    }
  });

  test('getByIdReturnsCorrectShape', async () => {
    const r = await api.get('/v1/news/events/e1');
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ id: 'e1', title: 'Hackathon', location: 'Aula Magna', category: 'academic' });
  });

  test('unknownIdReturns404', async () => {
    const r = await api.get('/v1/news/events/nope');
    expect(r.status).toBe(404);
    expect(r.json.message).toBe("Event with identifier 'nope' not found");
  });

  test('anonymousCannotCreate', async () => {
    expect((await api.post('/v1/news/events', { body: BODY })).status).toBe(401);
  });

  test('regularUserCannotCreate', async () => {
    const r = await api.post('/v1/news/events', { as: await user(), body: BODY });
    expect(r.status).toBe(403);
    expect(r.json.error).toBe('AccessDenied');
  });

  test('staffCanCreateEvent', async () => {
    const r = await api.post('/v1/news/events', { as: boss, body: `{"title":"New Event","eventDate":"2026-09-01",
       "startTime":"09:00","endTime":"11:30:15.250","location":"Room 101","category":"Académico","description":"Details here"}` });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ title: 'New Event', location: 'Room 101', description: 'Details here', startTime: '09:00:00',
      endTime: '11:30:15.25', signupMode: 'none', rsvpCount: 0, organization: null });
    expect(r.json.createdAt).toMatch(/-03:00$/);
    const g = await api.get(`/v1/news/events/${r.json.id}`);
    expect(g.json.endTime).toBe('11:30:15.25');
    expect(g.json.createdAt).toMatch(/Z$/);
  });

  test('staffCanPatchEvent', async () => {
    const r = await api.patch('/v1/news/events/e1', { as: boss, body: '{"title":"Hackathon 2026","description":"Updated"}' });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ title: 'Hackathon 2026', description: 'Updated', location: 'Aula Magna', startTime: '09:00:00' });
    expect(r.json.createdAt).toMatch(/Z$/);
  });

  test('staffCanDelete', async () => {
    expect((await api.delete('/v1/news/events/e2', { as: boss })).status).toBe(204);
    expect((await api.get('/v1/news/events/e2')).status).toBe(404);
  });

  test('createValidationFailsOnMissingTitle', async () => {
    const r = await api.post('/v1/news/events', { as: boss, body: BODY.replace('"T"', '""') });
    expect(r.status).toBe(400);
    expect(r.json.message).toBe('title: must not be blank');
  });
});
