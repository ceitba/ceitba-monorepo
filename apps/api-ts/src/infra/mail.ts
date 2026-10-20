// Mail transport (service/mail/EmailSender + Disabled/Logging/Smtp senders,
// config/MailConfig selection). Selection:
//   MAIL_ENABLED=false: MAIL_LOG_SENDS=true -> LoggingEmailSender, else DisabledEmailSender
//   MAIL_ENABLED=true:  MAIL_TRANSPORT=smtp -> SmtpEmailSender (nodemailer, spring.mail.*)
//                       MAIL_TRANSPORT=log  -> LoggingEmailSender (startup fails unless MAIL_LOG_SENDS=true)
//                       MAIL_TRANSPORT=gmail-api (default) -> GmailApiEmailSender
//
// NOT PORTED YET (mail feature agent): GmailApiEmailSender + GoogleMailOAuthClient +
// MailTokenCipher + MailAccessTokenCache, and MailSendService (the quota ledger
// that MUST wrap every transport: in Java the transport is never a bean so
// nobody bypasses the quota; keep that rule). Until then gmail-api resolves to
// UnavailableEmailSender with a reason. SMTP failures are classified with
// SmtpEmailSender.classify's port (src/features/mail/logic/smtpReplyClassification.ts).

import nodemailer from 'nodemailer';
import { classifySmtpFailure, smtpFailureOfNodemailer } from '../features/mail/logic/smtpReplyClassification';
import type { Config } from '../config';
import type { Logger } from './logger';

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
  /** mail_send_log kind: digest | test | org | other. */
  kind?: string;
}

export type EmailSendKind = 'RECIPIENT' | 'TRANSIENT' | 'TRANSPORT' | 'QUOTA';

/** EmailSendException: kind tells the caller whether to skip, retry or stop. */
export class EmailSendError extends Error {
  constructor(readonly kind: EmailSendKind, message: string, override readonly cause?: unknown, readonly retryAfterMs?: number) {
    super(message);
  }
}

export interface EmailSender {
  send(email: OutgoingEmail): Promise<void>;
  /** False when nothing can really be sent (MAIL_ENABLED=false). */
  enabled(): boolean;
  /** Why the transport cannot send right now regardless of the recipient, or null. */
  unavailableReason(): Promise<string | null>;
}

/** "alice@itba.edu.ar" -> "a***@itba.edu.ar" (LoggingEmailSender.mask). */
export function maskAddress(address: string | null | undefined): string {
  if (address == null) return '(none)';
  const at = address.lastIndexOf('@');
  if (at <= 0) return '***';
  return `${address[0]}***${address.slice(at)}`;
}

export class DisabledEmailSender implements EmailSender {
  async send(): Promise<void> { throw new Error('Mail is disabled (MAIL_ENABLED=false)'); }
  enabled() { return false; }
  async unavailableReason() { return null; }
}

export class LoggingEmailSender implements EmailSender {
  constructor(private readonly log: Logger) {}
  async send(e: OutgoingEmail) {
    this.log.info(`Mail log-only (MAIL_LOG_SENDS=true); not sending "${e.subject}" to ${maskAddress(e.to)}`);
  }
  enabled() { return true; }
  async unavailableReason() { return null; }
}

export class UnavailableEmailSender implements EmailSender {
  constructor(private readonly reason: string) {}
  async send(): Promise<void> { throw new EmailSendError('TRANSPORT', this.reason); }
  enabled() { return true; }
  async unavailableReason() { return this.reason; }
}

/** In-memory transport for tests: records every email. */
export class InMemoryEmailSender implements EmailSender {
  readonly sent: OutgoingEmail[] = [];
  failWith: EmailSendError | null = null;
  async send(e: OutgoingEmail) {
    if (this.failWith) throw this.failWith;
    this.sent.push(e);
  }
  enabled() { return true; }
  async unavailableReason() { return null; }
}

/** SMTP through nodemailer with spring.mail.* (STARTTLS required, auth). */
export class SmtpEmailSender implements EmailSender {
  private readonly transporter;
  constructor(private readonly cfg: Config['content']['mail']) {
    this.transporter = nodemailer.createTransport({
      host: cfg.smtp.host,
      port: cfg.smtp.port,
      secure: false,
      requireTLS: true,
      auth: cfg.smtp.username ? { user: cfg.smtp.username, pass: cfg.smtp.password } : undefined,
      connectionTimeout: cfg.smtp.connectionTimeoutMs,
      socketTimeout: cfg.smtp.timeoutMs,
      greetingTimeout: cfg.smtp.timeoutMs,
    });
  }
  enabled() { return true; }
  async unavailableReason() { return null; }
  async send(e: OutgoingEmail) {
    try {
      await this.transporter.sendMail({ from: this.cfg.from, to: e.to, subject: e.subject, text: e.text, html: e.html, headers: e.headers });
    } catch (err) {
      throw classifySmtpFailure(smtpFailureOfNodemailer(err));
    }
  }
}

/** The raw transport selected from config. Wrap it in the mail feature's quota service before use. */
export function createMailTransport(config: Config, log: Logger): EmailSender {
  const m = config.content.mail;
  if (!m.enabled) return m.logSends ? new LoggingEmailSender(log) : new DisabledEmailSender();
  if (m.transport === 'log') {
    if (!m.logSends) throw new Error('MAIL_TRANSPORT=log requires MAIL_LOG_SENDS=true');
    return new LoggingEmailSender(log);
  }
  if (m.transport === 'smtp') return new SmtpEmailSender(m);
  return new UnavailableEmailSender('Gmail API transport is not ported yet (MAIL_TRANSPORT=gmail-api)');
}
