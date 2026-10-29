// Port of apps/api/src/test/java/org/ceitba/api/service/mail/MailSendServiceTest.java
// The sending-quota ledger: rolling 24h window, resumeAt maths, Gmail's own
// daily-limit pause, transport backoff and overflow across days.
import { describe, expect, test } from 'bun:test';
import { EmailSendError, type EmailSender, type OutgoingEmail } from '../../src/infra/mail';
import { isClear, CLEAR } from '../../src/features/mail/logic/mailLedger';
import { MailQuotaExhausted, MailSendService, type MailSendOptions } from '../../src/features/mail/logic/mailSendService';
import { InMemoryMailLedger } from './support/InMemoryMailLedger';
import { MutableClock } from './support/MutableClock';

const ACCOUNT = 'ceitba@itba.edu.ar';
const T0 = Date.parse('2026-10-05T15:00:00Z') * 1000;
const MIN = 60_000;
const HOUR = 3_600_000;
const us = (ms: number) => ms * 1000;

function fixture() {
  const ledger = new InMemoryMailLedger();
  const clock = new MutableClock(T0);
  const sent: string[] = [];
  const ctx = { failure: (_to: string): Error | null => null };
  const transportOf = (send: (e: OutgoingEmail) => Promise<void>): EmailSender => ({
    send, enabled: () => true, unavailableReason: async () => null,
  });
  const opts = (limit: number, extra: Partial<MailSendOptions> = {}): MailSendOptions =>
    ({ account: ACCOUNT, limit, backoffInitialMs: 5 * MIN, backoffMaxMs: HOUR, quotaPauseMs: 24 * HOUR, ...extra });
  const service = (limit: number) => new MailSendService(transportOf(async (email) => {
    const ex = ctx.failure(email.to);
    if (ex != null) throw ex;
    sent.push(email.to);
  }), ledger, opts(limit), clock);
  return { ledger, clock, sent, ctx, service, transportOf, opts };
}

const mail = (to: string, kind = 'digest'): OutgoingEmail => ({ to, subject: 's', html: '<p>h</p>', text: 't', headers: {}, kind });

async function rejects(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('expected a rejection');
}

describe('MailSendServiceTest', () => {
  test('everyAttemptIsLoggedWithAccountKindAndOutcome', async () => {
    const { ledger, ctx, service } = fixture();
    const s = service(10);
    await s.send(mail('a@itba.edu.ar'));
    await s.send({ to: 'b@itba.edu.ar', subject: 's', html: 'h', text: 't', kind: 'test' });
    ctx.failure = () => new EmailSendError('RECIPIENT', '550 5.1.1 no such user');
    expect(await rejects(s.send(mail('bad@itba.edu.ar')))).toBeInstanceOf(EmailSendError);

    expect(ledger.rows.map((r) => r.kind)).toEqual(['digest', 'test', 'digest']);
    expect(ledger.rows.map((r) => r.outcome)).toEqual(['SENT', 'SENT', 'REJECTED']);
    expect(ledger.rows.every((r) => r.account === ACCOUNT && r.recipients === 1)).toBe(true);
    // Rejected recipients reached Gmail: they count.
    expect((await s.status()).usedLast24h).toBe(3);
    expect((await s.status()).remaining).toBe(7);
  });

  test('rollingWindowRefusesWhenFullAndSaysWhenCapacityFrees', async () => {
    const { ledger, clock, sent, service } = fixture();
    // 3 at T0-20h, 2 at T0-10h: limit 5 is full.
    ledger.sent(ACCOUNT, T0 - us(20 * HOUR), 3);
    ledger.sent(ACCOUNT, T0 - us(10 * HOUR), 2);
    const s = service(5);

    const status = await s.status();
    expect(status.usedLast24h).toBe(5);
    expect(status.remaining).toBe(0);
    // The oldest attempt in the window + 24h.
    expect(status.nextCapacityAt).toBe(T0 + us(4 * HOUR));
    expect(await s.readyAt()).toBe(T0 + us(4 * HOUR));

    const e = await rejects(s.send(mail('a@itba.edu.ar')));
    expect(e).toBeInstanceOf(MailQuotaExhausted);
    expect((e as MailQuotaExhausted).resumeAt).toBe(T0 + us(4 * HOUR));
    expect(sent).toEqual([]);
    // A refused send is not an attempt: nothing logged.
    expect(ledger.rows).toHaveLength(5);

    // 4h later the 3 oldest left the window.
    clock.advance(4 * HOUR);
    expect((await s.status()).remaining).toBe(3);
    expect((await s.status()).nextCapacityAt).toBeNull();
    expect(await s.readyAt()).toBeNull();
    await s.send(mail('a@itba.edu.ar'));
    expect(sent).toEqual(['a@itba.edu.ar']);
  });

  test('overLimitNeedsSeveralOldAttemptsToExpire', async () => {
    const { ledger, service } = fixture();
    // Limit lowered below what was sent: 8 used, limit 5 -> 4 must leave.
    for (let h = 1; h <= 8; h++) ledger.sent(ACCOUNT, T0 - us((24 - h) * HOUR), 1);
    const s = service(5);
    expect((await s.status()).nextCapacityAt).toBe(T0 - us(20 * HOUR) + us(24 * HOUR));
  });

  test('overflowRollsIntoTheNextDay', async () => {
    const { ledger, clock, sent, service } = fixture();
    const s = service(3);
    const all = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const queue = [...all];
    let firstResume: number | null = null;
    // Day 1: three go out (one per minute), then the quota is used up.
    while (queue.length > 0) {
      try {
        await s.send(mail(queue[0]!));
        queue.shift();
        clock.advance(MIN);
      } catch (e) {
        if (!(e instanceof MailQuotaExhausted)) throw e;
        if (firstResume == null) firstResume = e.resumeAt;
        // What the job does: nothing until resumeAt.
        clock.set(e.resumeAt);
      }
    }
    expect(sent).toEqual(all);
    // The 4th waited until the first email's slot freed, 24h later.
    expect(firstResume).toBe(T0 + us(24 * HOUR));
    // Never more than 3 in any 24h window.
    const times = ledger.rows.map((r) => r.at);
    for (const t of times) {
      expect(times.filter((x) => !(x < t) && x < t + us(24 * HOUR)).length).toBeLessThanOrEqual(3);
    }
    // 7 emails at 3/day: the last one goes out on the third day.
    expect(times[6]!).toBeGreaterThanOrEqual(T0 + us(48 * HOUR));
  });

  test('gmailDailyLimitErrorPausesTheAccountForADayAndSurvivesARestart', async () => {
    const { ledger, clock, sent, ctx, service } = fixture();
    ledger.sent(ACCOUNT, T0 - us(HOUR), 10); // our count: 10 of 1500
    const s = service(1500);
    ctx.failure = () => new EmailSendError('QUOTA', '550 5.4.5 Daily user sending limit exceeded');

    expect(await rejects(s.send(mail('a@itba.edu.ar')))).toBeInstanceOf(EmailSendError);
    expect(ledger.rows[ledger.rows.length - 1]!.outcome).toBe('QUOTA');
    // Gmail's error does not count as a send.
    expect((await s.status()).usedLast24h).toBe(10);

    const until = T0 + us(24 * HOUR);
    expect((await s.status()).pausedUntil).toBe(until);
    expect((await s.status()).pauseReason).toBe('quota');

    // A restart (new service, same persisted ledger) is still paused, and a
    // manual (test) send is refused with the same resumeAt.
    ctx.failure = () => null;
    const restarted = service(1500);
    expect(await restarted.readyAt()).toBe(until);
    const e = await rejects(restarted.send(mail('staff@itba.edu.ar')));
    expect(e).toBeInstanceOf(MailQuotaExhausted);
    expect((e as MailQuotaExhausted).resumeAt).toBe(until);
    expect(sent).toEqual([]);

    clock.set(until);
    expect(await restarted.readyAt()).toBeNull();
    await restarted.send(mail('a@itba.edu.ar'));
    expect(sent).toEqual(['a@itba.edu.ar']);
    expect((await restarted.status()).pausedUntil).toBeNull();
  });

  test('gmailPauseLengthIsConfigurable', async () => {
    const { ledger, clock, transportOf, opts } = fixture();
    const s = new MailSendService(transportOf(async () => {
      throw new EmailSendError('QUOTA', '550 5.4.5');
    }), ledger, opts(1500, { quotaPauseMs: 30 * HOUR }), clock);
    expect(await rejects(s.send(mail('a@itba.edu.ar')))).toBeInstanceOf(EmailSendError);
    expect(await s.readyAt()).toBe(T0 + us(30 * HOUR));
  });

  test('theQuotaPauseAndTheTransportBackoffAreLoggedAsJavaDid', async () => {
    const warnings: string[] = [];
    const failingWith = (failure: EmailSendError) => {
      const { ledger, transportOf, opts } = fixture();
      return new MailSendService(transportOf(async () => { throw failure; }), ledger,
        opts(1500, { log: { warn: (m) => warnings.push(m) } }), new MutableClock(T0));
    };
    await rejects(failingWith(new EmailSendError('QUOTA', '550 5.4.5')).send(mail('a@itba.edu.ar')));
    await rejects(failingWith(new EmailSendError('TRANSPORT', 'timeout')).send(mail('a@itba.edu.ar')));
    expect(warnings).toEqual([
      "Mail: ceitba@itba.edu.ar hit the provider's daily sending limit; paused until 2026-10-06T15:00:00Z",
      'Mail: transport problem for ceitba@itba.edu.ar (failure 1 in a row), backing off until 2026-10-05T15:05:00Z: timeout',
    ]);
  });

  test('transportErrorsBackOffExponentiallyAndASuccessClearsIt', async () => {
    const { ledger, clock, sent, ctx, service } = fixture();
    const s = service(1500);
    ctx.failure = () => new EmailSendError('TRANSPORT', '421 4.7.0 Try again later');

    for (const minutes of [5, 10, 20, 40, 60, 60]) {
      expect(await rejects(s.send(mail('a@itba.edu.ar')))).toBeInstanceOf(EmailSendError);
      expect(await s.readyAt()).toBe(clock.now() + us(minutes * MIN));
      expect((await s.status()).pauseReason).toBe('transport');
      clock.set((await s.readyAt())!);
    }
    // Transport errors never count against the quota.
    expect((await s.status()).usedLast24h).toBe(0);
    expect(ledger.rows.every((r) => r.outcome === 'TRANSIENT')).toBe(true);

    // A manual send still tries during the backoff (to check SMTP is back).
    ctx.failure = () => new EmailSendError('TRANSPORT', 'timeout');
    expect(await rejects(s.send(mail('a@itba.edu.ar')))).toBeInstanceOf(EmailSendError);
    ctx.failure = () => null;
    await s.send(mail('staff@itba.edu.ar'));
    expect(sent).toEqual(['staff@itba.edu.ar']);
    expect(await s.readyAt()).toBeNull();
    expect(isClear(ledger.states.get(ACCOUNT)!)).toBe(true);

    // The count starts over: the next error is 5 min again.
    ctx.failure = () => new EmailSendError('TRANSPORT', 'timeout');
    expect(await rejects(s.send(mail('a@itba.edu.ar')))).toBeInstanceOf(EmailSendError);
    expect(await s.readyAt()).toBe(clock.now() + us(5 * MIN));
  });

  test('aThrottleWithRetryAfterBacksOffShortlyNotTheExponentialStepNorTheDailyPause', async () => {
    const { clock, ctx, service } = fixture();
    const s = service(1500);
    ctx.failure = () => new EmailSendError('TRANSPORT', '429', undefined, 30_000);
    expect(await rejects(s.send(mail('a@itba.edu.ar')))).toBeInstanceOf(EmailSendError);
    expect(await s.readyAt()).toBe(clock.now() + us(30_000));
    // A hint beyond the cap is capped at backoffMax.
    ctx.failure = () => new EmailSendError('TRANSPORT', '429', undefined, 24 * HOUR);
    expect(await rejects(s.send(mail('a@itba.edu.ar')))).toBeInstanceOf(EmailSendError);
    expect(await s.readyAt()).toBe(clock.now() + us(HOUR));
  });

  test('aDeliveryScopedTemporaryErrorDoesNotPauseTheAccount', async () => {
    const { ledger, ctx, service } = fixture();
    const s = service(1500);
    ctx.failure = () => new EmailSendError('TRANSIENT', '451 4.3.0 try later');
    expect(await rejects(s.send(mail('a@itba.edu.ar')))).toBeInstanceOf(EmailSendError);

    expect(await s.readyAt()).toBeNull();
    expect(isClear(ledger.states.get(ACCOUNT) ?? CLEAR)).toBe(true);
    expect((await s.status()).usedLast24h).toBe(0); // not counted
  });

  test('digestAndTestEmailsOutsideTheAllowedDomainsAreRefusedBeforeSending', async () => {
    const { ledger, clock, sent, transportOf, opts } = fixture();
    const s = new MailSendService(transportOf(async (email) => {
      sent.push(email.to);
    }), ledger, opts(10, { allowedRecipient: (to) => to.endsWith('@itba.edu.ar') }), clock);

    for (const kind of ['digest', 'test']) {
      const e = await rejects(s.send({ to: 'x@gmail.com', subject: 's', html: 'h', text: 't', kind }));
      expect(e).toBeInstanceOf(EmailSendError);
      expect((e as EmailSendError).kind).toBe('RECIPIENT');
    }
    expect(sent).toEqual([]);
    expect(ledger.rows).toEqual([]); // nothing sent, nothing counted

    await s.send({ to: 'ok@itba.edu.ar', subject: 's', html: 'h', text: 't', kind: 'digest' });
    expect(sent).toEqual(['ok@itba.edu.ar']);
  });

  test('estimateFinishFollowsTheRollingWindow', async () => {
    const { ledger, service } = fixture();
    // Limit 3, 2 used 23h ago: 1 left now, 2 more free in 1h.
    ledger.sent(ACCOUNT, T0 - us(23 * HOUR), 2);
    const s = service(3);
    expect(await s.estimateFinish(1, 1000)).toBe(T0);
    // 2nd waits until the 2 old ones leave (T0 + 1h), 3rd 1 s later.
    expect(await s.estimateFinish(3, 1000)).toBe(T0 + us(HOUR) + us(1000));
    // 4th: the window then holds T0, T0+1h, T0+1h+1s -> waits for T0 + 24h.
    expect(await s.estimateFinish(4, 1000)).toBe(T0 + us(24 * HOUR));
  });

  test('estimateFinishStartsAfterAPause', async () => {
    const { ledger, service } = fixture();
    const s = service(1500);
    ledger.states.set(ACCOUNT, { pausedUntil: T0 + us(2 * HOUR), pauseReason: 'quota', consecutiveFailures: 0 });
    expect(await s.estimateFinish(3, 1000)).toBe(T0 + us(2 * HOUR) + us(2000));
  });
});
