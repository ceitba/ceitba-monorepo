// In-process port of EventSignupIT.dayBeforeReminderIsClaimedOnce
// (apps/api/src/test/java/org/ceitba/api/web/news/EventSignupIT.java): it calls
// EventReminderService.sendDueReminders() directly. Also checks the push it sends.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mintJwt, seedUser } from '../../contract/support';
import { EventReminderService } from '../../src/features/news/events';
import { pendingPushes } from '../../src/features/news/pushTriggers';
import { FakePushGateway } from '../../src/infra/push';
import { artToday, seedEvent, seedMembership, seedOrg, wipeNews } from './support/fixtures';
import { testApp, type TestApp } from '../support/app';

let t: TestApp;
const gateway = new FakePushGateway();

beforeAll(async () => { t = await testApp({ overrides: { push: gateway } }); });
afterAll(async () => { await t.close(); });

const auth = async (email: string) => ({ Authorization: `Bearer ${await mintJwt({ email, name: email })}` });
const sentAt = async (id: string) => (await t.sql`SELECT reminder_sent_at FROM public.news_events WHERE id = ${id}`)[0]!.reminder_sent_at;

describe('EventSignupIT (in-process)', () => {
  test('dayBeforeReminderIsClaimedOnce', async () => {
    await wipeNews(t.sql);
    await seedOrg(t.sql, 'sabf', 'SABF', 'South American Business Forum');
    const alice = await seedUser(t.sql, 'alice@itba.edu.ar', { name: 'Alice' });
    const bob = await seedUser(t.sql, 'bob@itba.edu.ar', { name: 'Bob' });
    await t.sql`INSERT INTO public.user_devices (token, user_id, platform) VALUES ('bob-phone', ${bob}, 'android')`;
    await seedMembership(t.sql, alice, 'sabf', 'member');
    const ev = (id: string, days: number) => seedEvent(t.sql, { id, title: `Evento ${id}`, eventDate: artToday(days), startTime: '18:30',
      endTime: '20:00', location: 'Aula 1', category: 'meetup', organization: 'sabf', signupMode: 'rsvp' });
    await ev('rsvp-evt', 7);
    await ev('tomorrow-evt', 1);
    await ev('tomorrow-empty', 1);
    const reminders = new EventReminderService(t.deps);

    expect((await t.request('POST', '/v1/news/events/tomorrow-evt/rsvp', { headers: await auth('bob@itba.edu.ar') })).status).toBe(200);
    expect(await reminders.sendDueReminders()).toBe(1);
    expect(await reminders.sendDueReminders()).toBe(0);
    expect(await sentAt('tomorrow-evt')).not.toBeNull();
    expect(await sentAt('rsvp-evt')).toBeNull();
    expect(await sentAt('tomorrow-empty')).toBeNull();

    await pendingPushes();
    expect(gateway.calls).toHaveLength(1);
    expect(gateway.calls[0]!.tokens).toEqual(['bob-phone']);
    expect(gateway.calls[0]!.message).toEqual({ title: 'Evento tomorrow-evt', body: 'Mañana a las 18:30 · Aula 1',
      data: { type: 'event', id: 'tomorrow-evt', org: 'sabf' } });

    expect((await t.request('POST', '/v1/news/events/tomorrow-empty/rsvp', { headers: await auth('bob@itba.edu.ar') })).status).toBe(200);
    expect(await reminders.sendDueReminders()).toBe(1);

    const r = await t.request('PATCH', '/v1/news/events/tomorrow-evt', { headers: await auth('alice@itba.edu.ar'), body: `{"eventDate":"${artToday(8)}"}` });
    expect(r.status).toBe(200);
    expect(await sentAt('tomorrow-evt')).toBeNull();
  });
});
