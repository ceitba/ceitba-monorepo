// Port of apps/api/src/test/java/org/ceitba/api/service/digest/DigestSenderTest.java
// (+ the worker half of DigestEndpointsIT.cancelWhileSendingDropsWhatIsLeft).
// The Java test mocks the repositories; here the real ones run on a clone of
// the contract database, with the Java test's fakes: a MutableClock at
// 2026-10-05T15:00Z, a recording transport (failure / unavailable switches),
// a counting sleeper and a replaceable personal section.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { EmailSendError, type EmailSender, type OutgoingEmail } from '../../src/infra/mail';
import { MutableClock } from '../../src/infra/clock';
import { digestBeans, type DigestBeans } from '../../src/features/digest/beans';
import type { PersonalSection } from '../../src/features/digest/logic/digestRenderer';
import { testApp, type TestApp } from '../support/app';
import { follow, seedOrg, setCapabilityOpen, unsubscribeTokens } from './support/seed';

const NOW = '2026-10-05T15:00:00Z';
const ISSUE = '11111111-1111-4111-8111-111111111111';
const HOUR = 3_600_000;

class FakeTransport implements EmailSender {
  readonly sent: OutgoingEmail[] = [];
  failure: (to: string) => Error | null = () => null;
  unavailable: string | null = null;
  async send(e: OutgoingEmail) {
    const ex = this.failure(e.to);
    if (ex) throw ex;
    this.sent.push(e);
  }
  enabled() { return true; }
  async unavailableReason() { return this.unavailable; }
  get sentTo() { return this.sent.map((e) => e.to); }
}

interface Harness { t: TestApp; clock: MutableClock; transport: FakeTransport; beans: DigestBeans; sleeps: number;
  personal: (readers: string[]) => Promise<Map<string, PersonalSection>> | Map<string, PersonalSection>; afterSleep: (() => Promise<void>) | null }

async function harness(limit: number): Promise<Harness> {
  const clock = new MutableClock(NOW);
  const transport = new FakeTransport();
  const t = await testApp({ env: { MAIL_DAILY_LIMIT: String(limit), DIGEST_TRACKING_ENABLED: 'false' }, overrides: { clock, mailTransport: transport } });
  const h: Harness = { t, clock, transport, beans: digestBeans(t.deps), sleeps: 0, personal: () => new Map(), afterSleep: null };
  h.beans.sender.sleeper = async () => { h.sleeps++; if (h.afterSleep) await h.afterSleep(); };
  (h.beans.composer as unknown as { personal: unknown }).personal = { forReaders: async (_db: unknown, readers: Iterable<string>) => h.personal([...readers]) };
  return h;
}

let h: Harness;
let small: Harness;
let n = 0;

beforeAll(async () => {
  h = await harness(1500);
  small = await harness(10);
}, 60_000);
afterAll(async () => { await h?.t.close(); await small?.t.close(); });

async function reset(x: Harness) {
  const db = x.t.sql;
  await db`TRUNCATE public.digest_issues, public.digest_deliveries, public.mail_send_log, public.mail_account_state,
           public.articles, public.organizations, public."user", public.capability_settings CASCADE`;
  x.clock.set(NOW);
  x.transport.sent.length = 0;
  x.transport.failure = () => null;
  x.transport.unavailable = null;
  x.sleeps = 0;
  x.personal = () => new Map();
  x.afterSleep = null;
  n = 0;
  await setCapabilityOpen(db, 'resumen_semanal', true);
  await seedOrg(db, 'ceitba', 'CEITBA', 'Centro de Estudiantes');
  // One article: the issue is not empty.
  await db`INSERT INTO public.articles (id, title, excerpt, body, category, organization, published_at, status, authors, featured, color_scheme, created_at, updated_at)
           VALUES ('a1', 'Título', 'Resumen', '["p"]'::jsonb, 'general', NULL, '2026-09-30', 'published', '["x"]'::jsonb, false, 'blue', now(), now())`;
  await db`INSERT INTO public.digest_issues (id, week_start, subject, status, excluded_article_ids, excluded_event_ids, created_at, updated_at)
           VALUES (${ISSUE}, '2026-09-28', 'Asunto', 'sending', '{}', '{}', now(), now())`;
}

/** A pending delivery; ids ascend in creation order (the claim order is attempts, user_id). */
async function recipient(x: Harness, email: string, o: { enabled?: boolean; follows?: boolean; status?: string } = {}): Promise<string> {
  const id = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  await x.t.sql`INSERT INTO public."user" (id, email, name, digest_email_enabled, created_at, updated_at)
                VALUES (${id}, ${email}, 'N', ${o.enabled ?? true}, now(), now())`;
  if (o.follows ?? true) await follow(x.t.sql, id, 'ceitba');
  await x.t.sql`INSERT INTO public.digest_deliveries (issue_id, user_id, email, status, claimed_at)
                VALUES (${ISSUE}, ${id}, ${email}, ${o.status ?? 'pending'}, ${o.status === 'sending' ? '2026-10-05T14:50:00Z' : null})`;
  return id;
}

const rows = async (x: Harness) => new Map((await x.t.sql`SELECT user_id, status FROM public.digest_deliveries`).map((r) => [r.user_id as string, r.status as string]));
const row = async (x: Harness, id: string) => (await x.t.sql`SELECT * FROM public.digest_deliveries WHERE user_id = ${id}`)[0];
const issueStatus = async (x: Harness) => (await x.t.sql`SELECT status FROM public.digest_issues WHERE id = ${ISSUE}`)[0]?.status;
const ledgerRows = async (x: Harness) => x.t.sql`SELECT * FROM public.mail_send_log ORDER BY id`;
const seedLedger = async (x: Harness, at: string, count: number) => {
  for (let i = 0; i < count; i++) await x.t.sql`INSERT INTO public.mail_send_log (account, kind, recipients, outcome, attempted_at) VALUES ('ceitba@itba.edu.ar', 'test', 1, 'sent', ${at})`;
};

describe('DigestSenderTest', () => {
  beforeEach(async () => { await reset(h); await reset(small); });

  test('sendsEveryPendingThrottledThenMarksIssueSent', async () => {
    await recipient(h, 'a@itba.edu.ar');
    await recipient(h, 'b@itba.edu.ar');
    await recipient(h, 'c@itba.edu.ar');
    await h.beans.sender.runPending();
    expect(h.transport.sentTo).toEqual(['a@itba.edu.ar', 'b@itba.edu.ar', 'c@itba.edu.ar']);
    expect([...(await rows(h)).values()]).toEqual(['sent', 'sent', 'sent']);
    expect(h.sleeps).toBe(3);
    expect(await issueStatus(h)).toBe('sent');
  });

  test('personalSectionIsLoadedForTheClaimedReaderAndSplicedPerReader', async () => {
    const a = await recipient(h, 'a@itba.edu.ar');
    const b = await recipient(h, 'b@itba.edu.ar');
    const calls: string[][] = [];
    h.personal = (readers) => {
      calls.push(readers);
      return new Map([[a, { html: '<tr><td>SOLO-A</td></tr>', text: 'SOLO-A' }]]);
    };
    await h.beans.sender.runPending();
    expect(calls).toEqual([[a], [b]]);
    expect(h.transport.sent[0]!.html).toContain('SOLO-A');
    expect(h.transport.sent[1]!.html).not.toContain('SOLO-A');
  });

  test('aFailingPersonalSectionStillSendsTheSharedDigest', async () => {
    await recipient(h, 'a@itba.edu.ar');
    h.personal = () => { throw new Error('db down'); };
    await h.beans.sender.runPending();
    expect(h.transport.sentTo).toEqual(['a@itba.edu.ar']);
    expect([...(await rows(h)).values()]).toEqual(['sent']);
  });

  test('quotaStopsTheRunAndItOverflowsIntoTheNextDay', async () => {
    const s = small;
    for (let i = 0; i < 5; i++) await recipient(s, `u${i}@itba.edu.ar`);
    // 7 of 10 used an hour ago (e.g. test sends): 3 left today.
    await seedLedger(s, '2026-10-05T14:00:00Z', 7);
    await s.beans.sender.runPending();
    expect(s.transport.sent).toHaveLength(3);
    expect([...(await rows(s)).values()].filter((v) => v === 'pending')).toHaveLength(2);
    expect(await ledgerRows(s)).toHaveLength(10);

    // Later ticks the same day: no SMTP at all until capacity frees.
    s.clock.advance(5 * HOUR);
    await s.beans.sender.runPending();
    expect(s.transport.sent).toHaveLength(3);

    // The 7 old ones leave the window 24h after they were sent.
    s.clock.set('2026-10-06T14:00:00Z');
    await s.beans.sender.runPending();
    expect(s.transport.sent).toHaveLength(5);
    expect(new Set(s.transport.sentTo).size).toBe(5);
    expect([...(await rows(s)).values()].every((v) => v === 'sent')).toBe(true);
  });

  test('gmailDailyLimitPausesTheRunForADayWithoutTouchingTheRow', async () => {
    const a = await recipient(h, 'a@itba.edu.ar');
    await recipient(h, 'b@itba.edu.ar');
    h.transport.failure = () => new EmailSendError('QUOTA', '550 5.4.5 Daily user sending limit exceeded');
    await h.beans.sender.runPending();
    expect((await row(h, a))!.status).toBe('pending');
    expect([...(await rows(h)).values()]).not.toContain('failed');

    h.transport.failure = () => null;
    h.clock.advance(23 * HOUR);
    await h.beans.sender.runPending();
    expect(h.transport.sent).toHaveLength(0);

    h.clock.advance(HOUR);
    await h.beans.sender.runPending();
    expect(h.transport.sent).toHaveLength(2);
  });

  test('recipientFailureIsRecordedAndTheRunGoesOn', async () => {
    await recipient(h, 'a@itba.edu.ar');
    const bad = await recipient(h, 'bad@itba.edu.ar');
    await recipient(h, 'c@itba.edu.ar');
    h.transport.failure = (to) => (to.startsWith('bad') ? new EmailSendError('RECIPIENT', '550 no such user') : null);
    await h.beans.sender.runPending();
    expect(h.transport.sentTo).toEqual(['a@itba.edu.ar', 'c@itba.edu.ar']);
    expect(await row(h, bad)).toMatchObject({ status: 'failed', error: '550 no such user' });
  });

  test('anUnusableSenderSkipsTheTickBeforeClaimingAnythingAndResumesWhenFixed', async () => {
    const a = await recipient(h, 'a@itba.edu.ar');
    await recipient(h, 'b@itba.edu.ar');
    h.transport.unavailable = 'Gmail sender account ceitba@itba.edu.ar is broken: reconnect it';
    await h.beans.sender.runPending();
    await h.beans.sender.runPending();
    expect(await row(h, a)).toMatchObject({ status: 'pending', claimed_at: null, attempts: 0 });
    expect(await ledgerRows(h)).toHaveLength(0);
    h.transport.unavailable = null;
    await h.beans.sender.runPending();
    expect(h.transport.sent).toHaveLength(2);
  });

  test('transportFailureStopsWithoutBlamingTheRow', async () => {
    const a = await recipient(h, 'a@itba.edu.ar');
    await recipient(h, 'b@itba.edu.ar');
    h.transport.failure = () => new EmailSendError('TRANSPORT', '535 5.7.8 bad credentials');
    await h.beans.sender.runPending();
    expect(h.transport.sent).toHaveLength(0);
    expect(await row(h, a)).toMatchObject({ status: 'pending', attempts: 0 });
    expect([...(await rows(h)).values()]).not.toContain('failed');

    h.transport.failure = () => null; // SMTP back, but the account backs off 5 min
    await h.beans.sender.runPending();
    expect(h.transport.sent).toHaveLength(0);
    h.clock.advance(5 * 60_000);
    await h.beans.sender.runPending();
    expect(h.transport.sent).toHaveLength(2);
  });

  test('temporaryFailureOfOneRecipientNeverStallsTheIssueAndFailsAfterThreeAttempts', async () => {
    const bad = await recipient(h, 'bad@itba.edu.ar');
    await recipient(h, 'b@itba.edu.ar');
    await recipient(h, 'c@itba.edu.ar');
    h.transport.failure = (to) => (to.startsWith('bad') ? new EmailSendError('TRANSIENT', '451 4.3.0 try later') : null);
    // The DB claim waits RETRY_DELAY (2 min) before retrying a row (the Java mock does not): move the clock on each pause.
    h.afterSleep = async () => { h.clock.advance(3 * 60_000); };
    for (let i = 0; i < 3 && (await issueStatus(h)) === 'sending'; i++) await h.beans.sender.runPending();
    expect(h.transport.sentTo).toEqual(['b@itba.edu.ar', 'c@itba.edu.ar']);
    const r = await row(h, bad);
    expect(r!.status).toBe('failed');
    expect(r!.attempts).toBe(2);
    expect(r!.error).toStartWith('gave up after 3 attempts');
    expect(r!.error).toContain('451 4.3.0');
    expect(await issueStatus(h)).toBe('sent');
  });

  test('rowsLeftSendingByACrashAreFailedNeverResent', async () => {
    const lost = await recipient(h, 'lost@itba.edu.ar', { status: 'sending' }); // claimed 14:50Z, outcome unknown
    await recipient(h, 'ok@itba.edu.ar');
    await h.beans.sender.runPending();
    const r = await row(h, lost);
    expect(r!.status).toBe('failed');
    expect(r!.error).toBe('unknown outcome (interrupted)');
    expect((r!.sent_at as Date).toISOString()).toBe('2026-10-05T14:50:00.000Z');
    expect(h.transport.sentTo).toEqual(['ok@itba.edu.ar']);
  });

  test('cancelMidwayStopsBeforeTheNextEmail', async () => {
    await recipient(h, 'a@itba.edu.ar');
    await recipient(h, 'b@itba.edu.ar');
    await recipient(h, 'c@itba.edu.ar');
    // Staff press "Detener envío" while the first email is going out (the cancel
    // waits for the send transaction's share lock, so it lands right after it).
    let cancel: Promise<unknown> | null = null;
    h.transport.failure = () => {
      cancel ??= h.t.sql`UPDATE public.digest_issues SET status = 'cancelled' WHERE id = ${ISSUE}`.then((x) => x);
      return null;
    };
    h.afterSleep = async () => { await cancel; };
    await h.beans.sender.runPending();
    expect(h.transport.sentTo).toEqual(['a@itba.edu.ar']);
    expect(await issueStatus(h)).toBe('cancelled');
  });

  test('dropsRecipientsThatNoLongerQualify', async () => {
    const off = await recipient(h, 'off@itba.edu.ar', { enabled: false });
    const foreign = await recipient(h, 'x@gmail.com');
    const unfollowed = await recipient(h, 'gone@itba.edu.ar', { follows: false });
    await recipient(h, 'ok@itba.edu.ar');
    await h.beans.sender.runPending();
    expect(h.transport.sentTo).toEqual(['ok@itba.edu.ar']);
    const left = await rows(h);
    for (const id of [off, foreign, unfollowed]) expect(left.has(id)).toBe(false);
  });

  test('everyEmailCarriesItsOwnUnsubscribeHeaders', async () => {
    const ids = [await recipient(h, 'a@itba.edu.ar'), await recipient(h, 'b@itba.edu.ar')];
    await h.beans.sender.runPending();
    expect(h.transport.sent).toHaveLength(2);
    ids.forEach((id, i) => {
      const mail = h.transport.sent[i]!;
      const token = unsubscribeTokens().issue(id);
      expect(mail.headers!['List-Unsubscribe']).toBe(`<https://ceitba.org.ar/api/v1/digests/unsubscribe?token=${token}>`);
      expect(mail.headers!['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
      expect(mail.headers!.Precedence).toBe('bulk');
      expect(mail.kind).toBe('digest');
      expect(mail.html).toContain(`https://ceitba.org.ar/newsletter/unsubscribe?token=${token}`);
    });
  });

  test('trackedEmailsWrapEveryBodyLinkButNotTheUnsubscribeHeader', async () => {
    h.beans.tracking.enabled = () => true;
    try {
      const a = await recipient(h, 'a@itba.edu.ar');
      h.personal = () => new Map([[a, {
        html: '<tr><td><a href="https://ceitba.org.ar/newsletter/correction?token=T&amp;vote=confirm">Sí</a></td></tr>',
        text: 'Sí: https://ceitba.org.ar/newsletter/correction?token=T&vote=confirm',
      }]]);
      await h.beans.sender.runPending();
      const mail = h.transport.sent[0]!;
      const token = unsubscribeTokens().issue(a);
      expect(mail.headers!['List-Unsubscribe']).toBe(`<https://ceitba.org.ar/api/v1/digests/unsubscribe?token=${token}>`);
      const unsubscribe = `https://ceitba.org.ar/newsletter/unsubscribe?token=${token}`;
      let links = 0;
      let untouched = 0;
      for (const m of mail.html.matchAll(/href="([^"]*)"/g)) {
        if (m[1] === unsubscribe) { untouched++; continue; }
        links++;
        expect(m[1]).toStartWith('https://ceitba.org.ar/api/v1/mail/c/');
      }
      expect(links).toBeGreaterThanOrEqual(3);
      expect(untouched).toBe(1);
      let textUntouched = 0;
      for (const m of mail.text.matchAll(/https?:\/\/\S+/g)) {
        if (m[0] === unsubscribe) { textUntouched++; continue; }
        expect(m[0]).toStartWith('https://ceitba.org.ar/api/v1/mail/c/');
      }
      expect(textUntouched).toBe(1);
      expect(mail.html).toContain('/v1/mail/o/');
      expect(mail.html).toContain('Medimos aperturas y clics');
      expect(mail.text).toContain('Medimos aperturas y clics');

      const r = await row(h, a);
      expect(r!.tracking_id).toHaveLength(22);
      expect(r!.tracking_id).not.toContain(a);
      const personal = await h.t.sql`SELECT link_id, url_key FROM public.digest_delivery_links WHERE tracking_id = ${r!.tracking_id}`;
      expect(personal.map((l) => l.url_key)).toEqual(['https://ceitba.org.ar/newsletter/correction?vote=confirm']);
      expect(personal.every((l) => l.link_id >= 1000)).toBe(true);
      const shared = await h.t.sql`SELECT link_id FROM public.digest_issue_links WHERE issue_id = ${ISSUE} AND url = 'https://ceitba.org.ar/newsletter/articles/a1'`;
      expect(shared).toHaveLength(1);
      expect(shared[0]!.link_id).toBeLessThan(1000);
    } finally {
      delete (h.beans.tracking as { enabled?: unknown }).enabled;
    }
  });

  // DigestEndpointsIT.cancelWhileSendingDropsWhatIsLeft, the part after the cancel: the worker sends nothing more.
  test('cancelWhileSendingDropsWhatIsLeft (worker after the cancel)', async () => {
    const a = await recipient(h, 'a@itba.edu.ar');
    await recipient(h, 'b@itba.edu.ar');
    await h.t.sql`UPDATE public.digest_deliveries SET status = 'sent', sent_at = now() WHERE user_id = ${a}`;
    await h.beans.service.cancel(ISSUE);
    await h.beans.sender.runPending();
    expect(h.transport.sent).toHaveLength(0);
    expect([...(await rows(h)).values()]).toEqual(['sent']);
  });
});
