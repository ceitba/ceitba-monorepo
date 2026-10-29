// Mail transport (service/mail/EmailSender + Disabled/Logging/Smtp senders,
// config/MailConfig selection). Selection:
//   MAIL_ENABLED=false: MAIL_LOG_SENDS=true -> LoggingEmailSender, else DisabledEmailSender
//   MAIL_ENABLED=true:  MAIL_TRANSPORT=smtp -> SmtpEmailSender (nodemailer, spring.mail.*)
//                       MAIL_TRANSPORT=log  -> LoggingEmailSender (startup fails unless MAIL_LOG_SENDS=true)
//                       MAIL_TRANSPORT=gmail-api (default) -> GmailApiTransportSlot: the mail
//                         feature builds GmailApiEmailSender there (it needs the connected sender
//                         account and the OAuth client, which are mail beans)
// Startup fails like MailConfig: MAIL_TRANSPORT not gmail-api/smtp/log, MAIL_FROM not a
// valid address (EmailProperties.account()), smtp without MAIL_HOST or with a blank
// MAIL_USERNAME/MAIL_PASSWORD, log without MAIL_LOG_SENDS.
//
// The mail feature's MailSendService (the quota ledger) wraps every transport: in
// Java the transport is never a bean so nobody bypasses the quota; keep that rule.
// SMTP failures are classified with SmtpEmailSender.classify's port
// (src/features/mail/logic/smtpReplyClassification.ts).

import nodemailer from 'nodemailer';
import { AddressError, parseStrictAddress } from '../features/mail/logic/internetAddress';
import { classifySmtpFailure, smtpFailureOfNodemailer } from '../features/mail/logic/smtpReplyClassification';
import { mailSettings, TRANSPORT_GMAIL_API, TRANSPORT_LOG, TRANSPORT_SMTP } from '../features/mail/settings';
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

/**
 * MAIL_ENABLED=true + MAIL_TRANSPORT=gmail-api: the slot the mail feature fills
 * with its GmailApiEmailSender (mailBeans). Used directly it refuses to send.
 */
export class GmailApiTransportSlot extends UnavailableEmailSender {
  constructor(readonly from: string) {
    super('Gmail API transport is provided by the mail feature (mailBeans)');
  }
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
  private readonly fromDomain: string;
  constructor(cfg: Config["content"]["mail"], private readonly from: string) {
    const address = parseStrictAddress(from);
    this.fromDomain = address.slice(address.lastIndexOf('@') + 1);
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
      parseStrictAddress(e.to); // helper.setTo(new InternetAddress(to, true))
    } catch (err) {
      throw new EmailSendError('RECIPIENT', `Could not build the message: ${(err as Error).message}`, err);
    }
    try {
      await this.transporter.sendMail({
        from: this.from, to: e.to, subject: e.subject, text: e.text, html: e.html, headers: e.headers,
        // An explicit id in the sending domain (JavaMail always writes one; never rely on the library's default).
        messageId: `<${crypto.randomUUID()}@${this.fromDomain}>`,
      });
    } catch (err) {
      throw classifySmtpFailure(smtpFailureOfNodemailer(err));
    }
  }
}

const isBlank = (s: string | null | undefined) => s == null || s.trim() === '';

/** The raw transport selected from config (MailConfig.transport). Wrap it in the mail feature's quota service before use. */
export function createMailTransport(config: Config, log: Logger): EmailSender {
  const s = mailSettings(config).email; // MAIL_TRANSPORT check (EmailProperties)
  try {
    parseStrictAddress(s.from); // EmailProperties.account(), called by the emailSender bean
  } catch (e) {
    if (e instanceof AddressError) throw new Error(`mail.from (MAIL_FROM) is not a valid address: ${s.from}`);
    throw e;
  }
  if (!s.enabled) {
    if (s.logSends) {
      log.warn('Mail: DEV log-only mode (MAIL_LOG_SENDS=true); emails are logged, never sent');
      return new LoggingEmailSender(log);
    }
    log.info('Mail: disabled (MAIL_ENABLED=false); sending is refused');
    return new DisabledEmailSender();
  }
  if (s.transport === TRANSPORT_LOG) {
    if (!s.logSends) throw new Error('MAIL_TRANSPORT=log is dev-only and needs MAIL_LOG_SENDS=true');
    log.warn('Mail: MAIL_TRANSPORT=log; emails are only logged, never sent');
    return new LoggingEmailSender(log);
  }
  if (s.transport === TRANSPORT_GMAIL_API) return new GmailApiTransportSlot(s.from);
  if (s.transport !== TRANSPORT_SMTP) throw new Error(`MAIL_TRANSPORT must be gmail-api, smtp or log, not: ${s.transport}`);
  const smtp = config.content.mail.smtp;
  if (isBlank(smtp.host)) throw new Error('MAIL_ENABLED=true but spring.mail.host (MAIL_HOST) is not set');
  if (isBlank(smtp.username) || isBlank(smtp.password)) throw new Error('MAIL_ENABLED=true needs MAIL_USERNAME and MAIL_PASSWORD');
  log.info(`Mail: SMTP enabled, from ${s.from}`);
  return new SmtpEmailSender(config.content.mail, s.from);
}
