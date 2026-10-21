// repository/digest/* plus the queries of other packages the digest reads
// (ArticleRepository.findPublishedBetween, NewsEventRepository.findDigestCandidates,
// UserRepository digest audience, UserFollowRepository, CommissionRepository,
// SavedScheduleRepository, KbPageRepository.findPublishedHeads,
// ScheduleCorrection(Vote)Repository). Native SQL, bound parameters.

import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { formatPgTime, parsePgTimestamp, toPgTimestamp, type Micros } from '../../lib/time';
import type { LocalDate } from '../../lib/javaCompat';
import type { Commission, SubjectType } from '../commission/logic/types';
import type { CorrectionSlot } from './logic/personal/types';

const ts = (us: Micros) => sql`${toPgTimestamp(us)}::timestamptz`;
const rows = async <T>(db: Db, q: SQL): Promise<T[]> => (await db.execute(q)) as unknown as T[];
const count = async (db: Db, q: SQL): Promise<number> => (await db.execute(q) as unknown as { count: number }).count;
const uuidArray = (ids: readonly string[]) => sql`${`{${ids.join(',')}}`}::uuid[]`;
const textArray = (ids: readonly string[]) => sql`${`{${ids.map((s) => `"${s.replace(/["\\]/g, (c) => `\\${c}`)}"`).join(',')}}`}::text[]`;
const tsOrNull = (pg: string | null) => (pg == null ? null : parsePgTimestamp(pg));

// ------------------------------------------------------------ digest_issues

export interface IssueRow {
  id: string;
  weekStart: LocalDate;
  subject: string;
  intro: string | null;
  excludedArticleIds: string[];
  excludedEventIds: string[];
  status: string;
  autoSendAt: Micros | null;
  sentAt: Micros | null;
  sentBy: string | null;
  createdAt: Micros | null;
}

interface RawIssue {
  id: string; week_start: string; subject: string; intro: string | null; excluded_article_ids: string[] | string;
  excluded_event_ids: string[] | string; status: string; auto_send_at: string | null; sent_at: string | null;
  sent_by: string | null; created_at: string | null;
}

/** text[] arrives as a JS array (postgres.js) or as `{a,b}` text. */
function pgArray(v: string[] | string | null): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v;
  if (v === '{}') return [];
  const out: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|([^,{}]+)/g;
  for (const m of v.slice(1, -1).matchAll(re)) out.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2]!);
  return out;
}

const issue = (r: RawIssue): IssueRow => ({
  id: r.id, weekStart: r.week_start, subject: r.subject, intro: r.intro,
  excludedArticleIds: pgArray(r.excluded_article_ids), excludedEventIds: pgArray(r.excluded_event_ids),
  status: r.status, autoSendAt: tsOrNull(r.auto_send_at), sentAt: tsOrNull(r.sent_at), sentBy: r.sent_by,
  createdAt: tsOrNull(r.created_at),
});

const ISSUE_COLS = sql`id, week_start::text AS week_start, subject, intro, excluded_article_ids, excluded_event_ids, status,
                       auto_send_at, sent_at, sent_by, created_at`;

export async function findAllIssuesByWeekDesc(db: Db): Promise<IssueRow[]> {
  return (await rows<RawIssue>(db, sql`SELECT ${ISSUE_COLS} FROM public.digest_issues ORDER BY week_start DESC`)).map(issue);
}

export async function findIssue(db: Db, id: string, forUpdate = false): Promise<IssueRow | null> {
  const [r] = await rows<RawIssue>(db, forUpdate
    ? sql`SELECT ${ISSUE_COLS} FROM public.digest_issues WHERE id = ${id} FOR UPDATE`
    : sql`SELECT ${ISSUE_COLS} FROM public.digest_issues WHERE id = ${id}`);
  return r ? issue(r) : null;
}

export async function existsByWeekStart(db: Db, weekStart: LocalDate): Promise<boolean> {
  const [r] = await rows<{ ok: boolean }>(db, sql`SELECT EXISTS (SELECT 1 FROM public.digest_issues WHERE week_start = ${weekStart}::date) AS ok`);
  return Boolean(r?.ok);
}

/** saveAndFlush(new DigestIssue(...)): every column; created/updated = now. */
export async function insertIssue(db: Db, i: { id: string; weekStart: LocalDate; subject: string; autoSendAt: string | null }, now: Micros): Promise<void> {
  await db.execute(sql`
    INSERT INTO public.digest_issues (id, week_start, subject, intro, excluded_article_ids, excluded_event_ids, status,
                                      auto_send_at, sent_at, sent_by, created_at, updated_at)
    VALUES (${i.id}, ${i.weekStart}::date, ${i.subject}, NULL, '{}'::text[], '{}'::text[], 'draft',
            ${i.autoSendAt}::timestamptz, NULL, NULL, ${ts(now)}, ${ts(now)})`);
}

/** The dirty entity flushed (Hibernate updates every column; @UpdateTimestamp). */
export async function updateIssue(db: Db, i: { id: string; subject: string; intro: string | null; excludedArticleIds: string[];
  excludedEventIds: string[]; status: string; autoSendAt: string | null; sentBy: string | null }, now: Micros): Promise<void> {
  await db.execute(sql`
    UPDATE public.digest_issues SET subject = ${i.subject}, intro = ${i.intro}, excluded_article_ids = ${textArray(i.excludedArticleIds)},
      excluded_event_ids = ${textArray(i.excludedEventIds)}, status = ${i.status}, auto_send_at = ${i.autoSendAt}::timestamptz,
      sent_by = ${i.sentBy}, updated_at = ${ts(now)}
    WHERE id = ${i.id}`);
}

export async function deleteIssue(db: Db, id: string): Promise<void> {
  await db.execute(sql`DELETE FROM public.digest_issues WHERE id = ${id}`);
}

export async function findDueForAutoSend(db: Db, now: Micros, notBefore: Micros): Promise<string[]> {
  return (await rows<{ id: string }>(db, sql`
    SELECT id FROM public.digest_issues
    WHERE status = 'draft' AND auto_send_at IS NOT NULL AND auto_send_at <= ${ts(now)} AND auto_send_at >= ${ts(notBefore)}
    ORDER BY week_start ASC`)).map((r) => r.id);
}

export async function findSendingIds(db: Db): Promise<string[]> {
  return (await rows<{ id: string }>(db, sql`SELECT id FROM public.digest_issues WHERE status = 'sending' ORDER BY week_start ASC`)).map((r) => r.id);
}

export function markIssueSentIfDone(db: Db, id: string, now: Micros): Promise<number> {
  return count(db, sql`
    UPDATE public.digest_issues SET status = 'sent', sent_at = ${ts(now)}, updated_at = ${ts(now)}
    WHERE id = ${id} AND status = 'sending'
      AND NOT EXISTS (SELECT 1 FROM public.digest_deliveries d WHERE d.issue_id = ${id} AND d.status IN ('pending', 'sending'))`);
}

export async function findStatusForShare(db: Db, id: string): Promise<string | null> {
  const [r] = await rows<{ status: string }>(db, sql`SELECT status FROM public.digest_issues WHERE id = ${id} FOR SHARE`);
  return r?.status ?? null;
}

// ------------------------------------------------------------ digest_deliveries

export interface DeliveryRow {
  issueId: string; userId: string; email: string; status: string; sentAt: Micros | null; trackingId: string | null; attempts: number;
}

interface RawDelivery { issue_id: string; user_id: string; email: string; status: string; sent_at: string | null; tracking_id: string | null; attempts: number }
const delivery = (r: RawDelivery): DeliveryRow => ({
  issueId: r.issue_id, userId: r.user_id, email: r.email, status: r.status, sentAt: tsOrNull(r.sent_at),
  trackingId: r.tracking_id, attempts: Number(r.attempts),
});

export async function countByIssueAndStatus(db: Db, issueIds: string[]): Promise<{ issueId: string; status: string; n: number }[]> {
  if (issueIds.length === 0) return [];
  return (await rows<{ issue_id: string; status: string; n: number }>(db, sql`
    SELECT issue_id, status, COUNT(*)::bigint AS n FROM public.digest_deliveries
    WHERE issue_id = ANY(${uuidArray(issueIds)}) GROUP BY issue_id, status`))
    .map((r) => ({ issueId: r.issue_id, status: r.status, n: Number(r.n) }));
}

/** saveAll of the snapshot (Persistable: plain inserts, every column). */
export async function insertDeliveries(db: Db, issueId: string, recipients: { userId: string; email: string }[]): Promise<void> {
  for (let i = 0; i < recipients.length; i += 500) {
    const batch = recipients.slice(i, i + 500);
    const values = sql.join(batch.map((r) => sql`(${issueId}, ${r.userId}, ${r.email}, 'pending', NULL, NULL, NULL, 0, NULL, NULL,
      NULL, NULL, 0, NULL, 0)`), sql`, `);
    await db.execute(sql`
      INSERT INTO public.digest_deliveries (issue_id, user_id, email, status, error, sent_at, claimed_at, attempts, last_error,
        tracking_id, first_opened_at, last_opened_at, open_count, first_clicked_at, click_count)
      VALUES ${values}`);
  }
}

export async function lockNextPending(db: Db, issueId: string, retryBefore: Micros): Promise<DeliveryRow | null> {
  const [r] = await rows<RawDelivery>(db, sql`
    SELECT issue_id, user_id, email, status, sent_at, tracking_id, attempts FROM public.digest_deliveries
    WHERE issue_id = ${issueId} AND status = 'pending' AND (claimed_at IS NULL OR claimed_at <= ${ts(retryBefore)})
    ORDER BY attempts ASC, user_id ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED`);
  return r ? delivery(r) : null;
}

export function markSending(db: Db, issueId: string, userId: string, now: Micros): Promise<number> {
  return count(db, sql`UPDATE public.digest_deliveries SET status = 'sending', claimed_at = ${ts(now)}
                       WHERE issue_id = ${issueId} AND user_id = ${userId} AND status = 'pending'`);
}

export function markSent(db: Db, issueId: string, userId: string, now: Micros): Promise<number> {
  return count(db, sql`UPDATE public.digest_deliveries SET status = 'sent', sent_at = ${ts(now)}, error = NULL
                       WHERE issue_id = ${issueId} AND user_id = ${userId} AND status = 'sending'`);
}

export function markFailed(db: Db, issueId: string, userId: string, now: Micros, error: string): Promise<number> {
  return count(db, sql`UPDATE public.digest_deliveries SET status = 'failed', sent_at = ${ts(now)}, error = ${error}
                       WHERE issue_id = ${issueId} AND user_id = ${userId} AND status = 'sending'`);
}

export function retryLater(db: Db, issueId: string, userId: string, error: string): Promise<number> {
  return count(db, sql`UPDATE public.digest_deliveries SET status = 'pending', attempts = attempts + 1, last_error = ${error}
                       WHERE issue_id = ${issueId} AND user_id = ${userId} AND status = 'sending'`);
}

export function release(db: Db, issueId: string, userId: string, error: string): Promise<number> {
  return count(db, sql`UPDATE public.digest_deliveries SET status = 'pending', claimed_at = NULL, last_error = ${error}
                       WHERE issue_id = ${issueId} AND user_id = ${userId} AND status = 'sending'`);
}

export function failStale(db: Db, cutoff: Micros, error: string): Promise<number> {
  return count(db, sql`UPDATE public.digest_deliveries SET status = 'failed', sent_at = claimed_at, error = ${error}
                       WHERE status = 'sending' AND claimed_at < ${ts(cutoff)}`);
}

export function deleteClaimed(db: Db, issueId: string, userId: string): Promise<number> {
  return count(db, sql`DELETE FROM public.digest_deliveries WHERE issue_id = ${issueId} AND user_id = ${userId} AND status = 'sending'`);
}

export function deleteAllPending(db: Db, issueId: string): Promise<number> {
  return count(db, sql`DELETE FROM public.digest_deliveries WHERE issue_id = ${issueId} AND status = 'pending'`);
}

export function setTrackingId(db: Db, issueId: string, userId: string, trackingId: string): Promise<number> {
  return count(db, sql`UPDATE public.digest_deliveries SET tracking_id = ${trackingId}
                       WHERE issue_id = ${issueId} AND user_id = ${userId} AND status = 'sending'`);
}

export async function findDeliveryByTrackingId(db: Db, trackingId: string): Promise<DeliveryRow | null> {
  const [r] = await rows<RawDelivery>(db, sql`
    SELECT issue_id, user_id, email, status, sent_at, tracking_id, attempts FROM public.digest_deliveries WHERE tracking_id = ${trackingId}`);
  return r ? delivery(r) : null;
}

export async function recordOpen(db: Db, trackingId: string, now: Micros): Promise<void> {
  await db.execute(sql`
    UPDATE public.digest_deliveries SET open_count = open_count + 1, first_opened_at = COALESCE(first_opened_at, ${ts(now)}),
      last_opened_at = ${ts(now)}
    WHERE tracking_id = ${trackingId}`);
}

export async function recordClick(db: Db, trackingId: string, now: Micros): Promise<void> {
  await db.execute(sql`
    UPDATE public.digest_deliveries SET click_count = click_count + 1, first_clicked_at = COALESCE(first_clicked_at, ${ts(now)}),
      first_opened_at = COALESCE(first_opened_at, ${ts(now)}), last_opened_at = COALESCE(last_opened_at, ${ts(now)}),
      open_count = CASE WHEN open_count = 0 THEN 1 ELSE open_count END
    WHERE tracking_id = ${trackingId}`);
}

export async function engagementByIssue(db: Db, issueIds: string[]): Promise<{ issueId: string; delivered: number; opened: number; clicked: number }[]> {
  if (issueIds.length === 0) return [];
  return (await rows<{ issue_id: string; d: number; o: number; c: number }>(db, sql`
    SELECT issue_id,
           SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END)::bigint AS d,
           SUM(CASE WHEN status = 'sent' AND first_opened_at IS NOT NULL THEN 1 ELSE 0 END)::bigint AS o,
           SUM(CASE WHEN status = 'sent' AND first_clicked_at IS NOT NULL THEN 1 ELSE 0 END)::bigint AS c
    FROM public.digest_deliveries WHERE issue_id = ANY(${uuidArray(issueIds)}) GROUP BY issue_id`))
    .map((r) => ({ issueId: r.issue_id, delivered: Number(r.d ?? 0), opened: Number(r.o ?? 0), clicked: Number(r.c ?? 0) }));
}

export async function firstOpensByHour(db: Db, issueId: string): Promise<{ epochSecond: number; n: number }[]> {
  return (await rows<{ h: number; n: number }>(db, sql`
    SELECT CAST(EXTRACT(EPOCH FROM date_trunc('hour', d.first_opened_at)) AS BIGINT) AS h, COUNT(*)::bigint AS n
    FROM public.digest_deliveries d
    WHERE d.issue_id = ${issueId} AND d.status = 'sent' AND d.first_opened_at IS NOT NULL
    GROUP BY 1 ORDER BY 1`)).map((r) => ({ epochSecond: Number(r.h), n: Number(r.n) }));
}

// ------------------------------------------------------------ links

export async function findIssueLinks(db: Db, issueId: string): Promise<{ linkId: number; url: string }[]> {
  return (await rows<{ link_id: number; url: string }>(db, sql`
    SELECT link_id, url FROM public.digest_issue_links WHERE issue_id = ${issueId} ORDER BY link_id ASC`))
    .map((r) => ({ linkId: Number(r.link_id), url: r.url }));
}

export async function insertIssueLink(db: Db, issueId: string, linkId: number, url: string, urlKey: string, label: string): Promise<void> {
  await db.execute(sql`INSERT INTO public.digest_issue_links (issue_id, link_id, url, url_key, label)
                       VALUES (${issueId}, ${linkId}, ${url}, ${urlKey}, ${label})`);
}

export async function findIssueLinkUrl(db: Db, issueId: string, linkId: number): Promise<string | null> {
  const [r] = await rows<{ url: string }>(db, sql`SELECT url FROM public.digest_issue_links WHERE issue_id = ${issueId} AND link_id = ${linkId}`);
  return r?.url ?? null;
}

export async function findDeliveryLinkUrl(db: Db, trackingId: string, linkId: number): Promise<string | null> {
  const [r] = await rows<{ url: string }>(db, sql`SELECT url FROM public.digest_delivery_links WHERE tracking_id = ${trackingId} AND link_id = ${linkId}`);
  return r?.url ?? null;
}

export async function replaceDeliveryLinks(db: Db, trackingId: string, links: { id: number; url: string; urlKey: string; label: string }[]): Promise<void> {
  await db.execute(sql`DELETE FROM public.digest_delivery_links WHERE tracking_id = ${trackingId}`);
  for (const l of links) {
    await db.execute(sql`INSERT INTO public.digest_delivery_links (tracking_id, link_id, url, url_key, label)
                         VALUES (${trackingId}, ${l.id}, ${l.url}, ${l.urlKey}, ${l.label})`);
  }
}

export async function clicksByLink(db: Db, issueId: string): Promise<{ urlKey: string; label: string; unique: number; total: number }[]> {
  return (await rows<{ url_key: string; label: string; u: number; t: number }>(db, sql`
    SELECT l.url_key, MIN(l.label) AS label, COUNT(DISTINCT e.tracking_id)::bigint AS u, COUNT(*)::bigint AS t
    FROM public.mail_tracking_event e
    JOIN public.digest_deliveries d ON d.tracking_id = e.tracking_id
    JOIN (
        SELECT CAST(NULL AS TEXT) AS tracking_id, il.link_id, il.url_key, il.label
        FROM public.digest_issue_links il WHERE il.issue_id = ${issueId}
        UNION ALL
        SELECT dl.tracking_id, dl.link_id, dl.url_key, dl.label
        FROM public.digest_delivery_links dl
        JOIN public.digest_deliveries dd ON dd.tracking_id = dl.tracking_id
        WHERE dd.issue_id = ${issueId}
    ) l ON l.link_id = e.link_id AND (l.tracking_id IS NULL OR l.tracking_id = e.tracking_id)
    WHERE d.issue_id = ${issueId} AND e.type = 'click' AND e.flagged = false
    GROUP BY l.url_key
    ORDER BY 3 DESC, 4 DESC, 1 ASC`)).map((r) => ({ urlKey: r.url_key, label: r.label, unique: Number(r.u), total: Number(r.t) }));
}

// ------------------------------------------------------------ content candidates

export interface CandidateArticle {
  id: string; title: string; excerpt: string | null; coverImage: string | null; publishedAt: LocalDate | null;
  orgSlug: string | null; orgName: string | null;
}

export async function findPublishedArticlesBetween(db: Db, from: LocalDate, to: LocalDate): Promise<CandidateArticle[]> {
  return (await rows<{ id: string; title: string; excerpt: string | null; cover_image: string | null; published_at: string | null;
    slug: string | null; name: string | null }>(db, sql`
    SELECT a.id, a.title, a.excerpt, a.cover_image, a.published_at::text AS published_at, o.slug, o.name
    FROM public.articles a LEFT JOIN public.organizations o ON o.slug = a.organization
    WHERE a.status = 'published' AND a.published_at >= ${from}::date AND a.published_at <= ${to}::date
    ORDER BY a.published_at DESC, a.created_at DESC, a.id ASC`))
    .map((r) => ({ id: r.id, title: r.title, excerpt: r.excerpt, coverImage: r.cover_image, publishedAt: r.published_at,
      orgSlug: r.slug, orgName: r.name }));
}

export interface CandidateEvent {
  id: string; title: string; eventDate: LocalDate; startTime: string | null; endTime: string | null; location: string | null;
  orgSlug: string | null; orgName: string | null; signupMode: string;
}

export async function findDigestEventCandidates(db: Db, from: LocalDate, to: LocalDate, announcedFrom: Micros, announcedTo: Micros): Promise<CandidateEvent[]> {
  return (await rows<{ id: string; title: string; event_date: string; start_time: string | null; end_time: string | null;
    location: string | null; slug: string | null; name: string | null; signup_mode: string }>(db, sql`
    SELECT e.id, e.title, e.event_date::text AS event_date, e.start_time::text AS start_time, e.end_time::text AS end_time,
           e.location, o.slug, o.name, e.signup_mode
    FROM public.news_events e LEFT JOIN public.organizations o ON o.slug = e.organization
    WHERE e.event_date >= ${from}::date
      AND (e.event_date <= ${to}::date OR (e.created_at >= ${ts(announcedFrom)} AND e.created_at < ${ts(announcedTo)}))
    ORDER BY e.event_date ASC, e.start_time ASC, e.id ASC`))
    .map((r) => ({ id: r.id, title: r.title, eventDate: r.event_date, startTime: formatPgTime(r.start_time), endTime: formatPgTime(r.end_time),
      location: r.location, orgSlug: r.slug, orgName: r.name, signupMode: r.signup_mode }));
}

// ------------------------------------------------------------ users / audience / follows

export interface AudienceUser { id: string; email: string; digestEmailEnabled: boolean }

export async function findDigestAudience(db: Db, orgSlug: string): Promise<{ id: string; email: string }[]> {
  return rows(db, sql`
    SELECT u.id, u.email FROM public."user" u
    WHERE u.digest_email_enabled = true
      AND EXISTS (SELECT 1 FROM public.user_follows f WHERE f.user_id = u.id AND f.org_slug = ${orgSlug})
    ORDER BY u.id`);
}

/** UserRepository.countDigestAudienceWithCapability (JPQL SUBSTRING/LOCATE on the trimmed email). */
export async function countDigestAudienceWithCapability(db: Db, orgSlug: string, domains: string[], capability: string, now: Micros): Promise<number> {
  const [r] = await rows<{ n: number }>(db, sql`
    SELECT COUNT(*)::bigint AS n FROM public."user" u
    WHERE u.digest_email_enabled = true
      AND EXISTS (SELECT 1 FROM public.user_follows f WHERE f.user_id = u.id AND f.org_slug = ${orgSlug})
      AND substring(lower(trim(both from u.email)), position('@' in trim(both from u.email)) + 1) = ANY(${textArray(domains)})
      AND (EXISTS (SELECT 1 FROM public.capability_settings s WHERE s.capability = ${capability} AND s.enabled_for_all = true)
        OR EXISTS (SELECT 1 FROM public.ceitba_staff cs WHERE cs.user_id = u.id AND cs.start <= ${ts(now)} AND cs."end" >= ${ts(now)})
        OR EXISTS (SELECT 1 FROM public.capability_user_grants g WHERE g.capability = ${capability} AND g.email = lower(u.email))
        OR EXISTS (SELECT 1 FROM public.capability_org_grants og, public.user_organizations m
                   WHERE og.capability = ${capability} AND m.org_slug = og.org_slug AND m.user_id = u.id))`);
  return Number(r?.n ?? 0);
}

export async function findUser(db: Db, id: string): Promise<AudienceUser | null> {
  const [r] = await rows<{ id: string; email: string; digest_email_enabled: boolean }>(db, sql`
    SELECT id, email, digest_email_enabled FROM public."user" WHERE id = ${id}`);
  return r ? { id: r.id, email: r.email, digestEmailEnabled: r.digest_email_enabled } : null;
}

export async function findUsersByIds(db: Db, ids: string[]): Promise<{ id: string; email: string }[]> {
  if (ids.length === 0) return [];
  return rows(db, sql`SELECT id, email FROM public."user" WHERE id = ANY(${uuidArray(ids)})`);
}

export async function setDigestEmailEnabled(db: Db, id: string, enabled: boolean): Promise<void> {
  await db.execute(sql`UPDATE public."user" SET digest_email_enabled = ${enabled} WHERE id = ${id}`);
}

export async function isFollowing(db: Db, userId: string, orgSlug: string): Promise<boolean> {
  const [r] = await rows<{ ok: boolean }>(db, sql`
    SELECT EXISTS (SELECT 1 FROM public.user_follows WHERE user_id = ${userId} AND org_slug = ${orgSlug}) AS ok`);
  return Boolean(r?.ok);
}

/** FollowService.followIfMissing */
export async function followIfMissing(db: Db, userId: string, orgSlug: string, now: Micros): Promise<void> {
  const [org] = await rows<{ ok: boolean }>(db, sql`SELECT EXISTS (SELECT 1 FROM public.organizations WHERE slug = ${orgSlug}) AS ok`);
  if (!org?.ok) return;
  if (await isFollowing(db, userId, orgSlug)) return;
  await db.execute(sql`INSERT INTO public.user_follows (user_id, org_slug, created_at) VALUES (${userId}, ${orgSlug}, ${ts(now)})`);
}

// ------------------------------------------------------------ "Tu cuatrimestre"

export interface CommissionWithTimes extends Commission {
  times: { day: string; hourFrom: string; hourTo: string }[];
}

export async function existsRunningOrStartingBy(db: Db, today: LocalDate, startsBy: LocalDate): Promise<boolean> {
  const [r] = await rows<{ ok: boolean }>(db, sql`
    SELECT COUNT(*) > 0 AS ok FROM public.commission c WHERE c.course_end >= ${today}::date AND c.course_start <= ${startsBy}::date`);
  return Boolean(r?.ok);
}

async function withTimes(db: Db, list: Omit<CommissionWithTimes, 'times'>[]): Promise<CommissionWithTimes[]> {
  if (list.length === 0) return [];
  const times = await rows<{ course_id: string; day: string; hour_from: string; hour_to: string }>(db, sql`
    SELECT course_id, day::text AS day, hour_from::text AS hour_from, hour_to::text AS hour_to FROM public.commission_time
    WHERE course_id = ANY(${textArray(list.map((c) => c.id))})`);
  const by = new Map<string, CommissionWithTimes['times']>();
  for (const t of times) {
    let l = by.get(t.course_id);
    if (!l) by.set(t.course_id, (l = []));
    l.push({ day: t.day, hourFrom: formatPgTime(t.hour_from)!, hourTo: formatPgTime(t.hour_to)! });
  }
  return list.map((c) => ({ ...c, times: by.get(c.id) ?? [] }));
}

interface RawCommission { id: string; subject_code: string; commission_name: string; course_start: string; course_end: string;
  enrolled_students: number; quota: number; subject_type: string }
const commission = (r: RawCommission): Omit<CommissionWithTimes, 'times'> => ({
  id: r.id, subjectCode: r.subject_code, commissionName: r.commission_name, courseStart: r.course_start, courseEnd: r.course_end,
  enrolledStudents: Number(r.enrolled_students), quota: Number(r.quota), subjectType: r.subject_type as SubjectType,
});
const COMMISSION_COLS = sql`id, subject_code, commission_name, course_start::text AS course_start, course_end::text AS course_end,
                            enrolled_students, quota, subject_type::text AS subject_type`;

export async function findCommissionsBySubjectCodesWithTimes(db: Db, codes: string[]): Promise<CommissionWithTimes[]> {
  if (codes.length === 0) return [];
  return withTimes(db, (await rows<RawCommission>(db, sql`
    SELECT ${COMMISSION_COLS} FROM public.commission WHERE subject_code = ANY(${textArray(codes)})
    ORDER BY subject_code, course_start, commission_name, id`)).map(commission));
}

export async function findCommissionWithTimes(db: Db, id: string, forUpdate = false): Promise<CommissionWithTimes | null> {
  const [r] = await rows<RawCommission>(db, forUpdate
    ? sql`SELECT ${COMMISSION_COLS} FROM public.commission WHERE id = ${id} FOR UPDATE`
    : sql`SELECT ${COMMISSION_COLS} FROM public.commission WHERE id = ${id}`);
  if (!r) return null;
  return (await withTimes(db, [commission(r)]))[0]!;
}

export async function findPrimarySchedules(db: Db, userIds: string[]): Promise<{ userId: string; payload: unknown; payloadUpdatedAt: Micros | null }[]> {
  if (userIds.length === 0) return [];
  return (await rows<{ user_id: string; payload: unknown; payload_updated_at: string | null }>(db, sql`
    SELECT user_id, payload, payload_updated_at FROM public.saved_schedules WHERE user_id = ANY(${uuidArray(userIds)}) AND is_primary = true`))
    .map((r) => ({ userId: r.user_id, payload: typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload,
      payloadUpdatedAt: tsOrNull(r.payload_updated_at) }));
}

export async function findSubjectNames(db: Db, codes: string[]): Promise<Map<string, string>> {
  if (codes.length === 0) return new Map();
  const list = await rows<{ id: string; name: string }>(db, sql`SELECT id, name FROM public.subject WHERE id = ANY(${textArray(codes)})`);
  return new Map(list.map((r) => [r.id, r.name]));
}

export async function findSubjectName(db: Db, code: string): Promise<string | null> {
  const [r] = await rows<{ name: string }>(db, sql`SELECT name FROM public.subject WHERE id = ${code}`);
  return r?.name ?? null;
}

export async function findPublishedHeads(db: Db, codes: string[]): Promise<{ subjectId: string; slug: string; type: string; generatedAt: Micros }[]> {
  if (codes.length === 0) return [];
  return (await rows<{ subject_id: string; slug: string; type: string; generated_at: string }>(db, sql`
    SELECT subject_id, slug, type, generated_at FROM wiki.kb_page WHERE subject_id = ANY(${textArray(codes)}) AND status = 'PUBLISHED'`))
    .map((r) => ({ subjectId: r.subject_id, slug: r.slug, type: r.type, generatedAt: parsePgTimestamp(r.generated_at) }));
}

export interface CorrectionRow {
  id: string; commissionId: string; suggesterId: string | null; proposedSlots: CorrectionSlot[]; status: string;
  confirmCount: number; rejectCount: number; createdAt: Micros | null; appliedAt: Micros | null; reviewedByStaff: boolean;
}

interface RawCorrection { id: string; commission_id: string; suggester_id: string | null; proposed_slots: unknown; status: string;
  confirm_count: number; reject_count: number; created_at: string | null; applied_at: string | null; reviewed_by_staff: boolean }

function slotsOf(v: unknown): CorrectionSlot[] {
  const a = typeof v === 'string' ? JSON.parse(v) : v;
  return Array.isArray(a) ? a.map((s: Record<string, unknown>) => ({ day: s.day as string, from: s.from as string, to: s.to as string })) : [];
}

const correction = (r: RawCorrection): CorrectionRow => ({
  id: r.id, commissionId: r.commission_id, suggesterId: r.suggester_id, proposedSlots: slotsOf(r.proposed_slots), status: r.status,
  confirmCount: Number(r.confirm_count), rejectCount: Number(r.reject_count), createdAt: tsOrNull(r.created_at),
  appliedAt: tsOrNull(r.applied_at), reviewedByStaff: r.reviewed_by_staff,
});
const CORRECTION_COLS = sql`id, commission_id, suggester_id, proposed_slots, status, confirm_count, reject_count, created_at,
                            applied_at, reviewed_by_staff`;

export async function findCorrectionsByCommissionsAndStatus(db: Db, commissionIds: string[], statuses: string[]): Promise<CorrectionRow[]> {
  if (commissionIds.length === 0) return [];
  return (await rows<RawCorrection>(db, sql`
    SELECT ${CORRECTION_COLS} FROM public.schedule_correction
    WHERE commission_id = ANY(${textArray(commissionIds)}) AND status = ANY(${textArray(statuses)})`)).map(correction);
}

export async function findCorrection(db: Db, id: string): Promise<CorrectionRow | null> {
  const [r] = await rows<RawCorrection>(db, sql`SELECT ${CORRECTION_COLS} FROM public.schedule_correction WHERE id = ${id}`);
  return r ? correction(r) : null;
}

export async function findCorrectionCommissionId(db: Db, id: string): Promise<string | null> {
  const [r] = await rows<{ commission_id: string }>(db, sql`SELECT commission_id FROM public.schedule_correction WHERE id = ${id}`);
  return r?.commission_id ?? null;
}

export async function findVotesOf(db: Db, userIds: string[], correctionIds: string[]): Promise<{ userId: string; correctionId: string }[]> {
  if (userIds.length === 0 || correctionIds.length === 0) return [];
  return (await rows<{ user_id: string; correction_id: string }>(db, sql`
    SELECT user_id, correction_id FROM public.schedule_correction_vote
    WHERE user_id = ANY(${uuidArray(userIds)}) AND correction_id = ANY(${uuidArray(correctionIds)})`))
    .map((r) => ({ userId: r.user_id, correctionId: r.correction_id }));
}

export async function findVoteType(db: Db, correctionId: string, userId: string): Promise<string | null> {
  const [r] = await rows<{ type: string }>(db, sql`
    SELECT type FROM public.schedule_correction_vote WHERE correction_id = ${correctionId} AND user_id = ${userId}`);
  return r?.type ?? null;
}

export async function insertVote(db: Db, correctionId: string, userId: string, type: string, now: Micros): Promise<void> {
  await db.execute(sql`INSERT INTO public.schedule_correction_vote (correction_id, user_id, type, created_at, updated_at)
                       VALUES (${correctionId}, ${userId}, ${type}, ${ts(now)}, ${ts(now)})`);
}

export async function updateVote(db: Db, correctionId: string, userId: string, type: string, now: Micros): Promise<void> {
  await db.execute(sql`UPDATE public.schedule_correction_vote SET type = ${type}, updated_at = ${ts(now)}
                       WHERE correction_id = ${correctionId} AND user_id = ${userId}`);
}

export async function countVotes(db: Db, correctionId: string, type: string): Promise<number> {
  const [r] = await rows<{ n: number }>(db, sql`
    SELECT COUNT(*)::bigint AS n FROM public.schedule_correction_vote WHERE correction_id = ${correctionId} AND type = ${type}`);
  return Number(r?.n ?? 0);
}

export async function updateCorrectionState(db: Db, id: string, s: { status: string; confirmCount: number; rejectCount: number;
  appliedAt: Micros | null }, now: Micros): Promise<void> {
  await db.execute(sql`
    UPDATE public.schedule_correction SET status = ${s.status}, confirm_count = ${s.confirmCount}, reject_count = ${s.rejectCount},
      applied_at = ${s.appliedAt == null ? null : toPgTimestamp(s.appliedAt)}::timestamptz, updated_at = ${ts(now)}
    WHERE id = ${id}`);
}

export async function supersedeOtherApplied(db: Db, commissionId: string, keepId: string, now: Micros): Promise<void> {
  await db.execute(sql`
    UPDATE public.schedule_correction SET status = 'SUPERSEDED', updated_at = ${ts(now)}
    WHERE commission_id = ${commissionId} AND status = 'APPLIED' AND id <> ${keepId}`);
}
