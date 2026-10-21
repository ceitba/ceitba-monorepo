// Ports apps/api/src/test/java/org/ceitba/api/web/news/OrgAnalyticsIT.java.
import { beforeEach, describe, expect, test } from 'bun:test';
import { seedUser, useServer } from '../support';
import { artToday, as, seedArticle, seedEvent, seedMembership, seedOrg, wipeNews } from '../../test/news/support/fixtures';

const api = useServer();

async function view(type: string, session: string, articleId: string | null, eventId: string | null, ago: string) {
  await api.db`INSERT INTO public.analytics_events (type, session_id, ts, article_id, event_id)
               VALUES (${type}, ${session}, now() - ${ago}::interval, ${articleId}, ${eventId})`;
}

describe('OrgAnalyticsIT', () => {
  beforeEach(async () => {
    await wipeNews(api.db);
    await seedOrg(api.db, 'sabf', 'SABF', 'South American Business Forum');
    await seedOrg(api.db, 'trama', 'TRAMA', 'TRAMA ITBA');
    const alice = await seedUser(api.db, 'alice@itba.edu.ar', { name: 'Alice' });
    const bob = await seedUser(api.db, 'bob@itba.edu.ar', { name: 'Bob' });
    await seedMembership(api.db, alice, 'sabf', 'member');
    for (const org of ['sabf', 'trama']) {
      await seedArticle(api.db, { id: `${org}-art`, title: `${org} news`, excerpt: 'x', body: ['p'], category: 'Campus', authors: [org], organization: org });
    }
    await seedEvent(api.db, { id: 'sabf-evt', title: 'SABF meetup', eventDate: artToday(3), startTime: '18:00', endTime: '20:00', location: 'Aula 1', category: 'Campus', organization: 'sabf' });
    await view('article_view', 's1', 'sabf-art', null, '0');
    await view('article_view', 's1', 'sabf-art', null, '0');
    await view('article_view', 's2', 'sabf-art', null, '0');
    await view('event_view', 's3', null, 'sabf-evt', '0');
    await view('article_view', 's4', 'trama-art', null, '0');
    await view('article_view', 's4', 'trama-art', null, '0');
    await view('article_view', 's5', 'sabf-art', null, '60 days');
    await api.db`INSERT INTO public.user_follows (user_id, org_slug, created_at) VALUES (${alice}, 'sabf', now() - interval '90 days')`;
    await api.db`INSERT INTO public.user_follows (user_id, org_slug, created_at) VALUES (${bob}, 'sabf', now())`;
    await api.db`INSERT INTO public.push_log (org_slug, kind, ref_id, targeted, sent) VALUES ('sabf', 'article', 'sabf-art', 5, 4)`;
  });

  test('memberSeesOnlyTheOrgsOwnNumbers', async () => {
    const r = await api.get('/v1/organizations/sabf/analytics', { as: await as('alice@itba.edu.ar'), query: { days: 30 } });
    expect(r.status).toBe(200);
    const j = r.json;
    expect(j.articleViews).toBe(3);
    expect(j.eventViews).toBe(1);
    expect(j.uniqueVisitors).toBe(3);
    expect(j.daily).toHaveLength(30);
    expect(j.topArticles[0].articleId).toBe('sabf-art');
    expect(j.topArticles[0].views).toBe(3);
    expect(j.events[0].eventId).toBe('sabf-evt');
    expect(j.events[0].views).toBe(1);
    expect(j.followers.total).toBe(2);
    expect(j.followers.newInPeriod).toBe(1);
    expect(j.followers.cumulative[0].count).toBe(1);
    expect(j.followers.cumulative[29].count).toBe(2);
    expect(j.pushes.pushes).toBe(1);
    expect(j.pushes.devicesReached).toBe(4);
    // Shape (record order) and the window's days.
    expect(Object.keys(j)).toEqual(['days', 'articleViews', 'eventViews', 'uniqueVisitors', 'daily', 'topArticles', 'events', 'followers', 'pushes', 'mail']);
    expect(j.days).toBe(30);
    expect(j.daily[29]).toEqual({ date: artToday(), articleViews: 3, eventViews: 1 });
    expect(j.daily[0]).toEqual({ date: artToday(-29), articleViews: 0, eventViews: 0 });
    expect(j.topArticles).toEqual([{ articleId: 'sabf-art', title: 'sabf news', views: 3 }]);
    expect(j.events).toEqual([{ eventId: 'sabf-evt', title: 'SABF meetup', date: artToday(3), signupMode: 'none', capacity: null, rsvpCount: 0, views: 1 }]);
    expect(j.followers.cumulative[29]).toEqual({ date: artToday(), count: 2 });
    expect(j.pushes).toEqual({ pushes: 1, devicesTargeted: 5, devicesReached: 4 });
    expect(j.mail).toEqual({ announcements: 0, recipients: 0 });
  });

  test('outsidersAndBadWindowsAreRefused', async () => {
    expect((await api.get('/v1/organizations/sabf/analytics', { as: await as('bob@itba.edu.ar') })).status).toBe(403);
    const r = await api.get('/v1/organizations/sabf/analytics', { as: await as('alice@itba.edu.ar'), query: { days: 0 } });
    expect(r.status).toBe(400);
    expect(r.json.message).toBe("Validation failed for field 'days' with value '0': must be 1-365");
    // Not in the IT: the default window and an unknown org (for STAFF via the check: 403 for members).
    const def = await api.get('/v1/organizations/sabf/analytics', { as: await as('alice@itba.edu.ar') });
    expect(def.json.days).toBe(30);
    expect((await api.get('/v1/organizations/sabf/analytics', { as: await as('alice@itba.edu.ar'), query: { days: 366 } })).status).toBe(400);
  });
});
