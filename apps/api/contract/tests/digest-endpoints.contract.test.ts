// Ports apps/api/src/test/java/org/ceitba/api/web/digest/DigestEndpointsIT.java.
//
// MockMvc's ROLE_STAFF authority is a real ceitba_staff row here (seedStaff),
// which also holds every capability: re-checked for each estimate below.
// The IT calls DigestSender.runPending() directly; black-box, the worker is
// the one DigestJob kicks right after a send commits, so the tests that need
// it run on a second server with DIGEST_JOBS_ENABLED=true (a 2 s send
// interval keeps the issue `sending` long enough to observe) and poll.
// cancelWhileSendingDropsWhatIsLeft needs the deliveries to stay pending, so
// it runs with the worker off; its "nothing goes out after the cancel" part
// is covered in-process (test/digest/sender.test.ts).
import { beforeEach, describe, expect, test } from 'bun:test';
import { bearer, mintJwt, seedStaff, seedUser, useServer, type Server } from '../support';
import {
  eventually, follow, seedArticle, seedEvent, seedOrg, setCapabilityOpen, unsubscribeTokens,
} from '../../test/digest/support/seed';

const ENV = { AUTH_ALLOWED_EMAILS: 'boss@gmail.com' };
const api = useServer({ env: ENV });
const worker = useServer({ env: { ...ENV, DIGEST_JOBS_ENABLED: 'true', DIGEST_SEND_INTERVAL: 'PT2S', DIGEST_TICK_INTERVAL: 'PT1H' } });

// Monday 2026-09-28: articles of 28/9..4/10, events of 5/10..11/10.
const WEEK = '2026-09-28';

interface Ids { alice: string; bob: string }

async function seed(s: Server): Promise<Ids> {
  await s.db`
    TRUNCATE public.digest_deliveries, public.digest_issues, public.user_follows, public.mail_send_log, public.mail_account_state,
             public.articles, public.news_events, public.organizations, public."user",
             public.capability_settings, public.capability_user_grants CASCADE`;
  await setCapabilityOpen(s.db, 'resumen_semanal', true);
  await seedOrg(s.db, 'ceitba', 'CEITBA', 'Centro de Estudiantes');
  await seedOrg(s.db, 'sabf', 'SABF', 'South American Business Forum');
  const alice = await seedUser(s.db, 'alice@itba.edu.ar', { name: 'Alice' });
  const bob = await seedUser(s.db, 'bob@itba.edu.ar', { name: 'Bob' });
  const dave = await seedUser(s.db, 'dave@itba.edu.ar', { name: 'Dave' });
  const carol = await seedUser(s.db, 'carol@gmail.com', { name: 'Carol' });
  await follow(s.db, alice, 'ceitba');
  await follow(s.db, bob, 'ceitba');
  await follow(s.db, bob, 'sabf');
  await follow(s.db, dave, 'sabf');
  await follow(s.db, carol, 'ceitba');
  await seedArticle(s.db, 'a-ceitba', 'ceitba', '2026-09-30', 'published');
  await seedArticle(s.db, 'a-sabf', 'sabf', '2026-10-02', 'published');
  await seedArticle(s.db, 'a-indep', null, '2026-09-29', 'published');
  await seedArticle(s.db, 'a-draft', 'ceitba', '2026-10-01', 'draft');
  await seedArticle(s.db, 'a-old', 'ceitba', '2026-09-27', 'published');
  await seedEvent(s.db, 'e-ceitba', 'ceitba', '2026-10-06');
  await seedEvent(s.db, 'e-general', null, '2026-10-09');
  await seedEvent(s.db, 'e-late', 'ceitba', '2026-10-12');
  await seedStaff(s.db, 'alice@itba.edu.ar');
  return { alice, bob };
}

const staff = async (email = 'alice@itba.edu.ar') => bearer(await mintJwt({ email, name: 'Staff' }));
const user = async (email = 'bob@itba.edu.ar') => bearer(await mintJwt({ email, name: 'Bob' }));

async function create(s: Server): Promise<string> {
  const r = await s.post('/v1/digests', { as: await staff(), body: { weekStart: WEEK } });
  expect(r.status).toBe(201);
  return r.json.id;
}

const unsubscribe = (s: Server, token: string) =>
  s.post('/v1/digests/unsubscribe', { query: { token }, body: 'List-Unsubscribe=One-Click', contentType: 'application/x-www-form-urlencoded' });

describe('DigestEndpointsIT', () => {
  let ids: Ids;
  beforeEach(async () => { ids = await seed(api); });

  test('issueEndpointsAreStaffOnly', async () => {
    expect((await api.get('/v1/digests')).status).toBe(401);
    expect((await api.get('/v1/digests', { as: await user() })).status).toBe(403);
    expect((await api.post('/v1/digests', { as: await user(), body: { weekStart: WEEK } })).status).toBe(403);
    const id = await create(api);
    expect((await api.get(`/v1/digests/${id}`, { as: await user() })).status).toBe(403);
    expect((await api.post(`/v1/digests/${id}/send`, { as: await user() })).status).toBe(403);
    expect((await api.get(`/v1/digests/${id}/preview`)).status).toBe(401);
    const r = await api.get('/v1/digests', { as: await staff() });
    expect(r.status).toBe(200);
    expect(r.json[0].id).toBe(id);
    expect(r.json[0].weekEnd).toBe('2026-10-04');
    expect(r.json[0].counts.pending).toBe(0);
    expect(Object.keys(r.json[0])).toEqual(['id', 'weekStart', 'weekEnd', 'subject', 'status', 'autoSendAt', 'sentAt',
      'createdAt', 'counts', 'resumeAt', 'estimatedFinishAt', 'openRate', 'clickRate']);
    expect(r.json[0].createdAt).toMatch(/Z$/);
    expect(r.text).toContain(`"weekStart":"2026-09-28","weekEnd":"2026-10-04","subject":"La semana en ITBA · 28 de septiembre al 4 de octubre","status":"draft","autoSendAt":null,"sentAt":null,`);
    expect(r.text).toContain('"counts":{"pending":0,"sent":0,"failed":0},"resumeAt":null,"estimatedFinishAt":null,"openRate":null,"clickRate":null}');
  });

  test('createValidatesWeekAndUniqueness', async () => {
    const bad = await api.post('/v1/digests', { as: await staff(), body: { weekStart: '2026-09-29' } });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toBe('INVALID_WEEK_START');
    expect(bad.json.message).toBe('weekStart must be a Monday (YYYY-MM-DD), got 2026-09-29');
    await create(api);
    const dup = await api.post('/v1/digests', { as: await staff(), body: { weekStart: WEEK } });
    expect(dup.status).toBe(409);
    expect(dup.json.error).toBe('DIGEST_EXISTS');
    expect(dup.json.message).toBe('A digest for the week of 2026-09-28 already exists');
  });

  test('detailListsCandidatesAndPatchAcceptsTheFullBody', async () => {
    const id = await create(api);
    const d = await api.get(`/v1/digests/${id}`, { as: await staff() });
    expect(d.status).toBe(200);
    expect(d.json.subject).toBe('La semana en ITBA · 28 de septiembre al 4 de octubre');
    expect(d.json.status).toBe('draft');
    expect(d.json.articles).toHaveLength(3);
    expect(d.json.articles[0].id).toBe('a-sabf');
    expect(d.json.articles[0].organization.name).toBe('SABF');
    expect(d.json.articles[2].id).toBe('a-indep');
    expect(d.json.articles[2].organization).toBeNull();
    expect(d.json.events).toHaveLength(2);
    expect(d.json.events[0].id).toBe('e-ceitba');
    expect(d.json.events[0].startTime).toBe('18:00:00');
    expect(d.json.events[1].id).toBe('e-general');
    // CEITBA followers on an allowed domain: alice and bob
    expect(d.json.recipientEstimate).toBe(2);
    expect(Object.keys(d.json)).toEqual(['id', 'weekStart', 'weekEnd', 'subject', 'intro', 'status', 'autoSendAt', 'sentAt',
      'counts', 'recipientEstimate', 'articles', 'events', 'resumeAt', 'estimatedFinishAt']);
    expect(d.text).toContain('{"id":"a-sabf","title":"Título a-sabf","excerpt":"Resumen","coverImage":null,"publishedAt":"2026-10-02","organization":{"slug":"sabf","name":"SABF"},"excluded":false}');
    expect(d.text).toContain('{"id":"e-general","title":"Evento e-general","eventDate":"2026-10-09","startTime":"18:00:00","endTime":"20:00:00","location":"Aula 101","organization":null,"excluded":false}');

    // What the frontend sends on every save: all five fields.
    const ms = Math.floor((Date.now() + 2 * 86_400_000) / 60_000) * 60_000;
    const autoSendAt = new Date(ms).toISOString().replace('.000Z', 'Z');
    const p = await api.patch(`/v1/digests/${id}`, { as: await staff(), body: {
      subject: 'Edición especial', intro: 'Hola\n<b>todos</b>', excludedArticleIds: ['a-sabf'], excludedEventIds: [], autoSendAt,
    } });
    expect(p.status).toBe(200);
    expect(p.json.subject).toBe('Edición especial');
    expect(p.json.intro).toBe('Hola\n<b>todos</b>');
    expect(p.json.autoSendAt).toContain(autoSendAt.slice(0, 16));
    // The in-memory OffsetDateTime keeps the request's offset.
    expect(p.json.autoSendAt).toBe(autoSendAt);
    expect(p.json.articles[0].excluded).toBe(true);
    expect(p.json.articles[1].excluded).toBe(false);
    expect(p.json.recipientEstimate).toBe(2);

    // Read back from the database: UTC.
    const again = await api.get(`/v1/digests/${id}`, { as: await staff() });
    expect(again.json.autoSendAt).toBe(autoSendAt);

    const cleared = await api.patch(`/v1/digests/${id}`, { as: await staff(), body: {
      subject: 'Edición especial', intro: null, excludedArticleIds: ['a-sabf'], excludedEventIds: [], autoSendAt: null,
    } });
    expect(cleared.status).toBe(200);
    expect(cleared.json.autoSendAt).toBeNull();
    expect(cleared.json.intro).toBeNull();

    const pv = await api.get(`/v1/digests/${id}/preview`, { as: await staff() });
    expect(pv.status).toBe(200);
    expect(pv.headers.get('content-type')).toBe('text/html;charset=UTF-8');
    expect(pv.text).toContain('Título a-ceitba');
    expect(pv.text).toContain('Evento e-general');
    expect(pv.text).toContain('seguís a CEITBA en ITBA News');
    // `mode` is accepted and ignored.
    const me = await api.get(`/v1/digests/${id}/preview`, { as: await staff(), query: { mode: 'me' } });
    expect(me.status).toBe(200);
    expect(me.text).not.toContain('Título a-sabf');
    expect(me.text).toBe(pv.text);
  });

  test('eventsAnnouncedInTheWeekJoinTheIssueWhateverTheirDate', async () => {
    // Created during 28/9..4/10 (ART), dated after the next week: in.
    await seedEvent(api.db, 'e-announced', 'ceitba', '2026-11-20', '2026-09-28T00:00:00-03:00');
    // Created the following Monday at 00:00 ART: next issue's.
    await seedEvent(api.db, 'e-next-issue', 'ceitba', '2026-11-21', '2026-10-05T00:00:00-03:00');
    // Announced in the week but already over by the send: out.
    await seedEvent(api.db, 'e-over', 'ceitba', '2026-10-02', '2026-09-30T12:00:00-03:00');

    const id = await create(api);
    const d = await api.get(`/v1/digests/${id}`, { as: await staff() });
    expect(d.status).toBe(200);
    expect(d.json.events.map((e: { id: string }) => e.id)).toEqual(['e-ceitba', 'e-general', 'e-announced']);
    const pv = await api.get(`/v1/digests/${id}/preview`, { as: await staff() });
    expect(pv.status).toBe(200);
    expect(pv.text).toContain('Nuevos eventos');
    expect(pv.text).toContain('/newsletter/events/e-announced');
  });

  test('sendingAnEmptyIssueIsRefused', async () => {
    const id = await create(api);
    const p = await api.patch(`/v1/digests/${id}`, { as: await staff(), body: {
      excludedArticleIds: ['a-ceitba', 'a-sabf', 'a-indep'], excludedEventIds: ['e-ceitba', 'e-general'],
    } });
    expect(p.status).toBe(200);
    const s = await api.post(`/v1/digests/${id}/send`, { as: await staff() });
    expect(s.status).toBe(409);
    expect(s.json.error).toBe('DIGEST_EMPTY');
    expect(s.json.message).toBe('Nothing to send: every article and event of the week is excluded or there are none');
  });

  test('testSendHonoursTheDomainGuard', async () => {
    const id = await create(api);
    const ok = await api.post(`/v1/digests/${id}/test`, { as: await staff() });
    expect(ok.status).toBe(200);
    expect(ok.text).toBe('{"sentTo":"alice@itba.edu.ar"}');
    // Allowlisted to sign in, but not a digest domain.
    await seedStaff(api.db, 'boss@gmail.com');
    const no = await api.post(`/v1/digests/${id}/test`, { as: await staff('boss@gmail.com') });
    expect(no.status).toBe(422);
    expect(no.json.error).toBe('EMAIL_NOT_ALLOWED');
    expect(no.json.message).toBe('Digest emails only go to itba.edu.ar addresses');
    const log = await api.db`SELECT kind, outcome, recipients FROM public.mail_send_log ORDER BY id`;
    expect(log.map((x) => [x.kind, x.outcome, x.recipients])).toEqual([['test', 'sent', 1]]);
  });

  test('cancelWhileSendingDropsWhatIsLeft', async () => {
    const id = await create(api);
    expect((await api.post(`/v1/digests/${id}/send`, { as: await staff() })).status).toBe(202);
    // One email already went out when staff press "Detener envío".
    await api.db`UPDATE public.digest_deliveries SET status = 'sent', claimed_at = now(), sent_at = now()
                 WHERE issue_id = ${id} AND user_id = ${ids.alice}`;

    const c = await api.post(`/v1/digests/${id}/cancel`, { as: await staff() });
    expect(c.status).toBe(200);
    expect(c.json.status).toBe('cancelled');
    expect(c.json.counts.sent).toBe(1);
    expect(c.json.counts.pending).toBe(0);
    expect(c.json.recipientEstimate).toBeNull();

    const rows = await api.db`SELECT status FROM public.digest_deliveries`;
    expect(rows.map((r) => r.status)).toEqual(['sent']);

    const again = await api.post(`/v1/digests/${id}/cancel`, { as: await staff() });
    expect(again.status).toBe(409);
    expect(again.json.error).toBe('DIGEST_NOT_EDITABLE');
    expect(again.json.message).toBe('Digest is cancelled, not editable');
  });

  test('withoutTheCapabilityOnlyHoldersGetEstimatedAndSubscribe', async () => {
    await setCapabilityOpen(api.db, 'resumen_semanal', false);
    // Plain USER, no grant: 403; unsubscribing stays open.
    const g = await api.get('/v1/digests/subscription', { as: await user() });
    expect(g.status).toBe(403);
    expect(g.json.error).toBe('CAPABILITY_REQUIRED');
    expect(g.json.message).toBe("This feature requires the 'resumen_semanal' capability");
    expect((await api.put('/v1/digests/subscription', { as: await user(), body: { enabled: false } })).status).toBe(403);
    expect((await unsubscribe(api, unsubscribeTokens().issue(ids.alice))).status).toBe(204);

    // A grant on bob's email: the estimate counts only him (alice, staff, opted out above).
    await api.db`INSERT INTO public.capability_user_grants (capability, email) VALUES ('resumen_semanal', 'bob@itba.edu.ar')`;
    expect((await api.get('/v1/digests/subscription', { as: await user() })).status).toBe(200);
    const r = await api.post('/v1/digests', { as: await staff(), body: { weekStart: WEEK } });
    expect(r.status).toBe(201);
    expect(r.json.recipientEstimate).toBe(1);
  });

  test('subscriptionAndOneClickUnsubscribe', async () => {
    expect((await api.get('/v1/digests/subscription')).status).toBe(401);
    const g = await api.get('/v1/digests/subscription', { as: await user() });
    expect(g.status).toBe(200);
    expect(g.text).toBe('{"enabled":true}');
    const off = await api.put('/v1/digests/subscription', { as: await user(), body: { enabled: false } });
    expect(off.status).toBe(200);
    expect(off.text).toBe('{"enabled":false}');
    const [bob] = await api.db`SELECT digest_email_enabled FROM public."user" WHERE id = ${ids.bob}`;
    expect(bob!.digest_email_enabled).toBe(false);
    // Only the flag is cleared: bob still follows CEITBA and SABF.
    expect((await api.db`SELECT 1 FROM public.user_follows WHERE user_id = ${ids.bob} AND org_slug = 'ceitba'`).length).toBe(1);

    // The flag alone is not "subscribed": dave only follows SABF.
    const dave = await user('dave@itba.edu.ar');
    const [{ id: daveId }] = await api.db`SELECT id FROM public."user" WHERE email = 'dave@itba.edu.ar'` as unknown as [{ id: string }];
    const gd = await api.get('/v1/digests/subscription', { as: dave });
    expect(gd.status).toBe(200);
    expect(gd.json.enabled).toBe(false);
    // Opting in also follows CEITBA (idempotent).
    for (let i = 0; i < 2; i++) {
      const on = await api.put('/v1/digests/subscription', { as: dave, body: { enabled: true } });
      expect(on.status).toBe(200);
      expect(on.json.enabled).toBe(true);
    }
    expect((await api.db`SELECT 1 FROM public.user_follows WHERE user_id = ${daveId} AND org_slug = 'ceitba'`).length).toBe(1);

    // Public, RFC 8058 one-click POST (form body), no session.
    const u = await unsubscribe(api, unsubscribeTokens().issue(ids.alice));
    expect(u.status).toBe(204);
    expect(u.text).toBe('');
    const [alice] = await api.db`SELECT digest_email_enabled FROM public."user" WHERE id = ${ids.alice}`;
    expect(alice!.digest_email_enabled).toBe(false);

    const bad = await api.post(`/v1/digests/unsubscribe?token=${crypto.randomUUID()}.AAAA`);
    expect(bad.status).toBe(400);
    expect(bad.json.error).toBe('INVALID_TOKEN');
    expect(bad.json.message).toBe('Invalid unsubscribe token');
    const none = await api.post('/v1/digests/unsubscribe');
    expect(none.status).toBe(400);
    expect(none.json.error).toBe('INVALID_TOKEN');
  });

  // Not in the IT: the token can also come in the form body (Spring's @RequestParam reads it).
  test('unsubscribeTokenInTheFormBody', async () => {
    const t = unsubscribeTokens().issue(ids.bob);
    const r = await api.post('/v1/digests/unsubscribe', {
      body: `token=${encodeURIComponent(t)}`, contentType: 'application/x-www-form-urlencoded',
    });
    expect(r.status).toBe(204);
    const [bob] = await api.db`SELECT digest_email_enabled FROM public."user" WHERE id = ${ids.bob}`;
    expect(bob!.digest_email_enabled).toBe(false);
  });

  // Not in the IT: lookups and checks in the order Java runs them.
  test('unknownIssuesAndRequestValidation', async () => {
    const missing = crypto.randomUUID();
    const g = await api.get(`/v1/digests/${missing}`, { as: await staff() });
    expect(g.status).toBe(404);
    expect(g.json.error).toBe('ResourceNotFound');
    expect(g.json.message).toBe(`Digest with identifier '${missing}' not found`);
    expect((await api.get(`/v1/digests/${missing}/preview`, { as: await staff() })).status).toBe(404);
    expect((await api.post(`/v1/digests/${missing}/cancel`, { as: await staff() })).status).toBe(404);
    expect((await api.delete(`/v1/digests/${missing}`, { as: await staff() })).status).toBe(404);
    expect((await api.post(`/v1/digests/${missing}/send`, { as: await staff() })).status).toBe(404);
    expect((await api.post(`/v1/digests/${missing}/test`, { as: await staff() })).status).toBe(404);
    // {id} only matches a UUID.
    expect((await api.get('/v1/digests/not-a-uuid', { as: await staff() })).status).toBe(404);

    const noWeek = await api.post('/v1/digests', { as: await staff(), body: {} });
    expect(noWeek.status).toBe(400);
    expect(noWeek.json.error).toBe('ValidationError');
    expect(noWeek.json.message).toBe('weekStart: must not be null');
    const past = await api.post('/v1/digests', { as: await staff(), body: { weekStart: WEEK, autoSendAt: '2020-01-01T00:00:00Z' } });
    expect(past.status).toBe(400);
    expect(past.json.error).toBe('AUTO_SEND_IN_PAST');
    expect(past.json.message).toBe('autoSendAt must be in the future');
    const junk = await api.post('/v1/digests', { as: await staff(), body: { weekStart: WEEK, autoSendAt: 'mañana' } });
    expect(junk.status).toBe(400);
    expect(junk.json.error).toBe('ValidationError');
    const future = await api.post('/v1/digests', { as: await staff(), body: { weekStart: WEEK, autoSendAt: '2099-01-05T12:00:00-03:00' } });
    expect(future.status).toBe(201);
    expect(future.json.autoSendAt).toBe('2099-01-05T12:00:00-03:00');
    const id = future.json.id;

    const blank = await api.patch(`/v1/digests/${id}`, { as: await staff(), body: { subject: '   ' } });
    expect(blank.status).toBe(400);
    expect(blank.json.error).toBe('ValidationError');
    const intro = await api.patch(`/v1/digests/${id}`, { as: await staff(), body: { intro: 5 } });
    expect(intro.status).toBe(400);
    expect(intro.json.error).toBe('ValidationError');
    const ok = await api.patch(`/v1/digests/${id}`, { as: await staff(), body: { subject: '  Hola  ', intro: '   ', excludedArticleIds: [' a ', 'a', '', null] } });
    expect(ok.status).toBe(200);
    expect(ok.json.subject).toBe('Hola');
    expect(ok.json.intro).toBeNull();
    expect(ok.json.autoSendAt).toBe('2099-01-05T15:00:00Z');
    const [row] = await api.db`SELECT excluded_article_ids FROM public.digest_issues WHERE id = ${id}`;
    expect(row!.excluded_article_ids).toEqual(['a']);
    const quota = await api.get('/v1/digests/quota', { as: await staff() });
    expect(quota.status).toBe(200);
    expect(quota.text).toBe('{"account":"ceitba@itba.edu.ar","limit":1500,"usedLast24h":0,"remaining":1500,"pausedUntil":null,"pauseReason":null,"nextCapacityAt":null,"senderStatus":"missing"}');
    const stats = await api.get(`/v1/digests/${id}/stats`, { as: await staff() });
    expect(stats.status).toBe(200);
    expect(stats.text).toBe('{"delivered":0,"uniqueOpens":0,"openRate":null,"uniqueClicks":0,"clickRate":null,"clicksByLink":[],"opensByHour":[]}');
  });
});

describe('DigestEndpointsIT (sending worker)', () => {
  beforeEach(async () => { await seed(worker); });

  const statusOf = async (id: string) => (await worker.get(`/v1/digests/${id}`, { as: await staff() })).json?.status;

  test('sendSnapshotsRecipientsThenLocksTheIssue', async () => {
    const id = await create(worker);
    const s = await worker.post(`/v1/digests/${id}/send`, { as: await staff() });
    expect(s.status).toBe(202);
    expect(s.json.status).toBe('sending');
    expect(s.json.counts.pending).toBe(2);
    expect(s.json.recipientEstimate).toBeNull();

    const p = await worker.patch(`/v1/digests/${id}`, { as: await staff(), body: { subject: 'x' } });
    expect(p.status).toBe(409);
    expect(p.json.error).toBe('DIGEST_NOT_EDITABLE');
    expect((await worker.post(`/v1/digests/${id}/send`, { as: await staff() })).status).toBe(409);

    // The worker (logging transport: nothing leaves the process).
    await eventually(async () => (await statusOf(id)) === 'sent', 20_000, 'the issue to be sent');

    const d = await worker.get(`/v1/digests/${id}`, { as: await staff() });
    expect(d.json.status).toBe('sent');
    expect(d.json.sentAt).toBeTruthy();
    expect(d.json.counts.sent).toBe(2);
    expect(d.json.counts.pending).toBe(0);
    const c = await worker.post(`/v1/digests/${id}/cancel`, { as: await staff() });
    expect(c.status).toBe(409);
    expect(c.json.error).toBe('DIGEST_NOT_EDITABLE');
  });

  test('deleteRemovesTheIssueAndItsDeliveriesButNotWhileSending', async () => {
    const id = await create(worker);
    expect((await worker.post(`/v1/digests/${id}/send`, { as: await staff() })).status).toBe(202);

    // Sending: stop it first.
    const d = await worker.delete(`/v1/digests/${id}`, { as: await staff() });
    expect(d.status).toBe(409);
    expect(d.json.error).toBe('DIGEST_SENDING');
    expect(d.json.message).toBe('Digest is sending: stop the send before deleting it');
    expect((await worker.delete(`/v1/digests/${id}`, { as: await user() })).status).toBe(403);

    await eventually(async () => (await statusOf(id)) === 'sent', 20_000, 'the issue to be sent');
    expect((await worker.db`SELECT 1 FROM public.digest_deliveries`).length).toBeGreaterThan(0);

    const ok = await worker.delete(`/v1/digests/${id}`, { as: await staff() });
    expect(ok.status).toBe(204);
    expect(ok.text).toBe('');
    expect((await worker.get(`/v1/digests/${id}`, { as: await staff() })).status).toBe(404);
    expect((await worker.db`SELECT 1 FROM public.digest_deliveries`).length).toBe(0);
    expect((await worker.delete(`/v1/digests/${id}`, { as: await staff() })).status).toBe(404);

    // The week is free again.
    expect((await worker.post('/v1/digests', { as: await staff(), body: { weekStart: WEEK } })).status).toBe(201);
  });
});
