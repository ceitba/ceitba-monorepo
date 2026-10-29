// The per-user quota on POST /v1/news/events (user rule 'event-create'): every event notifies its
// organization's followers, and API keys (the MCP server's events scope) can create them.
import { beforeEach, describe, expect, test } from 'bun:test';
import { seedUser, useServer } from '../support';
import { as, seedMembership, seedOrg, wipeNews } from '../../test/news/support/fixtures';

const api = useServer({ env: { RATE_LIMIT_ENABLED: 'true', RATE_LIMIT_EVENT_CREATE_CAPACITY: '2', RATE_LIMIT_EVENT_CREATE_PERIOD: '1h' } });

describe('EventCreateQuota', () => {
  beforeEach(async () => {
    await wipeNews(api.db);
    await seedOrg(api.db, 'sabf', 'SABF', 'South American Business Forum');
    await seedMembership(api.db, await seedUser(api.db, 'alice@itba.edu.ar', { name: 'Alice' }), 'sabf', 'member');
    await seedMembership(api.db, await seedUser(api.db, 'carol@itba.edu.ar', { name: 'Carol' }), 'sabf', 'member');
  });

  test('aMemberGetsTheConfiguredNumberOfEventsPerPeriodThen429', async () => {
    const body = { title: 'Meetup', eventDate: '2030-05-01', startTime: '18:00', endTime: '20:00', location: 'Aula 1', category: 'Organizaciones', organization: 'sabf' };
    const alice = await as('alice@itba.edu.ar');
    expect((await api.post('/v1/news/events', { as: alice, body })).status).toBe(201);
    expect((await api.post('/v1/news/events', { as: alice, body })).status).toBe(201);
    const third = await api.post('/v1/news/events', { as: alice, body });
    expect(third.status).toBe(429);
    expect(third.headers.get('retry-after')).not.toBeNull();
    expect((await api.post('/v1/news/events', { as: await as('carol@itba.edu.ar'), body })).status).toBe(201);
  });
});
