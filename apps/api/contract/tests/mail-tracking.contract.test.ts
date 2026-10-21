// Ports apps/api/src/test/java/org/ceitba/api/web/mail/MailTrackingIT.java
// (@TestPropertySource mail.daily-limit=3 -> MAIL_DAILY_LIMIT=3).
//
// sentIssue() calls DigestSender.runPending() in the IT; black-box, the
// worker DigestJob kicks after the send commits does it (DIGEST_JOBS_ENABLED
// on the second server), and the test polls until the issue is sent.
// retentionDeletesOldTrackingAndSendLogRowsOnly calls MailRetentionService
// directly (its job runs nightly): in-process, test/mail/retention.test.ts.
import { beforeEach, describe, expect, test } from 'bun:test';
import { bearer, mintJwt, seedStaff, seedUser, useServer, type Server } from '../support';
import { eventually, follow, seedArticle, seedOrg, setCapabilityOpen } from '../../test/digest/support/seed';

const ENV = { MAIL_DAILY_LIMIT: '3' };
const api = useServer({ env: ENV });
const worker = useServer({ env: { ...ENV, DIGEST_JOBS_ENABLED: 'true', DIGEST_TICK_INTERVAL: 'PT1H' } });

const HOME = 'https://ceitba.org.ar/newsletter';
const ARTICLE_URL = `${HOME}/articles/a-ceitba`;
const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15';

async function seed(s: Server) {
  await s.db`
    TRUNCATE public.digest_deliveries, public.digest_issues, public.user_follows, public.mail_send_log,
             public.mail_account_state, public.articles, public.news_events, public.organizations,
             public."user", public.capability_settings CASCADE`;
  await setCapabilityOpen(s.db, 'resumen_semanal', true);
  await seedOrg(s.db, 'ceitba', 'CEITBA', 'Centro de Estudiantes');
  const alice = await seedUser(s.db, 'alice@itba.edu.ar', { name: 'Alice' });
  const bob = await seedUser(s.db, 'bob@itba.edu.ar', { name: 'Bob' });
  await follow(s.db, alice, 'ceitba');
  await follow(s.db, bob, 'ceitba');
  await seedArticle(s.db, 'a-ceitba', 'ceitba', '2026-09-30', 'published');
  await seedStaff(s.db, 'alice@itba.edu.ar');
}

const staff = async () => bearer(await mintJwt({ email: 'alice@itba.edu.ar', name: 'Alice' }));
const user = async () => bearer(await mintJwt({ email: 'bob@itba.edu.ar', name: 'Bob' }));

async function sentIssue(s: Server): Promise<string> {
  const c = await s.post('/v1/digests', { as: await staff(), body: { weekStart: '2026-09-28' } });
  expect(c.status).toBe(201);
  const id = c.json.id as string;
  expect((await s.post(`/v1/digests/${id}/send`, { as: await staff() })).status).toBe(202);
  await eventually(async () => (await s.get(`/v1/digests/${id}`, { as: await staff() })).json?.status === 'sent', 20_000, 'the issue to be sent');
  return id;
}

describe('MailTrackingIT', () => {
  beforeEach(async () => { await seed(api); });

  test('pixelAndRedirectArePublicAndNeverFailOnUnknownIds', async () => {
    // A stale session cookie must not turn them into 401s.
    const stale = { headers: { Cookie: 'ceitba_session=not-a-jwt' } };
    const px = await api.get('/v1/mail/o/AbCdEfGhIjKlMnOpQrStUv.gif', stale);
    expect(px.status).toBe(200);
    expect(px.headers.get('content-type')).toBe('image/gif');
    expect(px.headers.get('cache-control')).toContain('no-store');
    expect(px.headers.get('cache-control')).toBe('no-store, must-revalidate, private');
    expect(px.headers.get('pragma')).toBe('no-cache');
    expect(px.headers.get('expires')).toBe('0');
    expect(px.headers.get('content-length')).toBe('42');
    expect(Buffer.from(px.text, 'latin1').length).toBeGreaterThan(0);
    expect((await api.get('/v1/mail/o/x')).status).toBe(200);
    const head = await api.head('/v1/mail/o/AbCdEfGhIjKlMnOpQrStUv.gif');
    expect(head.status).toBe(200);

    const c = await api.get('/v1/mail/c/AbCdEfGhIjKlMnOpQrStUv/1', stale);
    expect(c.status).toBe(302);
    expect(c.location).toBe(HOME);
    expect(c.headers.get('cache-control')).toBe('no-store');
    expect(c.headers.get('referrer-policy')).toBe('no-referrer');
    expect(c.text).toBe('');
    const w = await api.get('/v1/mail/c/whatever/abc');
    expect(w.status).toBe(302);
    expect(w.location).toBe(HOME);
    // A URL in the query string is never followed.
    const evil = await api.get('/v1/mail/c/AbCdEfGhIjKlMnOpQrStUv/1', { query: { url: 'https://evil.example' } });
    expect(evil.location).toBe(HOME);
    const [{ n }] = await api.db`SELECT COUNT(*)::int AS n FROM public.mail_tracking_event` as unknown as [{ n: number }];
    expect(n).toBe(0);
  });

  test('quotaAndStatsAreStaffOnly', async () => {
    const id = crypto.randomUUID();
    expect((await api.get('/v1/digests/quota')).status).toBe(401);
    expect((await api.get('/v1/digests/quota', { as: await user() })).status).toBe(403);
    expect((await api.get(`/v1/digests/${id}/stats`)).status).toBe(401);
    expect((await api.get(`/v1/digests/${id}/stats`, { as: await user() })).status).toBe(403);
    const nf = await api.get(`/v1/digests/${id}/stats`, { as: await staff() });
    expect(nf.status).toBe(404);
    expect(nf.json.error).toBe('ResourceNotFound');
  });
});

describe('MailTrackingIT (sending worker)', () => {
  beforeEach(async () => { await seed(worker); });

  test('sentIssueIsTrackedAndStatsAreAggregate', async () => {
    const id = await sentIssue(worker);
    const db = worker.db;

    const tracking = (await db`SELECT tracking_id FROM public.digest_deliveries WHERE issue_id = ${id} AND status = 'sent'`)
      .map((r) => r.tracking_id as string);
    expect(tracking).toHaveLength(2);
    expect(tracking.every((t) => t.length === 22)).toBe(true);
    // Outside the "within seconds of sending" window.
    await db`UPDATE public.digest_deliveries SET sent_at = now() - interval '1 hour'`;
    const [{ link_id: articleLink }] = await db`SELECT link_id FROM public.digest_issue_links WHERE issue_id = ${id} AND url = ${ARTICLE_URL}` as unknown as [{ link_id: number }];
    // The unsubscribe link is never tracked (it must always work).
    const [{ n: unsub }] = await db`SELECT COUNT(*)::int AS n FROM public.digest_delivery_links WHERE url_key LIKE ${'%/unsubscribe%'}` as unknown as [{ n: number }];
    expect(unsub).toBe(0);

    const [a, b] = tracking as [string, string];
    expect((await worker.get(`/v1/mail/o/${a}.gif`, { headers: { 'User-Agent': BROWSER } })).status).toBe(200);
    expect((await worker.get(`/v1/mail/o/${a}.gif`, { headers: { 'User-Agent': BROWSER } })).status).toBe(200);
    const click = await worker.get(`/v1/mail/c/${a}/${articleLink}`, { headers: { 'User-Agent': BROWSER } });
    expect(click.status).toBe(302);
    expect(click.location).toBe(ARTICLE_URL);
    // b: only a security scanner followed the link -> flagged, not counted.
    const scan = await worker.get(`/v1/mail/c/${b}/${articleLink}`, { headers: { 'User-Agent': 'Barracuda Sentinel' } });
    expect(scan.status).toBe(302);
    expect(scan.location).toBe(ARTICLE_URL);
    // No per-reader link exists for these deliveries: id 1000 is unknown -> home.
    const unknown = await worker.get(`/v1/mail/c/${a}/1000`, { headers: { 'User-Agent': BROWSER } });
    expect(unknown.status).toBe(302);
    expect(unknown.location).toBe(HOME);

    // Not in the IT: a HEAD on the pixel is a scanner (recorded, flagged, not counted).
    expect((await worker.head(`/v1/mail/o/${b}.gif`, { headers: { 'User-Agent': BROWSER } })).status).toBe(200);

    const [counts] = await db`SELECT open_count, click_count FROM public.digest_deliveries WHERE tracking_id = ${a}`;
    expect(counts).toMatchObject({ open_count: 2, click_count: 1 });
    const [{ n: flagged }] = await db`SELECT COUNT(*)::int AS n FROM public.mail_tracking_event WHERE flagged AND flag_reason = 'scanner'` as unknown as [{ n: number }];
    expect(flagged).toBe(2);
    const [bc] = await db`SELECT open_count FROM public.digest_deliveries WHERE tracking_id = ${b}`;
    expect(bc!.open_count).toBe(0);
    const [{ n: headOpens }] = await db`SELECT COUNT(*)::int AS n FROM public.mail_tracking_event WHERE tracking_id = ${b} AND type = 'open' AND flag_reason = 'scanner'` as unknown as [{ n: number }];
    expect(headOpens).toBe(1);

    const st = await worker.get(`/v1/digests/${id}/stats`, { as: await staff() });
    expect(st.status).toBe(200);
    expect(st.json.delivered).toBe(2);
    expect(st.json.uniqueOpens).toBe(1);
    expect(st.json.openRate).toBe(0.5);
    expect(st.json.uniqueClicks).toBe(1);
    expect(st.json.clickRate).toBe(0.5);
    expect(st.json.clicksByLink).toHaveLength(1);
    expect(st.json.clicksByLink[0]).toEqual({ label: 'Título a-ceitba', url: ARTICLE_URL, uniqueClicks: 1, totalClicks: 1 });
    expect(st.json.opensByHour).toHaveLength(1);
    expect(st.json.opensByHour[0].count).toBe(1);
    expect(st.json.opensByHour[0].hour).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00:00-03:00$/);
    expect(st.text).toStartWith('{"delivered":2,"uniqueOpens":1,"openRate":0.5,"uniqueClicks":1,"clickRate":0.5,"clicksByLink":[{"label":"Título a-ceitba","url":"https://ceitba.org.ar/newsletter/articles/a-ceitba","uniqueClicks":1,"totalClicks":1}],"opensByHour":[{"hour":"');
    // Aggregates only: nothing that identifies a reader.
    expect(st.text).not.toContain('alice');
    expect(st.text).not.toContain('bob');
    expect(st.text).not.toContain(a);
    expect(st.text).not.toContain('token=');

    const list = await worker.get('/v1/digests', { as: await staff() });
    expect(list.json[0].openRate).toBe(0.5);
    expect(list.json[0].clickRate).toBe(0.5);
    expect(list.json[0].resumeAt).toBeNull();
    expect(list.text).toContain('"openRate":0.5,"clickRate":0.5}');
  });

  test('quotaIsSharedWithTestSendsWhichGet429WhenItRunsOut', async () => {
    await sentIssue(worker); // 2 of 3 used
    const q = await worker.get('/v1/digests/quota', { as: await staff() });
    expect(q.status).toBe(200);
    expect(q.json.account).toBe('ceitba@itba.edu.ar');
    expect(q.json.limit).toBe(3);
    expect(q.json.usedLast24h).toBe(2);
    expect(q.json.remaining).toBe(1);
    expect(q.json.pausedUntil).toBeNull();
    expect(q.json.nextCapacityAt).toBeNull();

    const [{ id }] = await worker.db`SELECT id::text AS id FROM public.digest_issues` as unknown as [{ id: string }];
    expect((await worker.post(`/v1/digests/${id}/test`, { as: await staff() })).status).toBe(200);
    const no = await worker.post(`/v1/digests/${id}/test`, { as: await staff() });
    expect(no.status).toBe(429);
    expect(no.json.error).toBe('MAIL_QUOTA_EXHAUSTED');
    expect(no.json.resumeAt).not.toBeNull();
    expect(no.json.resumeAt).toMatch(/-03:00$/);
    expect(Object.keys(no.json)).toEqual(['error', 'message', 'path', 'timestamp', 'resumeAt']);
    expect(no.json.message).toStartWith('The daily sending limit of ceitba@itba.edu.ar is used up; sending resumes at ');
    expect(no.headers.get('retry-after')).not.toBeNull();

    const after = await worker.get('/v1/digests/quota', { as: await staff() });
    expect(after.json.remaining).toBe(0);
    expect(after.json.nextCapacityAt).not.toBeNull();
    expect(after.json.nextCapacityAt).toMatch(/-03:00$/);
    const kinds = (await worker.db`SELECT kind FROM public.mail_send_log ORDER BY id`).map((r) => r.kind);
    expect(kinds).toEqual(['digest', 'digest', 'test']);
  });
});
