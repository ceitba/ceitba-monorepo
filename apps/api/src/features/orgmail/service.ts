// service/orgmail/OrgAnnouncementService + OrgMailUnsubscribeTokens +
// OrgMailException: organizations' emails to their followers
// (docs/ORGANIZATIONS.md). An org sends at most org-mail.weekly-limit
// announcements per rolling 7 days; the worker is sender.ts.

import { timingSafeEqual } from 'node:crypto';
import type { Deps } from '../../deps';
import { withTx } from '../../db/client';
import { CodedError, ResourceNotFoundError, ValidationError } from '../../http/errors';
import { EmailSendError, type OutgoingEmail } from '../../infra/mail';
import { CANONICAL_UUID, JavaIllegalArgument, javaBase64Decode, javaStrip, javaUrlEncode, base64UrlEncode } from '../../lib/javaCompat';
import { formatInstant, formatOffsetDateTime, parsePgTimestamp, systemNowMicros } from '../../lib/time';
import { ORG_MAIL_UNSUBSCRIBE, type ContentHmac } from '../crypto/logic/contentHmac';
import { contentHmac } from '../crypto/service';
import { KIND_ORG, KIND_TEST, MailQuotaExhausted, MailSenderNotConnected, type MailSendService } from '../mail/logic/mailSendService';
import { mailBeans, type AccountView, type MailBeans } from '../mail/service';
import { isAllowedRecipient } from '../mail/settings';
import { listIdPhrase } from './logic/orgAnnouncementListId';
import { renderOrgAnnouncement } from './logic/orgAnnouncementRenderer';
import * as repo from './repo';

export const MAX_SUBJECT = 150;
export const MAX_BODY = 20_000;
const WEEK_MS = 7 * 86_400_000;

export const ORG_MAIL_REASONS = {
  NOT_CONNECTED: ['OrgMailNotConnected', 'The organization has no connected Gmail account'],
  MAIL_DISABLED: ['MailDisabled', 'Sending email is disabled on this server'],
  WEEKLY_LIMIT: ['OrgMailWeeklyLimit', 'The organization already sent its emails for this week'],
  NO_RECIPIENTS: ['OrgMailNoRecipients', 'No follower can receive this email'],
  NOT_DRAFT: ['OrgMailNotDraft', 'Only drafts can be changed or sent'],
  TEST_FAILED: ['OrgMailTestFailed', 'The test email could not be sent'],
} as const;

/** OrgMailException -> 409 with the reason's code. */
export class OrgMailError extends CodedError {
  constructor(readonly reason: keyof typeof ORG_MAIL_REASONS, message?: string) {
    super(409, ORG_MAIL_REASONS[reason][0], message ?? ORG_MAIL_REASONS[reason][1]);
  }
}

// ------------------------------------------------------------ tokens

const MESSAGE_PREFIX = 'org-mail-unsubscribe:v1:';
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export class OrgMailUnsubscribeTokens {
  constructor(private readonly hmac: ContentHmac) {}

  issue(userId: string, orgSlug: string): string {
    return `${userId}.${orgSlug}.${base64UrlEncode(this.mac(userId, orgSlug))}`;
  }

  verify(token: string | null): { userId: string; orgSlug: string } | null {
    if (token == null) return null;
    const parts = token.split('.');
    if (parts.length !== 3 || !SLUG.test(parts[1]!)) return null;
    let given: Uint8Array;
    try {
      given = javaBase64Decode(parts[2]!, true);
    } catch (e) {
      if (e instanceof JavaIllegalArgument) return null;
      throw e;
    }
    if (!CANONICAL_UUID.test(parts[0]!)) return null;
    const mac = this.mac(parts[0]!, parts[1]!);
    return mac.length === given.length && timingSafeEqual(mac, given) ? { userId: parts[0]!, orgSlug: parts[1]! } : null;
  }

  private mac(userId: string, orgSlug: string): Uint8Array {
    return this.hmac.sign(ORG_MAIL_UNSUBSCRIBE, `${MESSAGE_PREFIX}${userId}:${orgSlug}`);
  }
}

// ------------------------------------------------------------ views

export interface AnnouncementView {
  id: number; subject: string; body: string; status: string; recipientCount: number | null; sent: number; failed: number;
  pending: number; createdAt: string; sentAt: string | null; finishedAt: string | null;
}

const fromDb = (pg: string | null) => (pg == null ? null : formatOffsetDateTime(parsePgTimestamp(pg)));

function view(a: repo.AnnouncementRow, c: Map<string, number>, inMemory: { sentAt?: string } = {}): AnnouncementView {
  return {
    id: a.id, subject: a.subject, body: a.body, status: a.status, recipientCount: a.recipientCount,
    sent: c.get('sent') ?? 0, failed: c.get('failed') ?? 0, pending: (c.get('pending') ?? 0) + (c.get('sending') ?? 0),
    createdAt: fromDb(a.createdAt)!, sentAt: inMemory.sentAt ?? fromDb(a.sentAt), finishedAt: fromDb(a.finishedAt),
  };
}

function validSubject(s: string | null | undefined): string {
  const v = s == null ? '' : javaStrip(s);
  if (v.length === 0 || v.length > MAX_SUBJECT || v.includes('\n') || v.includes('\r')) {
    throw new ValidationError('subject', s, `must be one line of 1-${MAX_SUBJECT} characters`);
  }
  return v;
}

function validBody(s: string | null | undefined): string {
  const v = s == null ? '' : javaStrip(s);
  if (v.length === 0 || v.length > MAX_BODY) throw new ValidationError('body', null, `must be 1-${MAX_BODY} characters`);
  return v;
}

const notFound = (id: number) => new ResourceNotFoundError('OrgAnnouncement', String(id));

export class OrgAnnouncementService {
  readonly tokens: OrgMailUnsubscribeTokens;
  private readonly mail: MailBeans;

  constructor(private readonly deps: Deps, private readonly onSendRequested: () => void = () => {}) {
    this.mail = mailBeans(deps);
    this.tokens = new OrgMailUnsubscribeTokens(contentHmac(deps.config));
  }

  async status(org: string) {
    return withTx(this.deps.db, async (tx) => {
      const o = await this.requireOrg(tx, org);
      const account = await this.mail.accounts.orgAccount(org);
      const sender = account == null ? null : this.mail.orgSenders.forAccount(account.email, o.name);
      const q = sender == null ? null : await sender.status();
      const ins = (us: number | null) => (us == null ? null : formatInstant(us));
      return {
        account, mailEnabled: sender == null || sender.enabled(),
        quota: q == null ? null : { account: q.account, limit: q.limit, usedLast24h: q.usedLast24h, remaining: q.remaining,
          pausedUntil: ins(q.pausedUntil), pauseReason: q.pauseReason, nextCapacityAt: ins(q.nextCapacityAt) },
        weeklyLimit: this.mail.settings.orgMail.weeklyLimit, sentThisWeek: await this.sentThisWeek(tx, org),
        recipientEstimate: await repo.countRecipients(tx, org, this.mail.settings.digest.allowedDomains),
        allowedDomain: this.mail.settings.orgMail.allowedDomain,
      };
    }, { readOnly: true });
  }

  list(org: string): Promise<AnnouncementView[]> {
    return withTx(this.deps.db, async (tx) => {
      await this.requireOrg(tx, org);
      const list = await repo.findTop50ByOrg(tx, org);
      const counts = new Map<number, Map<string, number>>();
      for (const r of await repo.countByAnnouncementAndStatus(tx, list.map((a) => a.id))) {
        let m = counts.get(r.id);
        if (!m) counts.set(r.id, (m = new Map()));
        m.set(r.status, r.n);
      }
      return list.map((a) => view(a, counts.get(a.id) ?? new Map()));
    }, { readOnly: true });
  }

  create(org: string, subject: string | null, body: string | null, by: string): Promise<AnnouncementView> {
    return withTx(this.deps.db, async (tx) => {
      await this.requireOrg(tx, org);
      const s = validSubject(subject);
      const b = validBody(body);
      const now = systemNowMicros();
      const a = await repo.insertAnnouncement(tx, org, s, b, by, now);
      // @CreationTimestamp in memory: the JVM zone.
      return { ...view(a, new Map()), createdAt: formatOffsetDateTime(now, this.deps.config.server.timeZone) };
    });
  }

  update(org: string, id: number, subject: string | null, body: string | null): Promise<AnnouncementView> {
    return withTx(this.deps.db, async (tx) => {
      const a = await repo.findByIdAndOrg(tx, id, org, true);
      if (a == null) throw notFound(id);
      if (a.status !== 'draft') throw new OrgMailError('NOT_DRAFT');
      if (subject != null) a.subject = validSubject(subject);
      if (body != null) a.body = validBody(body);
      await repo.updateAnnouncement(tx, a);
      return view(a, new Map());
    });
  }

  delete(org: string, id: number): Promise<void> {
    return withTx(this.deps.db, async (tx) => {
      const a = await repo.findByIdAndOrg(tx, id, org, true);
      if (a == null) throw notFound(id);
      if (a.status !== 'draft') throw new OrgMailError('NOT_DRAFT');
      await repo.deleteAnnouncement(tx, id);
    });
  }

  /** The draft to the admin who asks ("[Prueba]"); synchronous; counts toward the account's quota. */
  async sendTest(org: string, id: number, to: { id: string; email: string }): Promise<void> {
    const { o, a } = await withTx(this.deps.db, async (tx) => {
      const o = await this.requireOrg(tx, org);
      const a = await repo.findByIdAndOrg(tx, id, org);
      if (a == null) throw notFound(id);
      return { o, a };
    }, { readOnly: true });
    const sender = await this.senderFor(o);
    const email = this.email(o, a, to.id, to.email, true);
    try {
      await sender.send(email);
    } catch (e) {
      if (e instanceof MailQuotaExhausted || e instanceof MailSenderNotConnected) throw e;
      if (e instanceof EmailSendError) throw new OrgMailError('TEST_FAILED', `The test email failed: ${e.message}`);
      throw e;
    }
  }

  /** draft -> sending, with the recipients snapshot. */
  async send(org: string, id: number): Promise<AnnouncementView> {
    const v = await withTx(this.deps.db, async (tx) => {
      // The org's row lock serializes its sends (weekly cap).
      const o = await repo.findOrg(tx, org, true);
      if (o == null) throw new ResourceNotFoundError('Organization', org);
      const a = await repo.findByIdAndOrg(tx, id, org, true);
      if (a == null) throw notFound(id);
      if (a.status !== 'draft') throw new OrgMailError('NOT_DRAFT');
      const sender = await this.senderFor(o);
      if ((await this.sentThisWeek(tx, org)) >= this.mail.settings.orgMail.weeklyLimit) throw new OrgMailError('WEEKLY_LIMIT');
      const recipients = (await repo.findRecipients(tx, org)).filter((r) => isAllowedRecipient(this.mail.settings, r.email))
        .map((r) => ({ userId: r.id, email: r.email }));
      if (recipients.length === 0) throw new OrgMailError('NO_RECIPIENTS');
      await repo.insertDeliveries(tx, a.id, recipients);
      const now = this.deps.clock.now();
      a.status = 'sending';
      a.senderEmail = sender.account;
      a.recipientCount = recipients.length;
      a.sentAt = formatOffsetDateTime(now, 'UTC');
      await repo.updateAnnouncement(tx, a);
      return view(a, new Map([['pending', recipients.length]]), { sentAt: formatOffsetDateTime(now, this.deps.clock.zone) });
    });
    this.onSendRequested();
    return v;
  }

  // ---- worker side

  /** The sender of an announcement's org: its account now (null while it has none). */
  async senderOf(a: repo.AnnouncementRow): Promise<MailSendService | null> {
    const o = await withTx(this.deps.db, (tx) => repo.findOrg(tx, a.orgSlug), { readOnly: true });
    if (o == null) return null;
    const account = await this.mail.accounts.orgAccount(o.slug);
    return account == null ? null : this.mail.orgSenders.forAccount(account.email, o.name);
  }

  async stillRecipient(db: import('../../db/client').Db, userId: string, email: string, org: string): Promise<boolean> {
    return isAllowedRecipient(this.mail.settings, email) && repo.isStillRecipient(db, userId, org);
  }

  email(o: repo.OrgRow, a: repo.AnnouncementRow, userId: string, to: string, test: boolean): OutgoingEmail {
    const d = this.mail.settings.digest;
    const token = this.tokens.issue(userId, o.slug);
    const unsubscribePage = `${d.publicBaseUrl}/unsubscribe?kind=org&token=${javaUrlEncode(token)}`;
    const portal = `${d.publicBaseUrl}/organizations/${o.slug}`;
    const out = renderOrgAnnouncement(o.name, o.color, a.body, unsubscribePage, portal);
    const headers: Record<string, string> = {
      'List-Unsubscribe': `<${d.apiBaseUrl}/v1/org-mail/unsubscribe?token=${javaUrlEncode(token)}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      'List-Id': `${listIdPhrase(o.name, o.slug)} <${o.slug}.orgs.ceitba.org.ar>`,
    };
    if (o.contactEmail != null) headers['Reply-To'] = o.contactEmail;
    if (!test) headers.Precedence = 'bulk';
    return { to, subject: test ? `[Prueba] ${a.subject}` : a.subject, html: out.html, text: out.text, headers, kind: test ? KIND_TEST : KIND_ORG };
  }

  // ---- opt-outs

  unsubscribe(token: string | null): Promise<string> {
    return withTx(this.deps.db, async (tx) => {
      const subject = this.tokens.verify(token);
      if (subject == null) throw new ValidationError('token', null, 'is not a valid unsubscribe token');
      const o = await repo.findOrg(tx, subject.orgSlug);
      if (o == null) throw new ResourceNotFoundError('Organization', subject.orgSlug);
      if (await repo.userExists(tx, subject.userId)) await repo.insertOptoutIfAbsent(tx, subject.userId, subject.orgSlug, systemNowMicros());
      return o.name;
    });
  }

  receivesMail(userId: string, org: string): Promise<boolean> {
    return withTx(this.deps.db, async (tx) => !(await repo.optoutExists(tx, userId, org)), { readOnly: true });
  }

  setReceivesMail(userId: string, org: string, enabled: boolean): Promise<void> {
    return withTx(this.deps.db, async (tx) => {
      await this.requireOrg(tx, org);
      if (enabled) await repo.deleteOptout(tx, userId, org);
      else await repo.insertOptoutIfAbsent(tx, userId, org, systemNowMicros());
    });
  }

  // ---- helpers

  private async senderFor(o: repo.OrgRow): Promise<MailSendService> {
    const account: AccountView | null = await this.mail.accounts.orgAccount(o.slug);
    if (account == null || account.status !== 'connected') throw new OrgMailError('NOT_CONNECTED');
    const sender = this.mail.orgSenders.forAccount(account.email, o.name);
    if (!sender.enabled()) throw new OrgMailError('MAIL_DISABLED');
    return sender;
  }

  private sentThisWeek(db: import('../../db/client').Db, org: string): Promise<number> {
    return repo.countSentSince(db, org, this.deps.clock.now() - WEEK_MS * 1000);
  }

  private async requireOrg(db: import('../../db/client').Db, org: string): Promise<repo.OrgRow> {
    const o = await repo.findOrg(db, org);
    if (o == null) throw new ResourceNotFoundError('Organization', org);
    return o;
  }
}
