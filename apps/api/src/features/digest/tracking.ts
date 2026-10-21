// service/digest/DigestTrackingService: open and click tracking of the weekly
// digest (docs/WEEKLY-DIGEST.md, "Open and click tracking").

import type { Deps } from '../../deps';
import type { Db } from '../../db/client';
import type { OutgoingEmail } from '../../infra/mail';
import { javaDouble } from '../../lib/json';
import { ART, formatOffsetDateTime, type Micros } from '../../lib/time';
import { MAIL_TRACKING_IP, type ContentHmac } from '../crypto/logic/contentHmac';
import { isScanner, mailClientClassDb, mailClientClassOf, type MailClientClass } from '../mail/logic/mailClientClass';
import { collectLinks, isWellFormedTrackingId, PERSONAL_BASE, rewriteLinks, type TrackedLink } from '../mail/logic/mailLinkRewriter';
import * as mailRepo from '../mail/repo';
import type { MailSettings } from '../mail/settings';
import type { Stats } from './dto';
import type { DigestTemplate } from './logic/digestRenderer';
import * as repo from './repo';

export const MIN_AFTER_SEND_MS = 10_000;
export const PER_CLIENT_PER_MINUTE = 600;
export const PER_TRACKING_ID_PER_HOUR = 30;

export interface ClientInfo { userAgent: string | null; method: string; ip: string | null }

/** bucket4j greedy refill (capacity n per period), behind a Caffeine expireAfterAccess cache. */
class Buckets {
  private readonly map = new Map<string, { tokens: number; at: number; seen: number }>();
  constructor(private readonly capacity: number, private readonly periodMs: number, private readonly expireMs: number,
              private readonly maxSize = 100_000) {}

  tryConsume(key: string, nowMs = performance.now()): boolean {
    let b = this.map.get(key);
    if (b && nowMs - b.seen > this.expireMs) {
      this.map.delete(key);
      b = undefined;
    }
    if (!b) {
      if (this.map.size >= this.maxSize) this.prune(nowMs);
      b = { tokens: this.capacity, at: nowMs, seen: nowMs };
      this.map.set(key, b);
    }
    b.tokens = Math.min(this.capacity, b.tokens + ((nowMs - b.at) * this.capacity) / this.periodMs);
    b.at = nowMs;
    b.seen = nowMs;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  private prune(nowMs: number) {
    for (const [k, b] of this.map) if (nowMs - b.seen > this.expireMs) this.map.delete(k);
    while (this.map.size >= this.maxSize) this.map.delete(this.map.keys().next().value!);
  }
}

/** Why an event does not count (null = it does). */
export function flagOf(cls: MailClientClass, client: ClientInfo, sentAt: Micros | null, now: Micros): string | null {
  if (isScanner(cls) || client.method.toUpperCase() === 'HEAD') return 'scanner';
  if (sentAt == null || now < sentAt + MIN_AFTER_SEND_MS * 1000) return 'early';
  return null;
}

/** Math.round(part * 10000.0 / whole) / 10000.0, null without delivered emails. */
export function rate(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.floor((part * 10000.0) / whole + 0.5) / 10000.0;
}

export interface Engagement { delivered: number; opened: number; clicked: number }
const ZERO: Engagement = { delivered: 0, opened: 0, clicked: 0 };
const dbl = (v: number | null) => (v == null ? null : javaDouble(v));

export class DigestTrackingService {
  private readonly clientBuckets = new Buckets(PER_CLIENT_PER_MINUTE, 60_000, 2 * 60_000);
  private readonly trackingBuckets = new Buckets(PER_TRACKING_ID_PER_HOUR, 3_600_000, 2 * 3_600_000);

  constructor(private readonly deps: Deps, private readonly settings: MailSettings, private readonly hmac: ContentHmac) {}

  enabled(): boolean {
    return this.settings.digest.trackingEnabled;
  }

  fallbackUrl(): string {
    return this.settings.digest.publicBaseUrl;
  }

  // ---------------------------------------------------------- sending side

  /** URL -> link id of the issue's shared links (stored once; new links get the next ids). */
  async issueLinks(db: Db, issueId: string, template: DigestTemplate): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    let max = 0;
    for (const l of await repo.findIssueLinks(db, issueId)) {
      map.set(l.url, l.linkId);
      max = Math.max(max, l.linkId);
    }
    for (const link of collectLinks(template.htmlBody, template.textBody, (u) => this.isUnsubscribeLink(u))) {
      if (map.has(link.url)) continue;
      if (max + 1 >= PERSONAL_BASE) break;
      const id = ++max;
      await repo.insertIssueLink(db, issueId, id, link.url, link.urlKey, link.label);
      map.set(link.url, id);
    }
    return map;
  }

  isUnsubscribeLink(url: string): boolean {
    const prefix = `${this.settings.digest.publicBaseUrl}/unsubscribe`;
    return url.startsWith(prefix) && (url.length === prefix.length || '?#/'.includes(url[prefix.length]!));
  }

  /** The email with every body link wrapped and the pixel appended (pure). */
  track(email: OutgoingEmail, trackingId: string, shared: ReadonlyMap<string, number>): { email: OutgoingEmail; personalLinks: TrackedLink[] } {
    const base = `${this.settings.digest.apiBaseUrl}/v1/mail`;
    const r = rewriteLinks(email.html, email.text, shared, (id) => `${base}/c/${trackingId}/${id}`, `${base}/o/${trackingId}.gif`,
      (u) => this.isUnsubscribeLink(u));
    return { email: { ...email, html: r.html ?? email.html, text: r.text ?? email.text }, personalLinks: r.personalLinks };
  }

  saveDeliveryLinks(db: Db, trackingId: string, links: TrackedLink[]): Promise<void> {
    return repo.replaceDeliveryLinks(db, trackingId, links);
  }

  // ---------------------------------------------------------- public side

  async open(trackingId: string, client: ClientInfo): Promise<void> {
    if (!isWellFormedTrackingId(trackingId) || !this.admit(trackingId, client)) return;
    await this.deps.db.transaction(async (tx) => {
      const d = await repo.findDeliveryByTrackingId(tx, trackingId);
      if (d == null) return;
      const now = this.deps.clock.now();
      const cls = mailClientClassOf(client.userAgent);
      const flag = flagOf(cls, client, d.sentAt, now);
      await mailRepo.insertTrackingEvent(tx, trackingId, 'open', null, now, flag, mailClientClassDb(cls));
      if (flag == null) await repo.recordOpen(tx, trackingId, now);
    });
  }

  /** The stored URL of that link, or the newsletter home; never a URL from the request. */
  async click(trackingId: string, linkId: string, client: ClientInfo): Promise<string> {
    const fallback = this.fallbackUrl();
    if (!isWellFormedTrackingId(trackingId)) return fallback;
    const id = parseLinkId(linkId);
    if (id == null) return fallback;
    if (!this.admit(trackingId, client)) return fallback;
    return this.deps.db.transaction(async (tx) => {
      const d = await repo.findDeliveryByTrackingId(tx, trackingId);
      if (d == null) return fallback;
      const url = id < PERSONAL_BASE ? await repo.findIssueLinkUrl(tx, d.issueId, id) : await repo.findDeliveryLinkUrl(tx, trackingId, id);
      if (url == null || !isHttp(url)) return fallback;
      const now = this.deps.clock.now();
      const cls = mailClientClassOf(client.userAgent);
      const flag = flagOf(cls, client, d.sentAt, now);
      await mailRepo.insertTrackingEvent(tx, trackingId, 'click', id, now, flag, mailClientClassDb(cls));
      if (flag == null) await repo.recordClick(tx, trackingId, now);
      return url;
    });
  }

  private admit(trackingId: string, client: ClientInfo): boolean {
    const ipKey = client.ip == null ? '?' : this.hmac.signHex(MAIL_TRACKING_IP, client.ip);
    if (!this.clientBuckets.tryConsume(ipKey)) return false;
    return this.trackingBuckets.tryConsume(trackingId);
  }

  // ---------------------------------------------------------- stats

  async engagement(db: Db, issueIds: string[]): Promise<Map<string, Engagement>> {
    const out = new Map<string, Engagement>();
    for (const r of await repo.engagementByIssue(db, issueIds)) out.set(r.issueId, r);
    return out;
  }

  async stats(db: Db, issueId: string): Promise<Stats> {
    const e = (await this.engagement(db, [issueId])).get(issueId) ?? ZERO;
    const links = (await repo.clicksByLink(db, issueId)).map((r) => ({ label: r.label, url: r.urlKey, uniqueClicks: r.unique, totalClicks: r.total }));
    const hours = (await repo.firstOpensByHour(db, issueId)).map((r) => ({ hour: formatOffsetDateTime(r.epochSecond * 1_000_000, ART), count: r.n }));
    return {
      delivered: e.delivered, uniqueOpens: e.opened, openRate: dbl(rate(e.opened, e.delivered)),
      uniqueClicks: e.clicked, clickRate: dbl(rate(e.clicked, e.delivered)), clicksByLink: links, opensByHour: hours,
    };
  }
}

export const openRate = (e: Engagement) => dbl(rate(e.opened, e.delivered));
export const clickRate = (e: Engagement) => dbl(rate(e.clicked, e.delivered));
export const ZERO_ENGAGEMENT = ZERO;

function parseLinkId(s: string | null): number | null {
  if (s == null || s.length === 0 || s.length > 6 || !/^[0-9]+$/.test(s)) return null;
  return Number(s);
}

function isHttp(url: string): boolean {
  const u = url.toLowerCase();
  return u.startsWith('https://') || u.startsWith('http://');
}
