// Port of apps/api/src/main/java/org/ceitba/api/service/mail/MailLedger.java.
//
// Storage behind MailSendService: the attempt log (mail_send_log) and the
// persisted per-account pause (mail_account_state).
// TODO(mail-service): the Drizzle implementation (JpaMailLedger): record()
// commits on its own, whatever the caller's transaction does next.

import type { Micros } from '../../../lib/time';

/**
 * SENT: accepted by the provider. REJECTED: this recipient/message was refused
 * (counted: it reached Gmail). QUOTA: the provider's own daily-limit error (not
 * counted). TRANSIENT: transport problem (not counted).
 */
export type MailOutcome = 'SENT' | 'REJECTED' | 'QUOTA' | 'TRANSIENT';

/** Outcome.db() */
export const mailOutcomeDb = (o: MailOutcome): string => o.toLowerCase();

export interface MailUsage { at: Micros; recipients: number }

export interface MailAccountState {
  pausedUntil: Micros | null;
  pauseReason: string | null;
  consecutiveFailures: number;
}

export const CLEAR: MailAccountState = Object.freeze({ pausedUntil: null, pauseReason: null, consecutiveFailures: 0 });

export const isClear = (s: MailAccountState): boolean =>
  s.pausedUntil == null && s.pauseReason == null && s.consecutiveFailures === 0;

export interface MailLedger {
  /** Recipients of the counted attempts (SENT, REJECTED) after `since`. */
  usedSince(account: string, since: Micros): Promise<number>;
  /** The counted attempts after `since`, oldest first. */
  usageSince(account: string, since: Micros): Promise<MailUsage[]>;
  record(account: string, kind: string, recipients: number, outcome: MailOutcome, error: string | null, at: Micros): Promise<void>;
  state(account: string): Promise<MailAccountState | null>;
  saveState(account: string, state: MailAccountState, now: Micros): Promise<void>;
}
