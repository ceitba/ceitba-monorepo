// Port of apps/api/src/main/java/org/ceitba/api/service/mail/MailSendService.java.
//
// THE EmailSender of the app: every email, whoever sends it, goes through the
// sending-quota ledger (docs/WEEKLY-DIGEST.md, "Sending quota"):
//   - Every attempt is logged (account = From address, kind, recipients,
//     outcome). The quota counts the recipients of attempts that reached the
//     provider (sent + rejected).
//   - Rolling window: remaining = limit - used in the last 24h. With no quota
//     left nothing is sent: MailQuotaExhausted(resumeAt).
//   - Gmail's own daily-limit error (QUOTA) is authoritative: paused for
//     quotaPause, or until the rolling-window estimate if later. Persisted.
//   - Other transport errors pause with exponential backoff (5 min, 10, 20, 40,
//     then 1 h), or the provider's Retry-After capped at backoffMax. Persisted.
//     Only background senders honour it (readyAt()); a manual send still tries.
//     Any successful send clears it. TRANSIENT does not pause the account.
//   - Digest, test and org emails to an address outside the allowed domains
//     are refused here (RECIPIENT, nothing sent or logged).
// One send at a time per service (Java: synchronized); here a promise chain.

import type { Clock } from '../../../infra/clock';
import { EmailSendError, type EmailSender, type OutgoingEmail } from '../../../infra/mail';
import { MailQuotaExhaustedError } from '../../../http/errors';
import { javaIsBlank } from '../../../lib/javaCompat';
import { formatInstant, type Micros } from '../../../lib/time';
import { CLEAR, isClear, type MailAccountState, type MailLedger } from './mailLedger';

export const WINDOW_MS = 24 * 3_600_000;
const WINDOW = WINDOW_MS * 1000; // micros
export const PAUSE_QUOTA = 'quota';
export const PAUSE_TRANSPORT = 'transport';

export const KIND_OTHER = 'other';
export const KIND_DIGEST = 'digest';
export const KIND_TEST = 'test';
export const KIND_ORG = 'org';

/** OutgoingEmail's compact constructor: headers default to {}, a null/blank kind to "other". */
export function kindOf(email: OutgoingEmail): string {
  return email.kind == null || javaIsBlank(email.kind) ? KIND_OTHER : email.kind;
}

/** MailQuotaExhaustedException (429 MAIL_QUOTA_EXHAUSTED with resumeAt). */
export class MailQuotaExhausted extends MailQuotaExhaustedError {
  constructor(readonly account: string, readonly resumeAt: Micros) {
    super(`The daily sending limit of ${account} is used up; sending resumes at ${formatInstant(resumeAt)}`, resumeAt);
  }
}

/**
 * MailSenderNotConnectedException: an EmailSendException(TRANSPORT) for the
 * worker AND a 409 MAIL_SENDER_NOT_CONNECTED for a direct send.
 * TODO(mail-service): src/http/app.ts maps only ApiError subclasses; teach the
 * error mapper this class (status/code below) or catch it in the routes.
 */
export class MailSenderNotConnected extends EmailSendError {
  static readonly CODE = 'MAIL_SENDER_NOT_CONNECTED';
  readonly status = 409;
  readonly code = MailSenderNotConnected.CODE;
  constructor(message: string) {
    super('TRANSPORT', message);
  }
}

export interface QuotaStatus {
  account: string;
  limit: number;
  usedLast24h: number;
  remaining: number;
  pausedUntil: Micros | null;
  pauseReason: string | null;
  nextCapacityAt: Micros | null;
}

export interface MailSendOptions {
  account: string;
  limit: number;
  backoffInitialMs: number;
  backoffMaxMs: number;
  quotaPauseMs: number;
  /** The domain guard applied to the digest, test and org kinds. */
  allowedRecipient?: (to: string) => boolean;
}

const later = (a: Micros | null, b: Micros | null): Micros | null => (a == null ? b : b == null ? a : a > b ? a : b);

export class MailSendService implements EmailSender {
  readonly account: string;
  readonly limit: number;
  private readonly backoffInitial: number;
  private readonly backoffMax: number;
  private readonly quotaPause: number;
  private readonly allowedRecipient: (to: string) => boolean;
  private lock: Promise<unknown> = Promise.resolve();

  constructor(private readonly transport: EmailSender, private readonly ledger: MailLedger, opts: MailSendOptions,
              private readonly clock: Clock) {
    this.account = opts.account;
    this.limit = Math.max(0, opts.limit);
    this.backoffInitial = opts.backoffInitialMs * 1000;
    this.backoffMax = opts.backoffMaxMs * 1000;
    this.quotaPause = opts.quotaPauseMs * 1000;
    this.allowedRecipient = opts.allowedRecipient ?? (() => true);
  }

  /** False when the transport cannot really send (MAIL_ENABLED=false). */
  enabled(): boolean {
    return this.transport.enabled();
  }

  unavailableReason(): Promise<string | null> {
    return this.transport.unavailableReason();
  }

  /**
   * Sends one email (one recipient) if the account has quota. Throws
   * MailQuotaExhausted (nothing sent, nothing logged) or the transport's
   * EmailSendError (logged, pause updated).
   */
  async send(email: OutgoingEmail): Promise<void> {
    const recipients = 1;
    const kind = kindOf(email);
    if (guarded(kind) && !this.allowedRecipient(email.to)) {
      throw new EmailSendError('RECIPIENT', 'Recipient is outside the allowed domains');
    }
    // The sender account itself is unusable: nothing attempted, logged or backed off.
    const unavailable = await this.transport.unavailableReason();
    if (unavailable != null) throw new MailSenderNotConnected(unavailable);
    await this.exclusive(async () => {
      const now = this.clock.now();
      const blocked = await this.quotaBlockedUntil(now, recipients);
      if (blocked != null) throw new MailQuotaExhausted(this.account, blocked);
      try {
        await this.transport.send(email);
      } catch (e) {
        if (e instanceof EmailSendError) {
          await this.onFailure(e, kind, recipients);
          throw e;
        }
        // Java logs e.toString() ("java.lang.IllegalStateException: msg"); here String(e) ("Error: msg").
        await this.ledger.record(this.account, kind, recipients, 'TRANSIENT', String(e), this.clock.now());
        throw e;
      }
      const at = this.clock.now();
      await this.ledger.record(this.account, kind, recipients, 'SENT', null, at);
      const state = (await this.ledger.state(this.account)) ?? CLEAR;
      if (!isClear(state)) await this.ledger.saveState(this.account, CLEAR, at);
    });
  }

  /**
   * When the account may send again, if not now: the quota pause or an
   * exhausted rolling window, and the transport backoff. What background
   * senders check before touching SMTP. null = now.
   */
  async readyAt(): Promise<Micros | null> {
    const now = this.clock.now();
    let blocked = await this.quotaBlockedUntil(now, 1);
    const state = (await this.ledger.state(this.account)) ?? CLEAR;
    if (state.pausedUntil != null && state.pausedUntil > now) blocked = later(blocked, state.pausedUntil);
    return blocked;
  }

  async status(): Promise<QuotaStatus> {
    const now = this.clock.now();
    const used = await this.ledger.usedSince(this.account, now - WINDOW);
    const remaining = Math.max(0, this.limit - used);
    const state = (await this.ledger.state(this.account)) ?? CLEAR;
    const paused = state.pausedUntil != null && state.pausedUntil > now;
    const next = remaining === 0 ? await this.capacityFreesAt(now, used - this.limit + 1) : null;
    return {
      account: this.account, limit: this.limit, usedLast24h: used, remaining,
      pausedUntil: paused ? state.pausedUntil : null, pauseReason: paused ? state.pauseReason : null, nextCapacityAt: next,
    };
  }

  /**
   * Estimated time the last of `emails` more emails goes out, one every
   * `intervalMs` from when the account is ready, waiting for the rolling window
   * whenever it is full. Assumes no other sends and no new pause. null when the limit is 0.
   */
  async estimateFinish(emails: number, intervalMs: number): Promise<Micros | null> {
    if (this.limit <= 0) return null;
    const now = this.clock.now();
    const ready = await this.readyAt();
    let t = ready != null && ready > now ? ready : now;
    if (emails <= 0) return t;
    const interval = intervalMs * 1000;
    const window: Micros[] = [];
    for (const u of await this.ledger.usageSince(this.account, now - WINDOW)) {
      for (let i = 0; i < u.recipients; i++) window.push(u.at);
    }
    let head = 0;
    for (let n = 0; n < emails; n++) {
      for (;;) {
        while (head < window.length && !(window[head]! + WINDOW > t)) head++;
        if (window.length - head < this.limit) break;
        t = window[head]! + WINDOW;
      }
      window.push(t);
      if (n < emails - 1) t += interval;
    }
    return t;
  }

  // ------------------------------------------------------------ internals

  /** null if `recipients` more can go out now as far as the quota goes (window + Gmail's pause, not the backoff). */
  async quotaBlockedUntil(now: Micros, recipients: number): Promise<Micros | null> {
    const state = (await this.ledger.state(this.account)) ?? CLEAR;
    let blocked: Micros | null = null;
    if (state.pauseReason === PAUSE_QUOTA && state.pausedUntil != null && state.pausedUntil > now) blocked = state.pausedUntil;
    const used = await this.ledger.usedSince(this.account, now - WINDOW);
    if (used + recipients > this.limit) blocked = later(blocked, await this.capacityFreesAt(now, used + recipients - this.limit));
    return blocked;
  }

  /** When `units` recipients have left the rolling window (oldest first), plus 24h. */
  async capacityFreesAt(now: Micros, units: number): Promise<Micros> {
    if (units <= 0) return now;
    let cum = 0;
    for (const u of await this.ledger.usageSince(this.account, now - WINDOW)) {
      cum += u.recipients;
      if (cum >= units) return u.at + WINDOW;
    }
    // More than the whole window (a limit of 0, or a send bigger than the limit): a full window from now.
    return now + WINDOW;
  }

  private async onFailure(e: EmailSendError, kind: string, recipients: number): Promise<void> {
    const now = this.clock.now();
    const state = (await this.ledger.state(this.account)) ?? CLEAR;
    switch (e.kind) {
      case 'RECIPIENT':
        await this.ledger.record(this.account, kind, recipients, 'REJECTED', e.message, now);
        break;
      case 'QUOTA': {
        await this.ledger.record(this.account, kind, recipients, 'QUOTA', e.message, now);
        const used = await this.ledger.usedSince(this.account, now - WINDOW);
        let until: Micros = now + this.quotaPause;
        if (used >= this.limit) until = later(until, await this.capacityFreesAt(now, used - this.limit + 1))!;
        await this.ledger.saveState(this.account, { pausedUntil: until, pauseReason: PAUSE_QUOTA, consecutiveFailures: state.consecutiveFailures }, now);
        // TODO(mail-service): log.warn("Mail: {} hit the provider's daily sending limit; paused until {}")
        break;
      }
      case 'TRANSIENT':
        // Temporary and scoped to one delivery: logged, the account is not paused.
        await this.ledger.record(this.account, kind, recipients, 'TRANSIENT', e.message, now);
        break;
      case 'TRANSPORT': {
        await this.ledger.record(this.account, kind, recipients, 'TRANSIENT', e.message, now);
        const failures = state.consecutiveFailures + 1;
        // A provider hint (Retry-After of a per-second throttle) wins over the schedule, capped at backoffMax.
        const hint = e.retryAfterMs != null ? e.retryAfterMs * 1000 : null;
        const wait = hint != null && hint > 0 ? Math.min(hint, this.backoffMax) : this.backoff(failures);
        const until = now + wait;
        // Never shorten a quota pause.
        const next: MailAccountState = state.pauseReason === PAUSE_QUOTA && state.pausedUntil != null && state.pausedUntil > until
          ? { pausedUntil: state.pausedUntil, pauseReason: PAUSE_QUOTA, consecutiveFailures: failures }
          : { pausedUntil: until, pauseReason: PAUSE_TRANSPORT, consecutiveFailures: failures };
        await this.ledger.saveState(this.account, next, now);
        break;
      }
    }
  }

  /** initial * 2^(failures-1), capped (micros). */
  backoff(failures: number): number {
    let d = this.backoffInitial;
    for (let i = 1; i < failures && d < this.backoffMax; i++) d *= 2;
    return d > this.backoffMax ? this.backoffMax : d;
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.catch(() => undefined);
    return run;
  }
}

function guarded(kind: string): boolean {
  return kind === KIND_DIGEST || kind === KIND_TEST || kind === KIND_ORG;
}
