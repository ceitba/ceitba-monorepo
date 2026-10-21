// repository/news/* (ArticleRepository, NewsEventRepository, OrganizationRepository,
// UserOrganizationRepository, OrgInviteRepository, UserFollowRepository,
// EventRsvpRepository, ArticleVoteRepository, VoteRecordRepository,
// AnalyticsEventRepository) plus the user lookups the news services do.
// Rows never leave the services.

import { and, asc, count, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { user } from '../../db/schema/identity';
import {
  analyticsEvents, articles, articleVotes, eventRsvps, newsEvents, orgInvites, organizations, userFollows, userOrganizations, voteRecords,
} from '../../db/schema/news';
import { toPgTimestamp, type Micros } from '../../lib/time';
import { pageOffset, type PageRequest } from './paging';

export type ArticleRow = typeof articles.$inferSelect;
export type EventRow = typeof newsEvents.$inferSelect;
export type OrgRow = typeof organizations.$inferSelect;
export type MembershipRow = typeof userOrganizations.$inferSelect;
export type InviteRow = typeof orgInvites.$inferSelect;
export type FollowRow = typeof userFollows.$inferSelect;
export type RsvpRow = typeof eventRsvps.$inferSelect;
export type UserRow = typeof user.$inferSelect;
export type VoteAggRow = typeof articleVotes.$inferSelect;
export type VoteRecordRow = typeof voteRecords.$inferSelect;

const n = (v: unknown) => Number(v ?? 0);

/** db.execute with typed rows (raw SQL). */
async function rowsOf<T>(db: Db, q: SQL): Promise<T[]> {
  return (await db.execute(q)) as unknown as T[];
}

// ------------------------------------------------------------------ users

export function findUsersByIds(db: Db, ids: string[]): Promise<UserRow[]> {
  if (ids.length === 0) return Promise.resolve([]);
  return db.select().from(user).where(inArray(user.id, ids));
}

export async function findUserIdByEmail(db: Db, email: string): Promise<string | null> {
  const [r] = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1);
  return r?.id ?? null;
}

/** UserRepository.findByLowerEmailIn: lower(email) IN (...). */
export function findUsersByLowerEmailIn(db: Db, emails: string[]): Promise<UserRow[]> {
  if (emails.length === 0) return Promise.resolve([]);
  return db.select().from(user).where(inArray(sql`lower(${user.email})`, emails));
}

// ------------------------------------------------------------------ organizations

/** organizationRepository.findAll(): no ORDER BY. */
export function findAllOrgs(db: Db): Promise<OrgRow[]> {
  return db.select().from(organizations);
}

export async function findOrg(db: Db, slug: string): Promise<OrgRow | null> {
  const [r] = await db.select().from(organizations).where(eq(organizations.slug, slug)).limit(1);
  return r ?? null;
}

export async function orgExists(db: Db, slug: string): Promise<boolean> {
  return (await findOrg(db, slug)) !== null;
}

export async function insertOrg(db: Db, o: OrgRow): Promise<OrgRow> {
  const [r] = await db.insert(organizations).values(o).returning();
  return r!;
}

/** @DynamicUpdate: only the changed columns. */
export async function updateOrg(db: Db, slug: string, changes: Partial<OrgRow>): Promise<void> {
  if (Object.keys(changes).length === 0) return;
  await db.update(organizations).set(changes).where(eq(organizations.slug, slug));
}

export async function deleteOrg(db: Db, slug: string): Promise<void> {
  await db.delete(organizations).where(eq(organizations.slug, slug));
}

// ------------------------------------------------------------------ memberships

export function membershipsOfOrg(db: Db, org: string): Promise<MembershipRow[]> {
  return db.select().from(userOrganizations).where(eq(userOrganizations.orgSlug, org));
}

export function membershipsOfUser(db: Db, userId: string): Promise<MembershipRow[]> {
  return db.select().from(userOrganizations).where(eq(userOrganizations.userId, userId));
}

export async function findMembership(db: Db, userId: string, org: string): Promise<MembershipRow | null> {
  const [r] = await db.select().from(userOrganizations)
    .where(and(eq(userOrganizations.userId, userId), eq(userOrganizations.orgSlug, org))).limit(1);
  return r ?? null;
}

export async function membershipExists(db: Db, userId: string, org: string, role?: string): Promise<boolean> {
  const conds: SQL[] = [eq(userOrganizations.userId, userId), eq(userOrganizations.orgSlug, org)];
  if (role !== undefined) conds.push(eq(userOrganizations.role, role));
  const [r] = await db.select({ c: count() }).from(userOrganizations).where(and(...conds));
  return n(r?.c) > 0;
}

/** findByOrganizationAndShowOnPortalTrueOrderByCreatedAt. */
export function boardOf(db: Db, org: string): Promise<MembershipRow[]> {
  return db.select().from(userOrganizations)
    .where(and(eq(userOrganizations.orgSlug, org), eq(userOrganizations.showOnPortal, true)))
    .orderBy(asc(userOrganizations.createdAt));
}

export async function insertMembership(db: Db, m: { userId: string; org: string; role: string; addedBy: string | null; createdAt: Micros | null }): Promise<void> {
  await db.insert(userOrganizations).values({
    userId: m.userId, orgSlug: m.org, role: m.role, addedBy: m.addedBy, title: null, showOnPortal: false,
    ...(m.createdAt !== null ? { createdAt: toPgTimestamp(m.createdAt) } : {}),
  });
}

export async function updateMembership(db: Db, userId: string, org: string, changes: Partial<Pick<MembershipRow, 'role' | 'title' | 'showOnPortal'>>): Promise<void> {
  if (Object.keys(changes).length === 0) return;
  await db.update(userOrganizations).set(changes).where(and(eq(userOrganizations.userId, userId), eq(userOrganizations.orgSlug, org)));
}

export async function deleteMembership(db: Db, userId: string, org: string): Promise<void> {
  await db.delete(userOrganizations).where(and(eq(userOrganizations.userId, userId), eq(userOrganizations.orgSlug, org)));
}

/** findAdminsForUpdate: the org's admin rows, locked, ORDER BY user_id. */
export function adminsForUpdate(db: Db, org: string): Promise<MembershipRow[]> {
  return db.select().from(userOrganizations)
    .where(and(eq(userOrganizations.orgSlug, org), eq(userOrganizations.role, 'admin')))
    .orderBy(asc(userOrganizations.userId)).for('update');
}

// ------------------------------------------------------------------ invites

export function invitesOfOrg(db: Db, org: string): Promise<InviteRow[]> {
  return db.select().from(orgInvites).where(eq(orgInvites.orgSlug, org)).orderBy(asc(orgInvites.email));
}

export async function upsertInvite(db: Db, org: string, email: string, role: string, by: string | null): Promise<void> {
  await db.execute(sql`INSERT INTO public.org_invites (org_slug, email, role, invited_by)
    VALUES (${org}, ${email}, ${role}, ${by}) ON CONFLICT (org_slug, email) DO UPDATE SET role = EXCLUDED.role`);
}

export async function deleteInvite(db: Db, org: string, email: string): Promise<number> {
  return (await db.delete(orgInvites).where(and(eq(orgInvites.orgSlug, org), eq(orgInvites.email, email))).returning({ e: orgInvites.email })).length;
}

export async function insertMembershipsFromInvites(db: Db, userId: string, email: string): Promise<number> {
  const rows = await db.execute(sql`INSERT INTO public.user_organizations (user_id, org_slug, role, added_by)
    SELECT ${userId}::uuid, i.org_slug, i.role, i.invited_by FROM public.org_invites i WHERE i.email = ${email}
    ON CONFLICT DO NOTHING RETURNING user_id`);
  return rows.length;
}

export async function deleteInvitesByEmail(db: Db, email: string): Promise<number> {
  return (await db.delete(orgInvites).where(eq(orgInvites.email, email)).returning({ e: orgInvites.email })).length;
}

// ------------------------------------------------------------------ follows

export async function countFollowers(db: Db, org: string): Promise<number> {
  const [r] = await db.select({ c: count() }).from(userFollows).where(eq(userFollows.orgSlug, org));
  return n(r?.c);
}

export function followersOf(db: Db, org: string): Promise<FollowRow[]> {
  return db.select().from(userFollows).where(eq(userFollows.orgSlug, org)).orderBy(desc(userFollows.createdAt));
}

export function followsOfUser(db: Db, userId: string): Promise<FollowRow[]> {
  return db.select().from(userFollows).where(eq(userFollows.userId, userId));
}

export async function followExists(db: Db, userId: string, org: string): Promise<boolean> {
  const [r] = await db.select({ c: count() }).from(userFollows).where(and(eq(userFollows.userId, userId), eq(userFollows.orgSlug, org)));
  return n(r?.c) > 0;
}

export async function insertFollow(db: Db, userId: string, org: string, now: Micros): Promise<FollowRow> {
  const [r] = await db.insert(userFollows).values({ userId, orgSlug: org, createdAt: toPgTimestamp(now) }).returning();
  return r!;
}

export async function deleteFollow(db: Db, userId: string, org: string): Promise<void> {
  await db.delete(userFollows).where(and(eq(userFollows.userId, userId), eq(userFollows.orgSlug, org)));
}

// ------------------------------------------------------------------ articles

export async function findArticle(db: Db, id: string, forUpdate = false): Promise<ArticleRow | null> {
  const q = db.select().from(articles).where(eq(articles.id, id)).limit(1);
  const [r] = forUpdate ? await q.for('update') : await q;
  return r ?? null;
}

/** findIndependentStatusOwnedBy. */
export async function independentStatusOwnedBy(db: Db, id: string, userId: string): Promise<string | null> {
  const [r] = await db.select({ status: articles.status }).from(articles)
    .where(and(eq(articles.id, id), isNull(articles.organization), eq(articles.createdBy, userId))).limit(1);
  return r?.status ?? null;
}

export interface ArticleFilter { category: string | null; organization: string | null; status: string | null; createdBy: string | null; independentOnly?: boolean }

/** findFiltered / findIndependentByCreatedBy: ORDER BY created_at DESC, id DESC. */
export async function findArticles(db: Db, f: ArticleFilter, page: PageRequest): Promise<{ rows: ArticleRow[]; total: number }> {
  const conds: SQL[] = [];
  if (f.independentOnly) conds.push(isNull(articles.organization));
  if (f.category !== null) conds.push(eq(articles.category, f.category));
  if (f.organization !== null) conds.push(eq(articles.organization, f.organization));
  if (f.status !== null) conds.push(eq(articles.status, f.status));
  if (f.createdBy !== null) conds.push(eq(articles.createdBy, f.createdBy));
  const where = conds.length ? and(...conds) : undefined;
  const rows = await db.select().from(articles).where(where)
    .orderBy(sql`${articles.createdAt} DESC`, desc(articles.id)).limit(page.size).offset(pageOffset(page));
  const total = await pageTotal(rows.length, page, async () => {
    const [r] = await db.select({ c: count() }).from(articles).where(where);
    return n(r?.c);
  });
  return { rows, total };
}

/**
 * Spring Data's PageableExecutionUtils.getPage: the count query is skipped when
 * the first page is not full, or when a later page is partial (offset + size).
 */
async function pageTotal(got: number, page: PageRequest, countQuery: () => Promise<number>): Promise<number> {
  const offset = pageOffset(page);
  if (offset === 0 && got < page.size) return got;
  if (got !== 0 && got < page.size) return offset + got;
  return countQuery();
}

export async function articleExists(db: Db, id: string): Promise<boolean> {
  const [r] = await db.select({ c: count() }).from(articles).where(eq(articles.id, id));
  return n(r?.c) > 0;
}

export async function insertArticle(db: Db, a: ArticleRow): Promise<void> {
  await db.insert(articles).values(a);
}

export async function updateArticle(db: Db, a: ArticleRow): Promise<void> {
  const { id, ...rest } = a;
  await db.update(articles).set(rest).where(eq(articles.id, id));
}

export async function deleteArticle(db: Db, id: string): Promise<void> {
  await db.delete(articles).where(eq(articles.id, id));
}

// ------------------------------------------------------------------ events

export async function findEvent(db: Db, id: string, forUpdate = false): Promise<EventRow | null> {
  const q = db.select().from(newsEvents).where(eq(newsEvents.id, id)).limit(1);
  const [r] = forUpdate ? await q.for('update') : await q;
  return r ?? null;
}

export async function eventExists(db: Db, id: string): Promise<boolean> {
  const [r] = await db.select({ c: count() }).from(newsEvents).where(eq(newsEvents.id, id));
  return n(r?.c) > 0;
}

/** findFiltered: ORDER BY event_date, start_time, id. */
export async function findEvents(db: Db, f: { category: string | null; organization: string | null; from: string; to: string }, page: PageRequest) {
  const conds: SQL[] = [sql`${newsEvents.eventDate} >= ${f.from}`, sql`${newsEvents.eventDate} <= ${f.to}`];
  if (f.category !== null) conds.push(eq(newsEvents.category, f.category));
  if (f.organization !== null) conds.push(eq(newsEvents.organization, f.organization));
  const where = and(...conds);
  const rows = await db.select().from(newsEvents).where(where)
    .orderBy(asc(newsEvents.eventDate), asc(newsEvents.startTime), asc(newsEvents.id)).limit(page.size).offset(pageOffset(page));
  const total = await pageTotal(rows.length, page, async () => {
    const [r] = await db.select({ c: count() }).from(newsEvents).where(where);
    return n(r?.c);
  });
  return { rows, total };
}

export async function insertEvent(db: Db, e: EventRow): Promise<void> {
  await db.insert(newsEvents).values(e);
}

export async function updateEvent(db: Db, e: EventRow): Promise<void> {
  const { id, createdAt: _c, ...rest } = e;
  await db.update(newsEvents).set(rest).where(eq(newsEvents.id, id));
}

export async function deleteEvent(db: Db, id: string): Promise<void> {
  await db.delete(newsEvents).where(eq(newsEvents.id, id));
}

/** findReminderDue. */
export async function reminderDue(db: Db, date: string): Promise<string[]> {
  const rows = await db.select({ id: newsEvents.id }).from(newsEvents)
    .where(and(eq(newsEvents.signupMode, 'rsvp'), eq(newsEvents.eventDate, date), isNull(newsEvents.reminderSentAt)))
    .orderBy(asc(newsEvents.id));
  return rows.map((r) => r.id);
}

export async function claimReminder(db: Db, id: string, now: Micros): Promise<number> {
  return (await db.update(newsEvents).set({ reminderSentAt: toPgTimestamp(now) })
    .where(and(eq(newsEvents.id, id), isNull(newsEvents.reminderSentAt))).returning({ id: newsEvents.id })).length;
}

// ------------------------------------------------------------------ rsvps

export async function countRsvps(db: Db, eventId: string): Promise<number> {
  const [r] = await db.select({ c: count() }).from(eventRsvps).where(eq(eventRsvps.eventId, eventId));
  return n(r?.c);
}

export async function rsvpExists(db: Db, eventId: string, userId: string): Promise<boolean> {
  const [r] = await db.select({ c: count() }).from(eventRsvps).where(and(eq(eventRsvps.eventId, eventId), eq(eventRsvps.userId, userId)));
  return n(r?.c) > 0;
}

export async function insertRsvp(db: Db, eventId: string, userId: string, now: Micros): Promise<void> {
  await db.insert(eventRsvps).values({ eventId, userId, createdAt: toPgTimestamp(now) });
}

export async function deleteRsvp(db: Db, eventId: string, userId: string): Promise<void> {
  await db.delete(eventRsvps).where(and(eq(eventRsvps.eventId, eventId), eq(eventRsvps.userId, userId)));
}

export function rsvpsOfEvent(db: Db, eventId: string): Promise<RsvpRow[]> {
  return db.select().from(eventRsvps).where(eq(eventRsvps.eventId, eventId)).orderBy(asc(eventRsvps.createdAt));
}

export async function rsvpUserIds(db: Db, eventId: string): Promise<string[]> {
  return (await db.select({ u: eventRsvps.userId }).from(eventRsvps).where(eq(eventRsvps.eventId, eventId))).map((r) => r.u);
}

export async function rsvpEventIdsOf(db: Db, userId: string): Promise<string[]> {
  return (await db.select({ e: eventRsvps.eventId }).from(eventRsvps).where(eq(eventRsvps.userId, userId))).map((r) => r.e);
}

/** countByEventIds: [eventId, count] for events with RSVPs. */
export async function rsvpCounts(db: Db, ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  const rows = await db.select({ e: eventRsvps.eventId, c: count() }).from(eventRsvps).where(inArray(eventRsvps.eventId, ids)).groupBy(eventRsvps.eventId);
  for (const r of rows) out.set(r.e, n(r.c));
  return out;
}

// ------------------------------------------------------------------ votes

export async function findVoteAgg(db: Db, articleId: string, forUpdate = false): Promise<VoteAggRow | null> {
  const q = db.select().from(articleVotes).where(eq(articleVotes.articleId, articleId)).limit(1);
  const [r] = forUpdate ? await q.for('update') : await q;
  return r ?? null;
}

export async function insertVoteAggIfAbsent(db: Db, articleId: string): Promise<void> {
  await db.execute(sql`INSERT INTO public.article_votes (article_id) VALUES (${articleId}) ON CONFLICT (article_id) DO NOTHING`);
}

export async function saveVoteAgg(db: Db, a: VoteAggRow): Promise<void> {
  await db.update(articleVotes).set({ upCount: a.upCount, downCount: a.downCount, updatedAt: a.updatedAt }).where(eq(articleVotes.articleId, a.articleId));
}

export async function findVoteRecord(db: Db, articleId: string, fingerprint: string): Promise<VoteRecordRow | null> {
  const [r] = await db.select().from(voteRecords).where(and(eq(voteRecords.articleId, articleId), eq(voteRecords.fingerprint, fingerprint))).limit(1);
  return r ?? null;
}

export async function deleteVoteRecord(db: Db, articleId: string, fingerprint: string): Promise<void> {
  await db.delete(voteRecords).where(and(eq(voteRecords.articleId, articleId), eq(voteRecords.fingerprint, fingerprint)));
}

export async function insertVoteRecord(db: Db, r: VoteRecordRow): Promise<void> {
  await db.insert(voteRecords).values(r);
}

// ------------------------------------------------------------------ analytics (one organization)

const ORG_VIEWS_WHERE = (org: string, since: string) => sql`ae.ts >= ${since}::timestamptz AND (
  (ae.type = 'article_view' AND ae.article_id IN (SELECT id FROM public.articles WHERE organization = ${org}))
  OR (ae.type = 'event_view' AND ae.event_id IN (SELECT id FROM public.news_events WHERE organization = ${org})))`;

export async function orgTotalsSince(db: Db, org: string, since: string): Promise<[number, number, number]> {
  const [r] = await rowsOf<{ a: unknown; e: unknown; s: unknown }>(db, sql`SELECT count(*) FILTER (WHERE ae.type = 'article_view') AS a,
      count(*) FILTER (WHERE ae.type = 'event_view') AS e, count(DISTINCT ae.session_id) AS s
    FROM public.analytics_events ae WHERE ${ORG_VIEWS_WHERE(org, since)}`);
  return [n(r?.a), n(r?.e), n(r?.s)];
}

export async function orgDailySince(db: Db, org: string, since: string): Promise<{ day: string; a: number; e: number }[]> {
  const rows = await rowsOf<{ day: string; a: unknown; e: unknown }>(db, sql`SELECT ((ae.ts AT TIME ZONE 'America/Argentina/Buenos_Aires')::date)::text AS day,
      count(*) FILTER (WHERE ae.type = 'article_view') AS a, count(*) FILTER (WHERE ae.type = 'event_view') AS e
    FROM public.analytics_events ae WHERE ${ORG_VIEWS_WHERE(org, since)} GROUP BY 1 ORDER BY 1`);
  return rows.map((r) => ({ day: r.day, a: n(r.a), e: n(r.e) }));
}

export async function orgTopArticlesSince(db: Db, org: string, since: string): Promise<{ id: string; title: string; views: number }[]> {
  const rows = await rowsOf<{ id: string; title: string; views: unknown }>(db, sql`SELECT a.id, a.title, count(*) AS views
    FROM public.analytics_events ae JOIN public.articles a ON a.id = ae.article_id
    WHERE ae.type = 'article_view' AND ae.ts >= ${since}::timestamptz AND a.organization = ${org}
    GROUP BY a.id, a.title ORDER BY views DESC, a.id LIMIT 10`);
  return rows.map((r) => ({ id: r.id, title: r.title, views: n(r.views) }));
}

export async function orgEventsSince(db: Db, org: string, since: string, fromDate: string) {
  const rows = await rowsOf<{ id: string; title: string; d: string; mode: string; capacity: number | null; rsvps: unknown; views: unknown }>(db, sql`
    SELECT e.id, e.title, e.event_date::text AS d, e.signup_mode AS mode, e.capacity,
      (SELECT count(*) FROM public.event_rsvps r WHERE r.event_id = e.id) AS rsvps,
      (SELECT count(*) FROM public.analytics_events ae WHERE ae.event_id = e.id AND ae.type = 'event_view' AND ae.ts >= ${since}::timestamptz) AS views
    FROM public.news_events e WHERE e.organization = ${org} AND e.event_date >= ${fromDate}::date
    ORDER BY e.event_date DESC, e.id LIMIT 20`);
  return rows.map((r) => ({ id: r.id, title: r.title, date: r.d, signupMode: r.mode, capacity: r.capacity == null ? null : Number(r.capacity), rsvps: n(r.rsvps), views: n(r.views) }));
}

export async function countFollowersBefore(db: Db, org: string, since: string): Promise<number> {
  const [r] = await rowsOf<{ c: unknown }>(db, sql`SELECT count(*) AS c FROM public.user_follows WHERE org_slug = ${org} AND created_at < ${since}::timestamptz`);
  return n(r?.c);
}

export async function dailyNewFollowersSince(db: Db, org: string, since: string): Promise<Map<string, number>> {
  const rows = await rowsOf<{ day: string; c: unknown }>(db, sql`SELECT ((created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date)::text AS day, count(*) AS c
    FROM public.user_follows WHERE org_slug = ${org} AND created_at >= ${since}::timestamptz GROUP BY 1 ORDER BY 1`);
  return new Map(rows.map((r) => [r.day, n(r.c)]));
}

export async function pushTotalsSince(db: Db, org: string, since: string): Promise<[number, number, number]> {
  const [r] = await rowsOf<{ p: unknown; t: unknown; s: unknown }>(db, sql`SELECT count(*) AS p, coalesce(sum(targeted), 0) AS t, coalesce(sum(sent), 0) AS s
    FROM public.push_log WHERE org_slug = ${org} AND created_at >= ${since}::timestamptz`);
  return [n(r?.p), n(r?.t), n(r?.s)];
}

export async function mailTotalsSince(db: Db, org: string, since: string): Promise<[number, number]> {
  const [r] = await rowsOf<{ a: unknown; r: unknown }>(db, sql`SELECT count(*) AS a, coalesce(sum(recipient_count), 0) AS r FROM public.org_announcements
    WHERE org_slug = ${org} AND status <> 'draft' AND sent_at >= ${since}::timestamptz`);
  return [n(r?.a), n(r?.r)];
}

export { analyticsEvents };

// ---------------------------------------------------------------- sitemap

/** ArticleRepository.SitemapRow: what /sitemap.xml needs of a published article, without its body. */
export interface SitemapRow { id: string; updatedAt: string | null; publishedAt: string | null }

/** ArticleRepository.findPublishedForSitemap: the anonymous list's set (status published). */
export function findPublishedForSitemap(db: Db, limit: number): Promise<SitemapRow[]> {
  return db.select({ id: articles.id, updatedAt: articles.updatedAt, publishedAt: articles.publishedAt })
    .from(articles).where(eq(articles.status, 'published'))
    .orderBy(desc(articles.createdAt), desc(articles.id)).limit(limit);
}

/** NewsEventRepository.findIdsForSitemap: every event the anonymous list shows within [from, to]. */
export async function findEventIdsForSitemap(db: Db, from: string, to: string, limit: number): Promise<string[]> {
  const rows = await db.select({ id: newsEvents.id }).from(newsEvents)
    .where(and(sql`${newsEvents.eventDate} >= ${from}`, sql`${newsEvents.eventDate} <= ${to}`))
    .orderBy(asc(newsEvents.eventDate), asc(newsEvents.startTime), asc(newsEvents.id)).limit(limit);
  return rows.map((r) => r.id);
}
