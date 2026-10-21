// Ports apps/api/src/test/java/org/ceitba/api/web/news/EventSignupIT.java.
// dayBeforeReminderIsClaimedOnce calls EventReminderService directly: in-process,
// test/news/event-reminders.test.ts. /v1/me/rsvps and /v1/analytics/events belong to
// other features: those assertions are skipped on ts until the routes land.
import { beforeEach, describe, expect, test } from 'bun:test';
import { seedUser, supports, useServer } from '../support';
import { artToday, as, seedEvent, seedMembership, seedOrg, wipeNews } from '../../test/news/support/fixtures';

const api = useServer();
const hasMyRsvps = await supports('GET /v1/me/rsvps');
const hasAnalytics = await supports('POST /v1/analytics/events');

async function event(id: string, date: string, mode: string, capacity: number | null) {
  await seedEvent(api.db, { id, title: `Evento ${id}`, eventDate: date, startTime: '18:30', endTime: '20:00', location: 'Aula 1',
    category: 'meetup', organization: 'sabf', signupMode: mode, capacity });
}

describe('EventSignupIT', () => {
  beforeEach(async () => {
    await wipeNews(api.db);
    await seedOrg(api.db, 'ceitba', 'CEITBA', 'Centro de Estudiantes');
    await seedOrg(api.db, 'sabf', 'SABF', 'South American Business Forum');
    const alice = await seedUser(api.db, 'alice@itba.edu.ar', { name: 'Alice' });
    await seedUser(api.db, 'bob@itba.edu.ar', { name: 'Bob' });
    await seedUser(api.db, 'carol@itba.edu.ar', { name: 'Carol' });
    await seedMembership(api.db, alice, 'sabf', 'member');
    await event('rsvp-evt', artToday(7), 'rsvp', 1);
    await event('past-evt', artToday(-1), 'rsvp', null);
    await event('plain-evt', artToday(7), 'none', null);
  });

  test('createValidatesTheSignupMode', async () => {
    const alice = await as('alice@itba.edu.ar');
    const r = await api.post('/v1/news/events', { as: alice, body: `{"title":"Charla","eventDate":"${artToday(3)}","startTime":"18:00","endTime":"19:00","location":"Aula 2",
       "category":"Campus","organization":"sabf","signupMode":"external"}` });
    expect(r.status).toBe(400);
    expect(r.json.message).toBe("Validation failed for field 'signupUrl' with value 'null': is required for external sign-up");
    const ok = await api.post('/v1/news/events', { as: alice, body: `{"title":"Charla","eventDate":"${artToday(3)}","startTime":"18:00","endTime":"19:00","location":"Aula 2",
       "category":"Campus","organization":"sabf","signupMode":"external",
       "signupUrl":"https://forms.gle/x","capacity":10,"coverImage":"https://img.example/c.png"}` });
    expect(ok.status).toBe(201);
    expect(ok.json.signupMode).toBe('external');
    expect(ok.json.signupUrl).toBe('https://forms.gle/x');
    expect(ok.json.capacity).toBeNull();
    expect(ok.json.coverImage).toBe('https://img.example/c.png');
    const bad = await api.post('/v1/news/events', { as: alice, body: `{"title":"Charla","eventDate":"${artToday(3)}","startTime":"18:00","endTime":"19:00","location":"Aula 2",
       "category":"Campus","organization":"sabf","signupMode":"lottery"}` });
    expect(bad.status).toBe(400);
    expect(bad.json.message).toBe('signupMode: must be none, external or rsvp');
  });

  test('rsvpRespectsCapacityAndIsIdempotent', async () => {
    const bob = await as('bob@itba.edu.ar');
    const carol = await as('carol@itba.edu.ar');
    const r1 = await api.post('/v1/news/events/rsvp-evt/rsvp', { as: bob });
    expect(r1.status).toBe(200);
    expect(r1.text).toBe('{"going":true,"rsvpCount":1}');
    const r2 = await api.post('/v1/news/events/rsvp-evt/rsvp', { as: bob });
    expect(r2.status).toBe(200);
    expect(r2.json.rsvpCount).toBe(1);
    const full = await api.post('/v1/news/events/rsvp-evt/rsvp', { as: carol });
    expect(full.status).toBe(409);
    expect(full.json).toMatchObject({ error: 'EventFull', message: 'This event is full' });
    const c = await api.delete('/v1/news/events/rsvp-evt/rsvp', { as: bob });
    expect(c.status).toBe(200);
    expect(c.text).toBe('{"going":false,"rsvpCount":0}');
    expect((await api.post('/v1/news/events/rsvp-evt/rsvp', { as: carol })).status).toBe(200);
    const g = await api.get('/v1/news/events/rsvp-evt');
    expect(g.json.rsvpCount).toBe(1);
    expect(g.json.capacity).toBe(1);
    expect((await api.get('/v1/news/events')).json.data.find((e: { id: string }) => e.id === 'rsvp-evt').rsvpCount).toBe(1);
    if (hasMyRsvps) {
      const mine = await api.get('/v1/me/rsvps', { as: carol });
      expect(mine.status).toBe(200);
      expect(mine.json.eventIds[0]).toBe('rsvp-evt');
    }
  });

  test('rsvpRefusesPastAndNonRsvpEvents', async () => {
    const bob = await as('bob@itba.edu.ar');
    const past = await api.post('/v1/news/events/past-evt/rsvp', { as: bob });
    expect(past.status).toBe(409);
    expect(past.json).toMatchObject({ error: 'EventEnded', message: 'This event already took place' });
    const plain = await api.post('/v1/news/events/plain-evt/rsvp', { as: bob });
    expect(plain.status).toBe(409);
    expect(plain.json).toMatchObject({ error: 'EventNotRsvp', message: 'This event does not take RSVPs' });
    expect((await api.post('/v1/news/events/rsvp-evt/rsvp')).status).toBe(401);
    // Not in the IT: unknown events.
    expect((await api.post('/v1/news/events/nope/rsvp', { as: bob })).status).toBe(404);
    expect((await api.delete('/v1/news/events/nope/rsvp', { as: bob })).status).toBe(404);
  });

  test('attendeesAreForTheOrgsMembers', async () => {
    expect((await api.post('/v1/news/events/rsvp-evt/rsvp', { as: await as('bob@itba.edu.ar') })).status).toBe(200);
    const r = await api.get('/v1/news/events/rsvp-evt/attendees', { as: await as('alice@itba.edu.ar') });
    expect(r.status).toBe(200);
    expect(r.json.data).toHaveLength(1);
    expect(r.json.data[0].email).toBe('bob@itba.edu.ar');
    expect(Object.keys(r.json.data[0])).toEqual(['userId', 'name', 'email', 'createdAt']);
    expect(r.json.data[0].createdAt).toMatch(/Z$/);
    expect((await api.get('/v1/news/events/rsvp-evt/attendees', { as: await as('bob@itba.edu.ar') })).status).toBe(403);
  });

  test('adminsCanHideRsvpListsFromPlainMembers', async () => {
    const [carol] = await api.db`SELECT id FROM public."user" WHERE email = 'carol@itba.edu.ar'`;
    await seedMembership(api.db, carol!.id, 'sabf', 'admin');
    expect((await api.post('/v1/news/events/rsvp-evt/rsvp', { as: await as('bob@itba.edu.ar') })).status).toBe(200);
    const alice = await as('alice@itba.edu.ar');
    const carolAs = await as('carol@itba.edu.ar');
    expect((await api.patch('/v1/organizations/sabf/members/settings', { as: alice, body: '{"attendeesVisibleToMembers":false}' })).status).toBe(403);
    const r = await api.patch('/v1/organizations/sabf/members/settings', { as: carolAs, body: '{"attendeesVisibleToMembers":false}' });
    expect(r.status).toBe(200);
    expect(r.json.attendeesVisibleToMembers).toBe(false);
    expect((await api.get('/v1/news/events/rsvp-evt/attendees', { as: alice })).status).toBe(403);
    expect((await api.get('/v1/news/events/rsvp-evt/attendees', { as: carolAs })).status).toBe(200);
    expect((await api.get('/v1/organizations/sabf/members', { as: carolAs })).json.settings.attendeesVisibleToMembers).toBe(false);
  });

  test('patchReplacesTheSignupOnlyWhenTheModeIsSent', async () => {
    const alice = await as('alice@itba.edu.ar');
    const r = await api.patch('/v1/news/events/rsvp-evt', { as: alice, body: '{"title":"Nuevo título"}' });
    expect(r.status).toBe(200);
    expect(r.json.signupMode).toBe('rsvp');
    expect(r.json.capacity).toBe(1);
    const r2 = await api.patch('/v1/news/events/rsvp-evt', { as: alice, body: '{"signupMode":"rsvp"}' });
    expect(r2.status).toBe(200);
    expect(r2.json.capacity).toBeNull();
  });

  test.skipIf(!hasAnalytics)('eventViewsAreRecordedWithTheEventId', async () => {
    const r = await api.post('/v1/analytics/events', { body: '{"events":[{"type":"event_view","sessionId":"s1","eventId":"rsvp-evt"}]}' });
    expect(r.status).toBe(202);
    const [n] = await api.db`SELECT count(*)::int AS n FROM public.analytics_events WHERE type = 'event_view' AND event_id = 'rsvp-evt'`;
    expect(n!.n).toBe(1);
  });
});
