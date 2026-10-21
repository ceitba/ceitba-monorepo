// service/digest/DigestService: the staff-facing lifecycle of the weekly digest
// (create/edit/preview/test/send/cancel/delete), the scheduled draft and
// auto-send, and the per-user subscription. Sending itself: sender.ts.

import type { Deps } from '../../deps';
import { withTx, type Db, type Tx } from '../../db/client';
import { ExternalApiError, ResourceNotFoundError, ValidationError } from '../../http/errors';
import { EmailSendError } from '../../infra/mail';
import type { Logger } from '../../infra/logger';
import { dayOfWeek, javaIsBlank, javaStrip, plusDays, type LocalDate } from '../../lib/javaCompat';
import { ART, formatLocalDateTime, localDateOf, systemNowMicros, type Micros } from '../../lib/time';
import { withAmbientTx } from '../mail/ambient';
import { MailQuotaExhausted, MailSenderNotConnected, WINDOW_MS, type MailSendService } from '../mail/logic/mailSendService';
import { isAllowedRecipient, type MailSettings } from '../mail/settings';
import { AUDIENCE_ORG, issueOf, type DigestComposer } from './composer';
import { NULL_NODE, type CreateRequest, type Counts, type Detail, type JsonNodeValue, type PatchRequest, type Quota, type Stats, type Summary } from './dto';
import { DigestException } from './logic/digestException';
import { isSharedEmpty } from './logic/digestContent';
import type { DigestUnsubscribeTokens } from './logic/digestUnsubscribeTokens';
import { DigestWeek, startOfDayArt } from './logic/digestWeek';
import { formatOdt, odtEqualsInstant, odtFromMicros, odtInZone, odtMicros, odtToPg, parseOdt, type Odt } from './odt';
import * as repo from './repo';
import { clickRate, openRate, ZERO_ENGAGEMENT, type DigestTrackingService } from './tracking';

export const AUTO_SEND_GRACE_MS = 24 * 3_600_000;

/** The DigestIssue entity as loaded/edited inside one transaction. */
interface IssueEntity {
  id: string;
  weekStart: LocalDate;
  subject: string;
  intro: string | null;
  excludedArticleIds: string[];
  excludedEventIds: string[];
  status: string;
  autoSendAt: Odt | null;
  sentAt: Odt | null;
  sentBy: string | null;
  createdAt: Odt | null;
}

const entity = (r: repo.IssueRow): IssueEntity => ({
  ...r,
  autoSendAt: r.autoSendAt == null ? null : odtFromMicros(r.autoSendAt),
  sentAt: r.sentAt == null ? null : odtFromMicros(r.sentAt),
  createdAt: r.createdAt == null ? null : odtFromMicros(r.createdAt),
});

const fmt = (o: Odt | null) => (o == null ? null : formatOdt(o));
/** Instant.atZone(ClockConfig.ZONE).toOffsetDateTime() */
const odtArt = (us: Micros | null) => (us == null ? null : formatOdt(odtInZone(us, ART)));
const ZERO_COUNTS: Counts = { pending: 0, sent: 0, failed: 0 };

export function cleanIds(ids: (string | null)[]): string[] {
  const set = new Set<string>();
  for (const s of ids) if (s != null && !javaIsBlank(s)) set.add(javaStrip(s));
  return [...set];
}

/** Jackson's JsonNode.toString() of a non-textual node (ValidationException's value). */
function nodeText(v: JsonNodeValue): string {
  return v === NULL_NODE ? 'null' : JSON.stringify(v);
}

function parseInstantText(text: string): Odt {
  const o = parseOdt(text);
  if (o == null) throw new ValidationError('autoSendAt', text, 'must be an ISO-8601 instant or null');
  return o;
}

function parseInstantNode(node: JsonNodeValue): Odt | null {
  if (node === NULL_NODE) return null;
  if (typeof node !== 'string') throw new ValidationError('autoSendAt', nodeText(node), 'must be an ISO-8601 instant or null');
  return parseInstantText(node);
}

export class DigestService {
  constructor(private readonly deps: Deps, private readonly settings: MailSettings, private readonly composer: DigestComposer,
              private readonly tokens: DigestUnsubscribeTokens, private readonly sender: MailSendService,
              private readonly tracking: DigestTrackingService, private readonly log: Logger,
              /** DigestJob.onSendRequested (after commit), when the jobs are enabled. */
              private readonly onSendRequested: () => void = () => {}) {}

  // ------------------------------------------------------------ reads

  list(): Promise<Summary[]> {
    return withTx(this.deps.db, async (tx) => {
      const all = (await repo.findAllIssuesByWeekDesc(tx)).map(entity);
      const ids = all.map((i) => i.id);
      const counts = await this.counts(tx, ids);
      const engagement = await this.tracking.engagement(tx, ids);
      const progress = await this.sendingProgress(tx);
      return all.map((i) => {
        const e = engagement.get(i.id) ?? ZERO_ENGAGEMENT;
        const p = progress.get(i.id);
        return {
          id: i.id, weekStart: i.weekStart, weekEnd: plusDays(i.weekStart, 6), subject: i.subject, status: i.status,
          autoSendAt: fmt(i.autoSendAt), sentAt: fmt(i.sentAt), createdAt: fmt(i.createdAt), counts: counts.get(i.id) ?? ZERO_COUNTS,
          resumeAt: p?.resumeAt ?? null, estimatedFinishAt: p?.estimatedFinishAt ?? null, openRate: openRate(e), clickRate: clickRate(e),
        };
      });
    }, { readOnly: true });
  }

  async quota(): Promise<Quota> {
    const q = await this.sender.status();
    return {
      account: q.account, limit: q.limit, usedLast24h: q.usedLast24h, remaining: q.remaining,
      pausedUntil: odtArt(q.pausedUntil), pauseReason: q.pauseReason, nextCapacityAt: odtArt(q.nextCapacityAt), senderStatus: null,
    };
  }

  stats(id: string): Promise<Stats> {
    return withTx(this.deps.db, async (tx) => {
      await this.load(tx, id);
      return this.tracking.stats(tx, id);
    }, { readOnly: true });
  }

  detail(id: string): Promise<Detail> {
    return withTx(this.deps.db, async (tx) => this.detailOf(tx, await this.load(tx, id)), { readOnly: true });
  }

  /** Rendered as the caller would receive it (their unsubscribe link and personal section). */
  previewHtml(id: string, viewerId: string): Promise<string> {
    return withTx(this.deps.db, async (tx) => {
      const issue = issueOf(toRow(await this.load(tx, id)));
      const template = this.composer.template(issue, await this.composer.content(tx, issue));
      return (await this.composer.render(tx, issue, template, viewerId)).html;
    }, { readOnly: true });
  }

  // ------------------------------------------------------------ writes

  async create(req: CreateRequest): Promise<Detail> {
    const weekStart = req.weekStart!;
    const week = new DigestWeek(weekStart);
    const auto = req.autoSendAt == null ? null : parseInstantText(req.autoSendAt);
    if (auto != null) this.requireFuture(auto);
    const exists = () => new DigestException('DIGEST_EXISTS', `A digest for the week of ${weekStart} already exists`);
    return withTx(this.deps.db, async (tx) => {
      if (await repo.existsByWeekStart(tx, weekStart)) throw exists();
      const i: IssueEntity = {
        id: crypto.randomUUID(), weekStart, subject: week.defaultSubject(), intro: null, excludedArticleIds: [], excludedEventIds: [],
        status: 'draft', autoSendAt: auto, sentAt: null, sentBy: null, createdAt: odtInZone(systemNowMicros(), this.deps.config.server.timeZone),
      };
      try {
        await tx.transaction(async (sp) => repo.insertIssue(sp, { id: i.id, weekStart, subject: i.subject,
          autoSendAt: auto == null ? null : odtToPg(auto) }, systemNowMicros()));
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw exists();
        throw e;
      }
      return this.detailOf(tx, i);
    });
  }

  patch(id: string, req: PatchRequest): Promise<Detail> {
    return withTx(this.deps.db, async (tx) => {
      const issue = await this.load(tx, id, true);
      requireDraft(issue);
      if (req.subject != null) {
        if (javaIsBlank(req.subject)) throw new ValidationError('subject', req.subject, 'must not be blank');
        issue.subject = javaStrip(req.subject);
      }
      if (req.intro != null) {
        if (req.intro === NULL_NODE) issue.intro = null;
        else if (typeof req.intro === 'string') {
          const intro = req.intro;
          if (intro.length > 5000) throw new ValidationError('intro', '(long)', 'at most 5000 characters');
          issue.intro = javaIsBlank(intro) ? null : javaStrip(intro);
        } else throw new ValidationError('intro', nodeText(req.intro), 'must be a string or null');
      }
      if (req.excludedArticleIds != null) issue.excludedArticleIds = cleanIds(req.excludedArticleIds);
      if (req.excludedEventIds != null) issue.excludedEventIds = cleanIds(req.excludedEventIds);
      if (req.autoSendAt != null) {
        const at = parseInstantNode(req.autoSendAt);
        // Saving the form resends the stored value: only a changed time has to be in the future.
        if (at != null && !odtEqualsInstant(at, issue.autoSendAt)) this.requireFuture(at);
        issue.autoSendAt = at;
      }
      await this.flush(tx, issue);
      return this.detailOf(tx, issue);
    });
  }

  /** The `me` rendering to the caller now: ignores their opt-out, never the domain guard; consumes quota; untracked. */
  sendTest(id: string, userId: string): Promise<string> {
    return withTx(this.deps.db, (tx) => withAmbientTx(tx, async () => {
      this.requireMailEnabled();
      const user = await repo.findUser(tx, userId);
      if (user == null) throw new ResourceNotFoundError('User', userId);
      if (!isAllowedRecipient(this.settings, user.email)) {
        throw new DigestException('EMAIL_NOT_ALLOWED', `Digest emails only go to ${this.settings.digest.allowedDomains.join(', ')} addresses`);
      }
      const issue = issueOf(toRow(await this.load(tx, id)));
      const template = this.composer.template(issue, await this.composer.content(tx, issue));
      const to = user.email.trim();
      try {
        await this.sender.send(await this.composer.email(tx, issue, template, userId, to, true));
      } catch (e) {
        if (e instanceof MailSenderNotConnected) throw e;
        if (e instanceof EmailSendError) {
          // Gmail's own daily limit: the account is now paused, same 429.
          if (e.kind === 'QUOTA') {
            throw new MailQuotaExhausted(this.sender.account, (await this.sender.readyAt()) ?? this.deps.clock.now() + WINDOW_MS * 1000);
          }
          throw new ExternalApiError('mail', 'test send', e);
        }
        throw e;
      }
      return to;
    }), { readOnly: true });
  }

  /** draft -> sending: snapshot the recipients; the worker sends after commit. */
  async send(id: string, byUserId: string): Promise<Detail> {
    this.requireMailEnabled();
    const d = await withTx(this.deps.db, async (tx) => {
      const issue = await this.load(tx, id, true);
      requireDraft(issue);
      if (isSharedEmpty(await this.composer.content(tx, issueOf(toRow(issue))))) {
        throw new DigestException('DIGEST_EMPTY', 'Nothing to send: every article and event of the week is excluded or there are none');
      }
      await this.startSending(tx, issue, byUserId);
      return this.detailOf(tx, issue);
    });
    this.onSendRequested();
    return d;
  }

  /** draft|sending -> cancelled; pending deliveries of a sending issue are dropped. */
  cancel(id: string): Promise<Detail> {
    return withTx(this.deps.db, async (tx) => {
      const issue = await this.load(tx, id, true);
      if (issue.status !== 'draft' && issue.status !== 'sending') throw notEditable(issue);
      if (issue.status === 'sending') {
        const dropped = await repo.deleteAllPending(tx, issue.id);
        this.log.info(`Digest ${issue.weekStart}: sending stopped, ${dropped} pending deliveries dropped`);
      }
      issue.status = 'cancelled';
      await this.flush(tx, issue);
      return this.detailOf(tx, issue);
    });
  }

  delete(id: string): Promise<void> {
    return withTx(this.deps.db, async (tx) => {
      const issue = await this.load(tx, id, true);
      if (issue.status === 'sending') throw new DigestException('DIGEST_SENDING', 'Digest is sending: stop the send before deleting it');
      await repo.deleteIssue(tx, issue.id);
      this.log.info(`Digest ${issue.weekStart} (${issue.status}) deleted`);
    });
  }

  // ------------------------------------------------------------ jobs

  /** The draft for the week that just ended; acts only Monday 00:05 .. Tuesday 00:00 ART. */
  createScheduledDraft(): Promise<string | null> {
    const nowUs = this.deps.clock.now();
    const today = localDateOf(nowUs, ART);
    const localTime = formatLocalDateTime(nowUs, ART).slice(11, 16);
    if (dayOfWeek(today) !== 1 || localTime < '00:05') return Promise.resolve(null);
    const week = DigestWeek.previousWeek(today);
    return withTx(this.deps.db, async (tx) => {
      if (await repo.existsByWeekStart(tx, week.weekStart)) return null;
      const id = crypto.randomUUID();
      const autoSend = startOfDayArt(week.eventsFrom()) + 12 * 3_600_000_000;
      const auto = autoSend > nowUs ? odtInZone(autoSend, ART) : null;
      await repo.insertIssue(tx, { id, weekStart: week.weekStart, subject: week.defaultSubject(), autoSendAt: auto == null ? null : odtToPg(auto) }, systemNowMicros());
      this.log.info(`Digest draft created for the week of ${week.weekStart} (auto-send ${auto == null ? 'null' : formatOdt(auto)})`);
      return id;
    });
  }

  /** Drafts whose auto-send time has come; a due draft with nothing to send is cancelled. */
  async startDueAutoSends(): Promise<string[]> {
    const now = this.deps.clock.now();
    const started = await withTx(this.deps.db, async (tx) => {
      const due = await repo.findDueForAutoSend(tx, now, now - AUTO_SEND_GRACE_MS * 1000);
      if (due.length === 0) return [];
      if (!this.sender.enabled()) {
        this.log.warn(`Digest auto-send skipped: mail is disabled (MAIL_ENABLED=false), ${due.length} draft(s) due`);
        return [];
      }
      const out: string[] = [];
      for (const id of due) {
        const r = await repo.findIssue(tx, id, true);
        if (r == null) continue;
        const issue = entity(r);
        if (issue.status !== 'draft' || issue.autoSendAt == null || odtMicros(issue.autoSendAt) > now) continue;
        if (isSharedEmpty(await this.composer.content(tx, issueOf(r)))) {
          issue.status = 'cancelled';
          await this.flush(tx, issue);
          this.log.info(`Digest ${issue.weekStart}: nothing to send at auto-send time, cancelled`);
          continue;
        }
        await this.startSending(tx, issue, null);
        out.push(id);
      }
      return out;
    });
    if (started.length > 0) this.onSendRequested();
    return started;
  }

  // ------------------------------------------------------------ subscription

  isSubscribed(userId: string, db: Db = this.deps.db): Promise<boolean> {
    return withTx(db, async (tx) => {
      const u = await repo.findUser(tx, userId);
      return Boolean(u?.digestEmailEnabled) && repo.isFollowing(tx, userId, AUDIENCE_ORG);
    }, { readOnly: true });
  }

  setSubscribed(userId: string, enabled: boolean): Promise<boolean> {
    return withTx(this.deps.db, async (tx) => {
      await repo.setDigestEmailEnabled(tx, userId, enabled);
      if (enabled) await repo.followIfMissing(tx, userId, AUDIENCE_ORG, systemNowMicros());
      return this.isSubscribed(userId, tx);
    });
  }

  /** Public one-click unsubscribe; idempotent; a valid token of a deleted user is a no-op. */
  async unsubscribe(token: string | null): Promise<void> {
    const userId = this.tokens.verify(token);
    if (userId == null) throw new DigestException('INVALID_TOKEN', 'Invalid unsubscribe token');
    await withTx(this.deps.db, (tx) => repo.setDigestEmailEnabled(tx, userId, false));
  }

  // ------------------------------------------------------------ helpers

  private async startSending(tx: Tx, issue: IssueEntity, byUserId: string | null): Promise<void> {
    const recipients = await this.composer.recipients(tx);
    await repo.insertDeliveries(tx, issue.id, recipients);
    issue.status = 'sending';
    issue.sentBy = byUserId;
    await this.flush(tx, issue);
    this.log.info(`Digest ${issue.weekStart}: sending to ${recipients.length} recipients`);
  }

  private flush(tx: Tx, i: IssueEntity): Promise<void> {
    return repo.updateIssue(tx, { id: i.id, subject: i.subject, intro: i.intro, excludedArticleIds: i.excludedArticleIds,
      excludedEventIds: i.excludedEventIds, status: i.status, autoSendAt: i.autoSendAt == null ? null : odtToPg(i.autoSendAt),
      sentBy: i.sentBy }, systemNowMicros());
  }

  private async detailOf(tx: Tx, i: IssueEntity): Promise<Detail> {
    const issue = issueOf(toRow(i));
    const candidates = await this.composer.candidates(tx, issue.week);
    const exA = new Set(issue.excludedArticleIds);
    const exE = new Set(issue.excludedEventIds);
    const articles = candidates.articles.map((a) => ({ id: a.id, title: a.title, excerpt: a.excerpt, coverImage: a.coverImage,
      publishedAt: a.publishedAt, organization: a.organization == null ? null : { slug: a.organization.slug, name: a.organization.name },
      excluded: exA.has(a.id) }));
    const events = candidates.events.map((e) => ({ id: e.id, title: e.title, eventDate: e.eventDate, startTime: e.startTime,
      endTime: e.endTime, location: e.location, organization: e.organization == null ? null : { slug: e.organization.slug, name: e.organization.name },
      excluded: exE.has(e.id) }));
    const estimate = i.status === 'draft' ? await this.composer.recipientCount(tx) : null;
    const p = i.status === 'sending' ? (await this.sendingProgress(tx)).get(i.id) : undefined;
    return {
      id: i.id, weekStart: i.weekStart, weekEnd: plusDays(i.weekStart, 6), subject: i.subject, intro: i.intro, status: i.status,
      autoSendAt: fmt(i.autoSendAt), sentAt: fmt(i.sentAt), counts: (await this.counts(tx, [i.id])).get(i.id) ?? ZERO_COUNTS,
      recipientEstimate: estimate, articles, events, resumeAt: p?.resumeAt ?? null, estimatedFinishAt: p?.estimatedFinishAt ?? null,
    };
  }

  /** Per sending issue (oldest week first): when the paused account resumes, when its last email should go out. */
  private async sendingProgress(tx: Tx): Promise<Map<string, { resumeAt: string | null; estimatedFinishAt: string | null }>> {
    const ids = await repo.findSendingIds(tx);
    const out = new Map<string, { resumeAt: string | null; estimatedFinishAt: string | null }>();
    if (ids.length === 0) return out;
    const pending = await this.counts(tx, ids);
    const resumeAt = odtArt(await this.sender.readyAt());
    let cumulative = 0;
    for (const id of ids) {
      cumulative += (pending.get(id) ?? ZERO_COUNTS).pending;
      out.set(id, { resumeAt, estimatedFinishAt: odtArt(await this.sender.estimateFinish(cumulative, this.settings.digest.sendIntervalMs)) });
    }
    return out;
  }

  private async counts(tx: Tx, ids: string[]): Promise<Map<string, Counts>> {
    const out = new Map<string, Counts>();
    for (const r of await repo.countByIssueAndStatus(tx, ids)) {
      let c = out.get(r.issueId);
      if (!c) out.set(r.issueId, (c = { pending: 0, sent: 0, failed: 0 }));
      if (r.status === 'pending' || r.status === 'sending') c.pending += r.n;
      else if (r.status === 'sent') c.sent += r.n;
      else if (r.status === 'failed') c.failed += r.n;
    }
    return out;
  }

  private requireMailEnabled(): void {
    if (!this.sender.enabled()) throw new DigestException('MAIL_DISABLED', 'Email sending is disabled on this server (MAIL_ENABLED=false)');
  }

  private requireFuture(at: Odt): void {
    if (odtMicros(at) < this.deps.clock.now()) throw new DigestException('AUTO_SEND_IN_PAST', 'autoSendAt must be in the future');
  }

  private async load(tx: Tx, id: string, forUpdate = false): Promise<IssueEntity> {
    const r = await repo.findIssue(tx, id, forUpdate);
    if (r == null) throw new ResourceNotFoundError('Digest', id);
    return entity(r);
  }
}

function toRow(i: IssueEntity): repo.IssueRow {
  return { ...i, autoSendAt: null, sentAt: null, createdAt: null };
}

function requireDraft(i: IssueEntity): void {
  if (i.status !== 'draft') throw notEditable(i);
}

const notEditable = (i: IssueEntity) => new DigestException('DIGEST_NOT_EDITABLE', `Digest is ${i.status}, not editable`);
