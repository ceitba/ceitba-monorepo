// Ports of DigestServiceTest, DigestTrackingServiceTest and
// DigestComposerCapabilityTest (apps/api/src/test/java/org/ceitba/api/service/digest/).
// The Java tests mock the repositories; these run the real services on a clone
// of the contract database with a MutableClock.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { digestBeans, type DigestBeans } from '../../src/features/digest/beans';
import { NULL_NODE } from '../../src/features/digest/dto';
import { DigestException } from '../../src/features/digest/logic/digestException';
import { DigestTrackingService, flagOf, rate, PER_TRACKING_ID_PER_HOUR } from '../../src/features/digest/tracking';
import { contentHmac } from '../../src/features/crypto/service';
import { mailSettings } from '../../src/features/mail/settings';
import { MutableClock } from '../../src/infra/clock';
import { parsePgTimestamp } from '../../src/lib/time';
import { testApp, type TestApp } from '../support/app';
import { follow, seedOrg, setCapabilityOpen } from './support/seed';

const us = (iso: string) => parsePgTimestamp(iso);

let t: TestApp;
let off: TestApp;
let clock: MutableClock;
let b: DigestBeans;

beforeAll(async () => {
  clock = new MutableClock('2026-10-05T13:00:00Z');
  t = await testApp({ env: { DIGEST_TRACKING_ENABLED: 'true' }, overrides: { clock } });
  b = digestBeans(t.deps);
  off = await testApp({ env: { MAIL_LOG_SENDS: 'false' }, overrides: { clock } });
}, 60_000);
afterAll(async () => { await t?.close(); await off?.close(); });

const expectReason = async (p: Promise<unknown>, reason: string) => {
  const e = await p.then(() => null, (x) => x);
  expect(e).toBeInstanceOf(DigestException);
  expect((e as DigestException).reason as string).toBe(reason);
};

describe('DigestServiceTest', () => {
  beforeEach(async () => {
    await t.sql`TRUNCATE public.digest_issues CASCADE`;
    clock.set('2026-10-05T13:00:00Z');
  });

  // The week that just ended is 2026-09-28; its draft is auto-sent Monday 12:00 ART.
  const cases: [string, boolean, string | null][] = [
    ['2026-10-04T23:59:00-03:00', false, null], // Sunday
    ['2026-10-05T00:04:00-03:00', false, null], // before 00:05
    ['2026-10-05T00:05:00-03:00', true, '2026-10-05T12:00:00-03:00'],
    ['2026-10-05T11:59:00-03:00', true, '2026-10-05T12:00:00-03:00'], // catch-up before the send time
    ['2026-10-05T12:00:00-03:00', true, null], // catch-up after it: staff send it
    ['2026-10-05T23:59:00-03:00', true, null],
    ['2026-10-06T00:00:00-03:00', false, null], // Tuesday: a deleted draft stays deleted
    ['2026-10-08T12:00:00-03:00', false, null],
  ];
  for (const [at, created, autoSendAt] of cases) {
    test(`weeklyDraftIsCreatedOnlyOnMondayAfter0005 [${at}]`, async () => {
      clock.set(at);
      const id = await b.service.createScheduledDraft();
      expect(id != null).toBe(created);
      const rows = await t.sql`SELECT week_start::text AS w, auto_send_at FROM public.digest_issues`;
      if (!created) { expect(rows).toHaveLength(0); return; }
      expect(rows[0]!.w).toBe('2026-09-28');
      if (autoSendAt == null) expect(rows[0]!.auto_send_at).toBeNull();
      else expect((rows[0]!.auto_send_at as Date).getTime()).toBe(new Date(autoSendAt).getTime());
    });
  }

  test('weeklyDraftIsIdempotent', async () => {
    clock.set('2026-10-05T10:00:00-03:00');
    expect(await b.service.createScheduledDraft()).not.toBeNull();
    expect(await b.service.createScheduledDraft()).toBeNull();
    expect(await t.sql`SELECT 1 FROM public.digest_issues`).toHaveLength(1);
  });

  test('autoSendInThePastIsRejectedOnCreateAndPatch', async () => {
    clock.set('2026-10-05T10:00:00-03:00');
    const past = '2026-10-05T09:59-03:00';
    await expectReason(b.service.create({ weekStart: '2026-09-28', autoSendAt: past }), 'AUTO_SEND_IN_PAST');
    const d = await b.service.create({ weekStart: '2026-09-28', autoSendAt: null });
    await expectReason(b.service.patch(d.id, { subject: null, intro: null, excludedArticleIds: null, excludedEventIds: null, autoSendAt: past }),
      'AUTO_SEND_IN_PAST');
  });

  test('patchKeepingTheStoredPastAutoSendAtStillSaves', async () => {
    clock.set('2026-10-05T10:00:00-03:00');
    const d = await b.service.create({ weekStart: '2026-09-28', autoSendAt: null });
    const stored = '2026-10-05T07:00:00-03:00';
    await t.sql`UPDATE public.digest_issues SET auto_send_at = ${stored} WHERE id = ${d.id}`;
    const r = await b.service.patch(d.id, { subject: 'Nuevo asunto', intro: null, excludedArticleIds: null, excludedEventIds: null, autoSendAt: stored });
    expect(r.subject).toBe('Nuevo asunto');
    expect(r.autoSendAt).toBe(stored);
    // An explicit null (NullNode) disables it.
    const n = await b.service.patch(d.id, { subject: null, intro: null, excludedArticleIds: null, excludedEventIds: null, autoSendAt: NULL_NODE });
    expect(n.autoSendAt).toBeNull();
  });

  test('disabledMailRefusesSendAndTestAndSkipsAutoSend', async () => {
    const s = digestBeans(off.deps).service;
    const id = crypto.randomUUID();
    await expectReason(s.send(id, crypto.randomUUID()), 'MAIL_DISABLED');
    await expectReason(s.sendTest(id, crypto.randomUUID()), 'MAIL_DISABLED');
    await off.sql`TRUNCATE public.digest_issues CASCADE`;
    await off.sql`INSERT INTO public.digest_issues (id, week_start, subject, status, auto_send_at) VALUES (${id}, '2026-09-28', 'x', 'draft', '2026-10-05T12:00:00Z')`;
    expect(await s.startDueAutoSends()).toEqual([]);
    expect((await off.sql`SELECT status FROM public.digest_issues`)[0]!.status).toBe('draft');
  });
});

describe('DigestComposerCapabilityTest', () => {
  test('nonHoldersAreExcludedAndEnabledForAllIncludesEveryone', async () => {
    const db = t.sql;
    await db`TRUNCATE public."user", public.organizations, public.capability_settings, public.capability_user_grants, public.ceitba_staff CASCADE`;
    await seedOrg(db, 'ceitba', 'CEITBA', 'Centro');
    const holder = crypto.randomUUID();
    const other = crypto.randomUUID();
    for (const [id, email] of [[holder, 'holder@itba.edu.ar'], [other, 'other@itba.edu.ar']] as const) {
      await db`INSERT INTO public."user" (id, email, name, digest_email_enabled, created_at, updated_at) VALUES (${id}, ${email}, 'N', true, now(), now())`;
      await follow(db, id, 'ceitba');
    }
    const c = b.composer;
    expect(await c.recipients(t.deps.db)).toEqual([]);
    expect(await c.stillEligible(t.deps.db, holder, 'holder@itba.edu.ar')).toBe(false);
    await setCapabilityOpen(db, 'resumen_semanal', true);
    expect((await c.recipients(t.deps.db)).map((r) => r.userId).sort()).toEqual([holder, other].sort());
    expect(await c.stillEligible(t.deps.db, other, 'other@itba.edu.ar')).toBe(true);
  });
});

describe('DigestTrackingServiceTest', () => {
  const TID = 'AbCdEfGhIjKlMnOpQrStUv';
  const ISSUE = crypto.randomUUID();
  const SENT = '2026-10-05T15:00:00Z';
  const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15';
  const HOME = 'https://ceitba.org.ar/newsletter';
  let n = 0;
  // A fresh client address per test: the per-IP buckets live in the service.
  let ip = '';
  const client = (ua: string, method = 'GET') => ({ userAgent: ua, method, ip });
  const events = () => t.sql`SELECT * FROM public.mail_tracking_event ORDER BY id`;
  const delivery = async () => (await t.sql`SELECT * FROM public.digest_deliveries WHERE tracking_id = ${TID}`)[0]!;

  beforeEach(async () => {
    ip = `203.0.113.${++n}`;
    // The per-tracking-id bucket too: a fresh service per test (Java builds one in setUp).
    (b as { tracking: DigestTrackingService }).tracking = new DigestTrackingService(t.deps, mailSettings(t.deps.config), contentHmac(t.deps.config));
    const db = t.sql;
    await db`TRUNCATE public.digest_issues, public."user" CASCADE`;
    const user = crypto.randomUUID();
    await db`INSERT INTO public."user" (id, email, name, created_at, updated_at) VALUES (${user}, 'a@itba.edu.ar', 'A', now(), now())`;
    await db`INSERT INTO public.digest_issues (id, week_start, subject, status) VALUES (${ISSUE}, '2026-09-28', 'x', 'sent')`;
    await db`INSERT INTO public.digest_deliveries (issue_id, user_id, email, status, sent_at, tracking_id) VALUES (${ISSUE}, ${user}, 'a@itba.edu.ar', 'sent', ${SENT}, ${TID})`;
    await db`INSERT INTO public.digest_issue_links (issue_id, link_id, url, url_key, label) VALUES (${ISSUE}, 3, 'https://ceitba.org.ar/newsletter/articles/a1', 'k', 'Título')`;
    await db`INSERT INTO public.digest_delivery_links (tracking_id, link_id, url, url_key, label) VALUES
             (${TID}, 1000, 'https://ceitba.org.ar/newsletter/unsubscribe?token=x', 'k', 'Baja'), (${TID}, 1001, 'javascript:alert(1)', 'k', 'x')`;
    clock.set(us(SENT) + 5 * 60_000_000);
  });

  test('clicksGoOnlyToStoredUrls', async () => {
    const s = b.tracking;
    expect(await s.click(TID, '3', client(BROWSER))).toBe('https://ceitba.org.ar/newsletter/articles/a1');
    expect(await s.click(TID, '1000', client(BROWSER))).toBe('https://ceitba.org.ar/newsletter/unsubscribe?token=x');
    expect(await s.click(TID, '4', client(BROWSER))).toBe(HOME);
    expect(await s.click('ZZZZZZZZZZZZZZZZZZZZZZ', '3', client(BROWSER))).toBe(HOME);
    expect(await s.click('../x', '3', client(BROWSER))).toBe(HOME);
    expect(await s.click(TID, 'https:%2F%2Fevil.example', client(BROWSER))).toBe(HOME);
    expect(await s.click(TID, '-1', client(BROWSER))).toBe(HOME);
    expect(await s.click(TID, '1001', client(BROWSER))).toBe(HOME);
  });

  test('realClickCountsAndImpliesAnOpen', async () => {
    await b.tracking.click(TID, '3', client(BROWSER));
    const [e] = await events();
    expect(e).toMatchObject({ flagged: false, link_id: 3, ua_class: 'browser', type: 'click' });
    expect(await delivery()).toMatchObject({ click_count: 1, open_count: 1 });
  });

  test('scannerClickIsRecordedFlaggedAndNotCounted', async () => {
    await b.tracking.click(TID, '3', client('Mozilla/5.0 Proofpoint URL Defense'));
    const [e] = await events();
    expect(e).toMatchObject({ flagged: true, flag_reason: 'scanner' });
    expect(await delivery()).toMatchObject({ click_count: 0, open_count: 0 });
  });

  test('openWithinSecondsOfSendingIsFlagged', async () => {
    clock.set(us(SENT) + 3_000_000);
    await b.tracking.open(TID, client(BROWSER));
    expect((await events())[0]).toMatchObject({ flag_reason: 'early', type: 'open' });
    expect((await delivery()).open_count).toBe(0);
    clock.set(us(SENT) + 30_000_000);
    await b.tracking.open(TID, client('Mozilla/5.0 (via ggpht.com GoogleImageProxy)'));
    expect((await events())[1]).toMatchObject({ flagged: false, ua_class: 'gmail_proxy' });
    expect((await delivery()).open_count).toBe(1);
  });

  test('unknownTrackingIdsRecordNothing', async () => {
    await b.tracking.open('ZZZZZZZZZZZZZZZZZZZZZZ', client(BROWSER));
    await b.tracking.open('nope', client(BROWSER));
    expect(await events()).toHaveLength(0);
  });

  test('flagRules', () => {
    const sent = us('2026-10-05T15:00:00Z');
    const get = { userAgent: BROWSER, method: 'GET', ip: null };
    expect(flagOf('BROWSER', get, sent, sent + 11_000_000)).toBeNull();
    expect(flagOf('BROWSER', get, sent, sent + 9_000_000)).toBe('early');
    expect(flagOf('BROWSER', get, null, sent)).toBe('early');
    expect(flagOf('SCANNER', get, sent, sent + 3_600_000_000)).toBe('scanner');
    expect(flagOf('BROWSER', { ...get, method: 'HEAD' }, sent, sent + 3_600_000_000)).toBe('scanner');
  });

  test('refusedRequestsStillAnswerButNeverTouchTheDatabase', async () => {
    for (let i = 0; i < PER_TRACKING_ID_PER_HOUR; i++) {
      expect(await b.tracking.click(TID, '3', client(BROWSER))).toBe('https://ceitba.org.ar/newsletter/articles/a1');
    }
    for (let i = 0; i < 5; i++) {
      expect(await b.tracking.click(TID, '3', client(BROWSER))).toBe(HOME);
      await b.tracking.open(TID, client(BROWSER));
    }
    expect(await events()).toHaveLength(PER_TRACKING_ID_PER_HOUR);
  });

  test('theBodyUnsubscribeLinkIsNeverTracked', () => {
    expect(b.tracking.isUnsubscribeLink(`${HOME}/unsubscribe?token=u.SIG`)).toBe(true);
    expect(b.tracking.isUnsubscribeLink(`${HOME}/unsubscribe`)).toBe(true);
    expect(b.tracking.isUnsubscribeLink(`${HOME}/unsubscribed-articles`)).toBe(false);
    expect(b.tracking.isUnsubscribeLink(`${HOME}/articles/a1`)).toBe(false);
  });

  test('ratesAreRounded', () => {
    expect(rate(1, 3)).toBe(0.3333);
    expect(rate(0, 0)).toBeNull();
  });
});
