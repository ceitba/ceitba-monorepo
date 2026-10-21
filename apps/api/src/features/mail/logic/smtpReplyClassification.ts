// Port of the reply classification of apps/api/src/main/java/org/ceitba/api/service/mail/SmtpEmailSender.java
// (classifyReply + classify). NOTE: src/infra/mail.ts has its own
// classifySmtpReply that does NOT match Java (e.g. "550 5.7.1 message rejected"
// is RECIPIENT there, null in Java; 534/535 5.7.x vs 4.7.x; the wording
// fallbacks); the SMTP transport should use this one.

import type { EmailSendKind } from '../../../infra/mail';
import { EmailSendError } from '../../../infra/mail';

// "550 5.4.5 ...", "452 4.2.2 ...": the reply code and its enhanced status.
const REPLY = /\b([245]\d\d)[ -]([245])\.(\d{1,3})\.(\d{1,3})\b/;

/**
 * Who an SMTP reply blames, from its first "<code> <class.subject.detail>" pair
 * (null = no such pair, or a permanent reply that blames nobody in particular):
 *   QUOTA      5.4.5 / "sending limit exceeded"
 *   RECIPIENT  4.1.x, 4.2.x, 5.1.x, 5.2.x
 *   TRANSPORT  421, 4.7.x, 534/535 5.7.x, and the "limit exceeded" / "rate limit" / "try again later" wordings
 *   TRANSIENT  any other 4.x.x
 */
export function classifyReply(text: string): EmailSendKind | null {
  const t = text.toLowerCase();
  const m = REPLY.exec(t);
  if (m) {
    const code = Number(m[1]);
    const cls = Number(m[2]);
    const subject = Number(m[3]);
    const detail = Number(m[4]);
    if (cls === 5 && subject === 4 && detail === 5) return 'QUOTA';
    if (code === 421 || (cls === 5 && subject === 7 && (code === 534 || code === 535)) || (cls === 4 && subject === 7)) {
      return 'TRANSPORT';
    }
    if ((subject === 1 || subject === 2) && (cls === 4 || cls === 5)) return 'RECIPIENT';
    if (cls === 4) return 'TRANSIENT';
    // Other permanent replies: fall through to the wording check.
  }
  if (t.includes('sending limit exceeded')) return 'QUOTA';
  if (t.includes('limit exceeded') || t.includes('rate limit') || t.includes('try again later')) return 'TRANSPORT';
  return null;
}

/**
 * The Spring MailException a send failed with, reduced to what classify() reads:
 *   auth      MailAuthenticationException (nodemailer: code EAUTH)
 *   parse     MailParseException / MailPreparationException (nodemailer: EENVELOPE / EMESSAGE)
 *   send      MailSendException and the rest
 * `messages` are the messages of the exception, its causes and its failed messages, in order;
 * `invalidRecipients`: a SendFailedException with invalid addresses was among them (nodemailer: err.rejected non-empty).
 */
export interface SmtpFailure {
  type: 'auth' | 'parse' | 'send';
  message: string | null;
  messages: readonly (string | null)[];
  invalidRecipients: boolean;
  cause?: unknown;
}

/** SmtpEmailSender.classify(MailException). */
export function classifySmtpFailure(e: SmtpFailure): EmailSendError {
  if (e.type === 'auth') return new EmailSendError('TRANSPORT', 'SMTP authentication failed', e.cause);
  if (e.type === 'parse') return new EmailSendError('RECIPIENT', e.message ?? 'null', e.cause);
  let kind = classifyReply(` ${e.messages.filter((x) => x != null).map((x) => `${x} `).join('')}`);
  // No usable reply code: a rejected address still blames the recipient; the rest is the transport's.
  if (kind == null) kind = e.invalidRecipients ? 'RECIPIENT' : 'TRANSPORT';
  return new EmailSendError(kind, e.message ?? 'null', e.cause);
}

/**
 * A nodemailer error as an SmtpFailure (EAUTH -> auth, EENVELOPE/EMESSAGE -> parse,
 * `rejected` -> invalidRecipients, `message` + `response` -> messages); used by the
 * SMTP transport (src/infra/mail.ts).
 */
export function smtpFailureOfNodemailer(err: unknown): SmtpFailure {
  const e = (err ?? {}) as { code?: string; message?: string; response?: string; rejected?: unknown[] };
  const type = e.code === 'EAUTH' ? 'auth' : e.code === 'EENVELOPE' || e.code === 'EMESSAGE' ? 'parse' : 'send';
  return {
    type, message: e.message ?? null, messages: [e.message ?? null, e.response ?? null],
    invalidRecipients: Array.isArray(e.rejected) && e.rejected.length > 0, cause: err,
  };
}
