// service/news/OrganizationService + FollowService + OrgAnalyticsService.

import type { Db } from '../../db/client';
import { isUniqueViolation, withTx } from '../../db/client';
import type { Deps } from '../../deps';
import { mailBeans } from '../mail/service';
import { ResourceAlreadyExistsError, ResourceNotFoundError, ValidationError } from '../../http/errors';
import { javaIsBlank, javaTrim, plusDays } from '../../lib/javaCompat';
import { parsePgTimestamp, toPgTimestamp, zoneOffsetMinutes } from '../../lib/time';
import { instagram } from '../user/logic/socialHandles';
import type { BoardMemberView, FollowerResponse, OrganizationResponse } from './dto';
import { dbTime, type OrganizationMembershipService } from './memberships';
import * as repo from './repo';

/** OrganizationService.ProfileFields: null leaves a field unchanged, blank clears it. */
export interface ProfileFields {
  instagram: string | null;
  linkedinUrl: string | null;
  websiteUrl: string | null;
  contactEmail: string | null;
  recruitingOpen: boolean | null;
  recruitingUrl: string | null;
  recruitingText: string | null;
}

/** The plain (non-profile) fields of an Organization in a create/patch. */
export interface OrgFields {
  name: string | null;
  fullName: string | null;
  description: string | null;
  category: string | null;
  color: string | null;
  logoUrl: string | null;
  backgroundUrl: string | null;
}

const blankToNull = (s: string) => (javaIsBlank(s) ? null : javaTrim(s));

/** applyProfile, as the column changes it makes. */
function profileChanges(p: ProfileFields): Partial<repo.OrgRow> {
  const c: Partial<repo.OrgRow> = {};
  if (p.instagram !== null) c.instagram = javaIsBlank(p.instagram) ? null : instagram(p.instagram);
  if (p.linkedinUrl !== null) c.linkedinUrl = blankToNull(p.linkedinUrl);
  if (p.websiteUrl !== null) c.websiteUrl = blankToNull(p.websiteUrl);
  if (p.contactEmail !== null) c.contactEmail = blankToNull(p.contactEmail);
  if (p.recruitingOpen !== null) c.recruitingOpen = p.recruitingOpen;
  if (p.recruitingUrl !== null) c.recruitingUrl = blankToNull(p.recruitingUrl);
  if (p.recruitingText !== null) c.recruitingText = blankToNull(p.recruitingText);
  return c;
}

export function organizationResponse(o: repo.OrgRow, followerCount: number, board: BoardMemberView[] | null = null): OrganizationResponse {
  return {
    slug: o.slug, name: o.name, fullName: o.fullName, description: o.description, category: o.category, color: o.color,
    followerCount, logoUrl: o.logoUrl, backgroundUrl: o.backgroundUrl, instagram: o.instagram, linkedinUrl: o.linkedinUrl,
    websiteUrl: o.websiteUrl, contactEmail: o.contactEmail, recruitingOpen: o.recruitingOpen, recruitingUrl: o.recruitingUrl,
    recruitingText: o.recruitingText, attendeesVisibleToMembers: o.attendeesVisibleToMembers, board,
  };
}

export class OrganizationService {
  constructor(private readonly deps: Deps, private readonly memberships: OrganizationMembershipService) {}

  /** GET /v1/organizations: every organization with its follower count (one count query, not one per org). */
  list(): Promise<OrganizationResponse[]> {
    return withTx(this.deps.db, async (tx) => {
      const orgs = await repo.findAllOrgs(tx);
      const counts = await repo.countFollowersByOrg(tx);
      return orgs.map((o) => organizationResponse(o, counts.get(o.slug) ?? 0));
    }, { readOnly: true });
  }

  /** GET /v1/organizations/{slug}: with its follower count and public board. */
  get(slug: string): Promise<OrganizationResponse> {
    return withTx(this.deps.db, async (tx) => {
      const o = await this.findBySlug(slug, tx);
      return organizationResponse(o, await repo.countFollowers(tx, o.slug), await this.memberships.board(o.slug, tx));
    }, { readOnly: true });
  }

  /** 404 unless the organization exists. */
  async requireExists(slug: string): Promise<void> {
    await this.findBySlug(slug);
  }

  async findBySlug(slug: string, tx?: Db): Promise<repo.OrgRow> {
    const o = await withTx(tx ?? this.deps.db, (t) => repo.findOrg(t, slug), { readOnly: true });
    if (!o) throw new ResourceNotFoundError('Organization', slug);
    return o;
  }

  /** create: applyProfile runs before (in the controller), so a bad instagram is 400 first. */
  async create(slug: string, f: OrgFields, profile: ProfileFields): Promise<OrganizationResponse> {
    const row: repo.OrgRow = {
      slug, name: f.name!, fullName: f.fullName!, description: f.description, category: f.category, color: f.color,
      logoUrl: f.logoUrl, backgroundUrl: f.backgroundUrl, instagram: null, linkedinUrl: null, websiteUrl: null, contactEmail: null,
      recruitingOpen: false, recruitingUrl: null, recruitingText: null, attendeesVisibleToMembers: true,
      ...profileChanges(profile),
    };
    // A concurrent insert (not caught in Java) surfaces as 409 DataIntegrityViolation.
    return withTx(this.deps.db, async (tx) => {
      if (await repo.orgExists(tx, slug)) throw new ResourceAlreadyExistsError('Organization', slug);
      const created = await repo.insertOrg(tx, row);
      return organizationResponse(created, await repo.countFollowers(tx, created.slug));
    });
  }

  update(slug: string, f: OrgFields, profile: ProfileFields | null): Promise<OrganizationResponse> {
    return withTx(this.deps.db, async (tx) => {
      const o = await this.findBySlug(slug, tx);
      const set: Partial<repo.OrgRow> = {};
      const put = <K extends keyof repo.OrgRow>(k: K, v: repo.OrgRow[K] | null) => {
        if (v !== null) set[k] = v;
      };
      put('name', f.name);
      put('fullName', f.fullName);
      put('description', f.description);
      put('category', f.category);
      put('color', f.color);
      put('logoUrl', f.logoUrl);
      put('backgroundUrl', f.backgroundUrl);
      if (profile) Object.assign(set, profileChanges(profile));
      const next = { ...o, ...set };
      const dirty: Partial<repo.OrgRow> = {};
      for (const k of Object.keys(set) as (keyof repo.OrgRow)[]) if (set[k] !== o[k]) (dirty as Record<string, unknown>)[k] = set[k];
      await repo.updateOrg(tx, slug, dirty);
      return organizationResponse(next, await repo.countFollowers(tx, next.slug));
    });
  }

  delete(slug: string): Promise<void> {
    return withTx(this.deps.db, async (tx) => {
      if (!(await repo.orgExists(tx, slug))) throw new ResourceNotFoundError('Organization', slug);
      // mail_sender_account.owner_ref has no FK: revoke (best effort) and drop the org's Gmail account.
      await mailBeans(this.deps).accounts.disconnectOrg(slug, tx);
      await repo.deleteOrg(tx, slug);
    });
  }
}

export class FollowService {
  constructor(private readonly deps: Deps) {}

  listForUser(userId: string, tx?: Db): Promise<repo.FollowRow[]> {
    return withTx(tx ?? this.deps.db, (t) => repo.followsOfUser(t, userId), { readOnly: true });
  }

  /** Followers (newest first) with user fields; 404 for an unknown org. */
  listFollowers(org: string): Promise<FollowerResponse[]> {
    return withTx(this.deps.db, async (tx) => {
      if (!(await repo.orgExists(tx, org))) throw new ResourceNotFoundError('Organization', org);
      const follows = await repo.followersOf(tx, org);
      if (follows.length === 0) return [];
      const users = new Map((await repo.findUsersByIds(tx, follows.map((f) => f.userId))).map((u) => [u.id, u]));
      return follows.map((f) => {
        const u = users.get(f.userId);
        return { userId: f.userId, name: u?.name ?? null, email: u?.email ?? null, avatarUrl: u?.avatarUrl ?? null, followedAt: dbTime(f.createdAt)! };
      });
    }, { readOnly: true });
  }

  countFollowers(org: string, tx?: Db): Promise<number> {
    return withTx(tx ?? this.deps.db, (t) => repo.countFollowers(t, org), { readOnly: true });
  }

  isFollowing(userId: string, org: string): Promise<boolean> {
    return withTx(this.deps.db, (tx) => repo.followExists(tx, userId, org), { readOnly: true });
  }

  /**
   * follow: idempotent. Returns the row and whether it was read back (a repeat
   * follow returns the stored row, with its DB timestamp).
   */
  async follow(userId: string, org: string): Promise<{ row: repo.FollowRow; createdNow: boolean }> {
    try {
      return await withTx(this.deps.db, async (tx) => {
        if (!(await repo.orgExists(tx, org))) throw new ResourceNotFoundError('Organization', org);
        const existing = (await repo.followsOfUser(tx, userId)).find((f) => f.orgSlug === org);
        if (existing) return { row: existing, createdNow: false };
        return { row: await repo.insertFollow(tx, userId, org, this.deps.clock.now()), createdNow: true };
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      const row = (await withTx(this.deps.db, (tx) => repo.followsOfUser(tx, userId), { readOnly: true })).find((f) => f.orgSlug === org);
      if (!row) throw e;
      return { row, createdNow: false };
    }
  }

  async followIfMissing(userId: string, org: string, tx?: Db): Promise<void> {
    await withTx(tx ?? this.deps.db, async (t) => {
      if (!(await repo.orgExists(t, org))) return;
      if (await repo.followExists(t, userId, org)) return;
      await repo.insertFollow(t, userId, org, this.deps.clock.now());
    });
  }

  async unfollow(userId: string, org: string): Promise<void> {
    await withTx(this.deps.db, (tx) => repo.deleteFollow(tx, userId, org));
  }
}

export const ORG_ANALYTICS_MAX_DAYS = 365;

/** OrgAnalyticsService.OrgAnalytics and its records, in component order. */
export interface OrgAnalytics {
  days: number;
  articleViews: number;
  eventViews: number;
  uniqueVisitors: number;
  daily: { date: string; articleViews: number; eventViews: number }[];
  topArticles: { articleId: string; title: string; views: number }[];
  events: { eventId: string; title: string; date: string; signupMode: string; capacity: number | null; rsvpCount: number; views: number }[];
  followers: { total: number; newInPeriod: number; cumulative: { date: string; count: number }[] };
  pushes: { pushes: number; devicesTargeted: number; devicesReached: number };
  mail: { announcements: number; recipients: number };
}

export class OrgAnalyticsService {
  constructor(private readonly deps: Deps) {}

  summary(org: string, days: number): Promise<OrgAnalytics> {
    return withTx(this.deps.db, async (tx) => {
      if (days < 1 || days > ORG_ANALYTICS_MAX_DAYS) throw new ValidationError('days', days, `must be 1-${ORG_ANALYTICS_MAX_DAYS}`);
      if (!(await repo.orgExists(tx, org))) throw new ResourceNotFoundError('Organization', org);
      const today = this.deps.clock.today();
      const firstDay = plusDays(today, -(days - 1));
      const since = toPgTimestamp(startOfDay(firstDay, this.deps.clock.zone));

      const totals = await repo.orgTotalsSince(tx, org, since);
      const viewsByDay = new Map((await repo.orgDailySince(tx, org, since)).map((r) => [r.day, r]));
      const daily: OrgAnalytics['daily'] = [];
      for (let d = firstDay; d <= today; d = plusDays(d, 1)) {
        const v = viewsByDay.get(d);
        daily.push({ date: d, articleViews: v?.a ?? 0, eventViews: v?.e ?? 0 });
      }
      const topArticles = (await repo.orgTopArticlesSince(tx, org, since)).map((r) => ({ articleId: r.id, title: r.title, views: r.views }));
      const events = (await repo.orgEventsSince(tx, org, since, firstDay)).map((r) => ({
        eventId: r.id, title: r.title, date: r.date, signupMode: r.signupMode, capacity: r.capacity, rsvpCount: r.rsvps, views: r.views,
      }));
      const before = await repo.countFollowersBefore(tx, org, since);
      const newByDay = await repo.dailyNewFollowersSince(tx, org, since);
      const cumulative: OrgAnalytics['followers']['cumulative'] = [];
      let running = before;
      for (let d = firstDay; d <= today; d = plusDays(d, 1)) {
        running += newByDay.get(d) ?? 0;
        cumulative.push({ date: d, count: running });
      }
      const total = await repo.countFollowers(tx, org);
      const push = await repo.pushTotalsSince(tx, org, since);
      const mail = await repo.mailTotalsSince(tx, org, since);
      return {
        days, articleViews: totals[0], eventViews: totals[1], uniqueVisitors: totals[2], daily, topArticles, events,
        followers: { total, newInPeriod: running - before, cumulative },
        pushes: { pushes: push[0], devicesTargeted: push[1], devicesReached: push[2] },
        mail: { announcements: mail[0], recipients: mail[1] },
      };
    }, { readOnly: true });
  }
}

/** LocalDate.atStartOfDay(zone) in microseconds. */
function startOfDay(date: string, zone: string): number {
  const utcMidnight = parsePgTimestamp(`${date} 00:00:00Z`);
  // Two passes handle a DST edge; Argentina has none today.
  let us = utcMidnight - zoneOffsetMinutes(zone, utcMidnight) * 60_000_000;
  us = utcMidnight - zoneOffsetMinutes(zone, us) * 60_000_000;
  return us;
}
