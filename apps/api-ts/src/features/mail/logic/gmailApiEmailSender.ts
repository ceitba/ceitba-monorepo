// Port of apps/api/src/main/java/org/ceitba/api/service/mail/GmailApiEmailSender.java.
//
// Gmail API transport (users.messages.send over HTTPS) with the refresh token
// of the connected sender account: no app password, no SMTP. The message is a
// multipart RFC 822 one sent as base64url `raw`.
//
// Errors (classify), onto EmailSendError kinds:
//   daily limit (reason dailyLimitExceeded, or a RESOURCE_EXHAUSTED / 429 whose
//     message says "daily")                              = QUOTA (24h pause)
//   rateLimitExceeded / userRateLimitExceeded / plain 429 = TRANSPORT with a
//     short backoff (Retry-After, else 30 s)
//   401, non-quota 403, invalid_grant                     = TRANSPORT, account marked broken
//   5xx, network errors, anything unexpected              = TRANSPORT
//   400 invalid recipient/address                         = RECIPIENT
//   other per-message 4xx                                 = TRANSIENT

import nodemailer from 'nodemailer';
import { EmailSendError, type EmailSender, type OutgoingEmail } from '../../../infra/mail';
import { base64UrlEncode, javaIsBlank, javaParseLong, javaTrim } from '../../../lib/javaCompat';
import type { MailAccessTokenCache } from './mailAccessTokenCache';
import { MailSenderNotConnected } from './mailSendService';
import { GoogleOAuthError, type MailCredentials } from './types';

export const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const RATE_REASONS = new Set(['ratelimitexceeded', 'userratelimitexceeded']);
export const DEFAULT_RATE_BACKOFF_MS = 30_000;
const MAX_RETRY_AFTER_MS = 10 * 60_000;

export interface Classified { exception: EmailSendError; authProblem: boolean }

/** What GmailApiEmailSender needs from MailSenderAccountService (repository code, not ported here). */
export interface MailSenderAccounts {
  credentialsFor(senderEmail: string): Promise<MailCredentials | null>;
  unavailableReason(senderEmail: string): Promise<string | null>;
  markBroken(c: MailCredentials, error: string): Promise<void>;
  markUsed(c: MailCredentials): Promise<void>;
}

/** The HTTP POST (fetch in production; a fake in tests). */
export type GmailHttp = (url: string, accessToken: string, body: string) =>
  Promise<{ status: number; body: string; retryAfter: string | null }>;

const defaultHttp: GmailHttp = async (url, accessToken, body) => {
  // SimpleClientHttpRequestFactory: connect 5 s, read 20 s.
  const res = await fetch(url, {
    method: 'POST', body, signal: AbortSignal.timeout(25_000),
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
  });
  return { status: res.status, body: await res.text(), retryAfter: res.headers.get('Retry-After') };
};

/** "CEITBA <ceitba@itba.edu.ar>" -> the address (InternetAddress.getAddress). */
export function addressOf(from: string): string {
  const m = /<([^<>]+)>\s*$/.exec(from);
  return javaTrim(m ? m[1]! : from);
}

export class GmailApiEmailSender implements EmailSender {
  private readonly fromAddress: string;

  constructor(private readonly accounts: MailSenderAccounts | null, private readonly tokens: MailAccessTokenCache | null,
              private readonly from: string, private readonly http: GmailHttp = defaultHttp, private readonly sendUrl = SEND_URL) {
    // TODO(mail-service): InternetAddress(from, strict=true) validation at startup.
    this.fromAddress = addressOf(from);
  }

  enabled(): boolean {
    return true;
  }

  unavailableReason(): Promise<string | null> {
    return this.accounts!.unavailableReason(this.fromAddress);
  }

  async send(email: OutgoingEmail): Promise<void> {
    const creds = await this.accounts!.credentialsFor(this.fromAddress);
    if (creds == null) {
      throw new MailSenderNotConnected((await this.unavailableReason())
        ?? `No usable Gmail sender account for ${this.fromAddress} (connect it from the digests admin page)`);
    }
    const body = `{"raw":"${await this.raw(email)}"}`;
    // One retry on 401: the cached access token may have been revoked early.
    for (let attempt = 0; ; attempt++) {
      const access = await this.accessToken(creds);
      let res: { status: number; body: string; retryAfter: string | null };
      try {
        res = await this.http(this.sendUrl, access, body);
      } catch (e) {
        throw new EmailSendError('TRANSPORT', `Gmail API unreachable: ${(e as Error)?.name ?? 'Error'}`, e);
      }
      if (res.status >= 200 && res.status < 300) {
        await this.accounts!.markUsed(creds);
        return;
      }
      const c = classify(res.status, res.body, res.retryAfter);
      if (res.status === 401 && attempt === 0) {
        this.tokens!.invalidate(creds);
        continue;
      }
      if (c.authProblem) await this.accounts!.markBroken(creds, c.exception.message);
      throw c.exception;
    }
  }

  private async accessToken(creds: MailCredentials): Promise<string> {
    try {
      return await this.tokens!.get(creds);
    } catch (e) {
      if (!(e instanceof GoogleOAuthError)) throw e;
      if (e.kind === 'INVALID_GRANT') {
        await this.accounts!.markBroken(creds, 'Google rejected the stored token (invalid_grant): reconnect the account');
        throw new EmailSendError('TRANSPORT',
          'Gmail authorization was revoked or expired (invalid_grant); reconnect the sender account', e);
      }
      throw new EmailSendError('TRANSPORT', `Could not get a Gmail access token: ${e.message}`, e);
    }
  }

  // ------------------------------------------------------------- MIME

  /** base64url (no padding) of the RFC 822 message. */
  async raw(email: OutgoingEmail): Promise<string> {
    try {
      return base64UrlEncode(await this.mime(email));
    } catch (e) {
      throw new EmailSendError('RECIPIENT', `Could not build the message: ${(e as Error).message}`, e);
    }
  }

  /**
   * The RFC 822 message: From, To, UTF-8 Subject, Date, Message-ID
   * <uuid@from-domain>, the extra headers, text + html alternatives. Built by
   * nodemailer (multipart/alternative) where Spring's MimeMessageHelper
   * (multipart=true) nests mixed > related > alternative: same parts and
   * headers, shallower tree.
   */
  async mime(email: OutgoingEmail): Promise<Uint8Array> {
    const domain = this.fromAddress.slice(this.fromAddress.indexOf('@') + 1);
    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' });
    const info = await transport.sendMail({
      from: this.from, to: email.to, subject: email.subject, text: email.text, html: email.html,
      date: new Date(), messageId: `<${crypto.randomUUID()}@${domain}>`, headers: email.headers ?? {},
    });
    return new Uint8Array(info.message as Buffer);
  }
}

// ------------------------------------------------------ error mapping

export function classify(status: number, body: string | null, retryAfterHeader: string | null = null,
                         nowMs: number = Date.now()): Classified {
  const rs = reasons(body);
  const lower = rs.map((r) => r.toLowerCase());
  const message = messageOf(body).toLowerCase();
  const detail = `Gmail API HTTP ${status}${rs.length === 0 ? '' : ` ${rs.join(',')}`}`;

  // List.contains: element equality; message.contains: substring.
  const daily = lower.includes('dailylimitexceeded')
    || ((lower.includes('resource_exhausted') || status === 429) && message.includes('daily'));
  if (daily) return { exception: new EmailSendError('QUOTA', detail), authProblem: false };

  const rate = status === 429 || lower.some((r) => RATE_REASONS.has(r)) || lower.includes('resource_exhausted');
  if (rate) {
    const wait = retryAfterMs(retryAfterHeader, nowMs);
    return {
      exception: new EmailSendError('TRANSPORT', `${detail} (throttled, short backoff)`, undefined, wait ?? DEFAULT_RATE_BACKOFF_MS),
      authProblem: false,
    };
  }
  if (status === 401 || status === 403) {
    return { exception: new EmailSendError('TRANSPORT', `${detail} (authorization problem)`), authProblem: true };
  }
  if (status >= 500 || status < 400) return { exception: new EmailSendError('TRANSPORT', detail), authProblem: false };
  if (status === 400 && (message.includes('recipient') || message.includes('invalid to') || message.includes('invalid cc')
      || message.includes('invalid bcc') || message.includes('address'))) {
    return { exception: new EmailSendError('RECIPIENT', detail), authProblem: false };
  }
  // Any other per-message 4xx: never drop a delivery on an error we do not understand, never pause the account.
  return { exception: new EmailSendError('TRANSIENT', detail), authProblem: false };
}

/** Retry-After: delay-seconds or an RFC 1123 date; null when absent/unusable. Clamped to [1 s, 10 min]. */
export function retryAfterMs(header: string | null | undefined, nowMs: number = Date.now()): number | null {
  if (header == null || javaIsBlank(header)) return null;
  const h = javaTrim(header);
  let secs: number | null = null;
  try {
    secs = javaParseLong(h);
  } catch {
    secs = null;
  }
  if (secs != null) return clamp(secs * 1000);
  const at = parseRfc1123(h);
  return at == null ? null : clamp(at - nowMs);
}

function clamp(ms: number): number {
  if (ms < 1000) return 1000;
  return ms > MAX_RETRY_AFTER_MS ? MAX_RETRY_AFTER_MS : ms;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** DateTimeFormatter.RFC_1123_DATE_TIME (the subset Retry-After uses): "[Tue, ]3 Jun 2008 11:05:30 GMT|+hhmm". */
function parseRfc1123(s: string): number | null {
  const m = /^(?:([A-Z][a-z]{2}), )?(\d{1,2}) ([A-Z][a-z]{2}) (\d{4}) (\d{2}):(\d{2})(?::(\d{2}))? (GMT|[+-]\d{4})$/.exec(s);
  if (!m) return null;
  if (m[1] && !DAYS.includes(m[1])) return null;
  const mon = MONTHS.indexOf(m[3]!);
  if (mon < 0) return null;
  let t = Date.UTC(Number(m[4]), mon, Number(m[2]), Number(m[5]), Number(m[6]), Number(m[7] ?? 0));
  if (m[8] !== 'GMT') {
    const sign = m[8]![0] === '-' ? -1 : 1;
    t -= sign * (Number(m[8]!.slice(1, 3)) * 60 + Number(m[8]!.slice(3))) * 60_000;
  }
  return t;
}

function readJson(body: string | null): unknown {
  // Jackson readTree("") is a MissingNode; invalid JSON throws (caught by the callers).
  if (body == null || body.trim() === '') return undefined;
  return JSON.parse(body);
}

const field = (node: unknown, name: string): unknown =>
  node != null && typeof node === 'object' && !Array.isArray(node) ? (node as Record<string, unknown>)[name] : undefined;

/** JsonNode.asText() of a value node. */
function asText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

/** error.message ("" when absent or not JSON). */
function messageOf(body: string | null): string {
  try {
    const v = field(field(readJson(body), 'error'), 'message');
    return v === undefined || v === null ? '' : asText(v);
  } catch {
    return '';
  }
}

/** error.errors[].reason and error.status of Google's error body. */
function reasons(body: string | null): string[] {
  const out: string[] = [];
  try {
    const err = field(readJson(body), 'error');
    const errors = field(err, 'errors');
    // Iterating a JsonNode: an array's elements or an object's values.
    const items = Array.isArray(errors) ? errors : errors != null && typeof errors === 'object' ? Object.values(errors) : [];
    {
      for (const e of items) {
        const r = field(e, 'reason');
        if (r !== undefined && r !== null) out.push(asText(r));
      }
    }
    const st = field(err, 'status');
    if (st !== undefined && st !== null) out.push(asText(st));
  } catch {
    // not JSON: the HTTP status decides
  }
  return out;
}
