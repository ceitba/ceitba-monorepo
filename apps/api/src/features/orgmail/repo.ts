// repository/orgmail/* (+ OrganizationRepository reads the service needs).

import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { parsePgTimestamp, toPgTimestamp, type Micros } from '../../lib/time';

const ts = (us: Micros) => sql`${toPgTimestamp(us)}::timestamptz`;
const rows = async <T>(db: Db, q: SQL): Promise<T[]> => (await db.execute(q)) as unknown as T[];
const count = async (db: Db, q: SQL): Promise<number> => (await db.execute(q) as unknown as { count: number }).count;
const textArray = (v: readonly string[]) => sql`${`{${v.map((s) => `"${s.replace(/["\\]/g, (c) => `\\${c}`)}"`).join(',')}}`}::text[]`;

export interface OrgRow { slug: string; name: string; color: string | null; contactEmail: string | null }

export async function findOrg(db: Db, slug: string, forUpdate = false): Promise<OrgRow | null> {
  const [r] = await rows<{ slug: string; name: string; color: string | null; contact_email: string | null }>(db, forUpdate
    ? sql`SELECT slug, name, color, contact_email FROM public.organizations WHERE slug = ${slug} FOR UPDATE`
    : sql`SELECT slug, name, color, contact_email FROM public.organizations WHERE slug = ${slug}`);
  return r ? { slug: r.slug, name: r.name, color: r.color, contactEmail: r.contact_email } : null;
}

export interface AnnouncementRow {
  id: number; orgSlug: string; subject: string; body: string; status: string; senderEmail: string | null;
  recipientCount: number | null; createdBy: string | null; createdAt: string; sentAt: string | null; finishedAt: string | null;
}

interface Raw { id: number; org_slug: string; subject: string; body: string; status: string; sender_email: string | null;
  recipient_count: number | null; created_by: string | null; created_at: string; sent_at: string | null; finished_at: string | null }
const row = (r: Raw): AnnouncementRow => ({
  id: Number(r.id), orgSlug: r.org_slug, subject: r.subject, body: r.body, status: r.status, senderEmail: r.sender_email,
  recipientCount: r.recipient_count == null ? null : Number(r.recipient_count), createdBy: r.created_by, createdAt: r.created_at,
  sentAt: r.sent_at, finishedAt: r.finished_at,
});
const COLS = sql`id, org_slug, subject, body, status, sender_email, recipient_count, created_by, created_at, sent_at, finished_at`;

export async function findTop50ByOrg(db: Db, org: string): Promise<AnnouncementRow[]> {
  return (await rows<Raw>(db, sql`SELECT ${COLS} FROM public.org_announcements WHERE org_slug = ${org} ORDER BY created_at DESC LIMIT 50`)).map(row);
}

export async function findByIdAndOrg(db: Db, id: number, org: string, forUpdate = false): Promise<AnnouncementRow | null> {
  const [r] = await rows<Raw>(db, forUpdate
    ? sql`SELECT ${COLS} FROM public.org_announcements WHERE id = ${id} AND org_slug = ${org} FOR UPDATE`
    : sql`SELECT ${COLS} FROM public.org_announcements WHERE id = ${id} AND org_slug = ${org}`);
  return r ? row(r) : null;
}

export async function findById(db: Db, id: number): Promise<AnnouncementRow | null> {
  const [r] = await rows<Raw>(db, sql`SELECT ${COLS} FROM public.org_announcements WHERE id = ${id}`);
  return r ? row(r) : null;
}

export async function insertAnnouncement(db: Db, org: string, subject: string, body: string, by: string, now: Micros): Promise<AnnouncementRow> {
  const [r] = await rows<Raw>(db, sql`
    INSERT INTO public.org_announcements (org_slug, subject, body, status, sender_email, recipient_count, created_by, created_at, sent_at, finished_at)
    VALUES (${org}, ${subject}, ${body}, 'draft', NULL, NULL, ${by}, ${ts(now)}, NULL, NULL)
    RETURNING ${COLS}`);
  return row(r!);
}

export async function updateAnnouncement(db: Db, a: AnnouncementRow): Promise<void> {
  await db.execute(sql`
    UPDATE public.org_announcements SET subject = ${a.subject}, body = ${a.body}, status = ${a.status}, sender_email = ${a.senderEmail},
      recipient_count = ${a.recipientCount}, sent_at = ${a.sentAt}::timestamptz
    WHERE id = ${a.id}`);
}

export async function deleteAnnouncement(db: Db, id: number): Promise<void> {
  await db.execute(sql`DELETE FROM public.org_announcements WHERE id = ${id}`);
}

export async function findSendingIds(db: Db): Promise<number[]> {
  return (await rows<{ id: number }>(db, sql`SELECT id FROM public.org_announcements WHERE status = 'sending' ORDER BY sent_at, id`)).map((r) => Number(r.id));
}

export async function countSentSince(db: Db, org: string, since: Micros): Promise<number> {
  const [r] = await rows<{ n: number }>(db, sql`
    SELECT count(*)::bigint AS n FROM public.org_announcements WHERE org_slug = ${org} AND status <> 'draft' AND sent_at >= ${ts(since)}`);
  return Number(r?.n ?? 0);
}

export function markSentIfDone(db: Db, id: number, now: Micros): Promise<number> {
  return count(db, sql`
    UPDATE public.org_announcements a SET status = 'sent', finished_at = ${ts(now)}
    WHERE a.id = ${id} AND a.status = 'sending'
      AND NOT EXISTS (SELECT 1 FROM public.org_announcement_deliveries d WHERE d.announcement_id = a.id AND d.status IN ('pending', 'sending'))`);
}

export async function findRecipients(db: Db, org: string): Promise<{ id: string; email: string }[]> {
  return rows(db, sql`
    SELECT u.id, u.email FROM public."user" u
    JOIN public.user_follows f ON f.user_id = u.id AND f.org_slug = ${org}
    WHERE NOT EXISTS (SELECT 1 FROM public.org_mail_optouts o WHERE o.user_id = u.id AND o.org_slug = ${org})
    ORDER BY u.id`);
}

export async function countRecipients(db: Db, org: string, domains: string[]): Promise<number> {
  const [r] = await rows<{ n: number }>(db, sql`
    SELECT count(*)::bigint AS n FROM public."user" u
    JOIN public.user_follows f ON f.user_id = u.id AND f.org_slug = ${org}
    WHERE NOT EXISTS (SELECT 1 FROM public.org_mail_optouts o WHERE o.user_id = u.id AND o.org_slug = ${org})
      AND lower(trim(u.email)) ~ '^[^@]+@[^@]+$'
      AND split_part(lower(trim(u.email)), '@', 2) = ANY(${textArray(domains)})`);
  return Number(r?.n ?? 0);
}

export async function isStillRecipient(db: Db, userId: string, org: string): Promise<boolean> {
  const [r] = await rows<{ ok: boolean }>(db, sql`
    SELECT (EXISTS (SELECT 1 FROM public.user_follows f WHERE f.user_id = ${userId} AND f.org_slug = ${org})
       AND NOT EXISTS (SELECT 1 FROM public.org_mail_optouts o WHERE o.user_id = ${userId} AND o.org_slug = ${org})) AS ok`);
  return Boolean(r?.ok);
}

// ------------------------------------------------------------ deliveries

export async function countByAnnouncementAndStatus(db: Db, ids: number[]): Promise<{ id: number; status: string; n: number }[]> {
  if (ids.length === 0) return [];
  return (await rows<{ announcement_id: number; status: string; n: number }>(db, sql`
    SELECT announcement_id, status, count(*)::bigint AS n FROM public.org_announcement_deliveries
    WHERE announcement_id = ANY(${`{${ids.join(',')}}`}::bigint[]) GROUP BY announcement_id, status`))
    .map((r) => ({ id: Number(r.announcement_id), status: r.status, n: Number(r.n) }));
}

export async function insertDeliveries(db: Db, id: number, recipients: { userId: string; email: string }[]): Promise<void> {
  for (let i = 0; i < recipients.length; i += 500) {
    const values = sql.join(recipients.slice(i, i + 500).map((r) => sql`(${id}, ${r.userId}, ${r.email}, 'pending', 0, NULL, NULL, NULL)`), sql`, `);
    await db.execute(sql`INSERT INTO public.org_announcement_deliveries (announcement_id, user_id, email, status, attempts, last_error, claimed_at, sent_at)
                         VALUES ${values}`);
  }
}

export interface DeliveryRow { userId: string; email: string; attempts: number }

export async function lockNextPending(db: Db, id: number, retryBefore: Micros): Promise<DeliveryRow | null> {
  const [r] = await rows<{ user_id: string; email: string; attempts: number }>(db, sql`
    SELECT user_id, email, attempts FROM public.org_announcement_deliveries
    WHERE announcement_id = ${id} AND status = 'pending' AND (claimed_at IS NULL OR claimed_at <= ${ts(retryBefore)})
    ORDER BY attempts ASC, user_id ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED`);
  return r ? { userId: r.user_id, email: r.email, attempts: Number(r.attempts) } : null;
}

const W = (id: number, userId: string) => sql`announcement_id = ${id} AND user_id = ${userId} AND status`;
export const markSending = (db: Db, id: number, u: string, now: Micros) =>
  count(db, sql`UPDATE public.org_announcement_deliveries SET status = 'sending', claimed_at = ${ts(now)} WHERE ${W(id, u)} = 'pending'`);
export const markSent = (db: Db, id: number, u: string, now: Micros) =>
  count(db, sql`UPDATE public.org_announcement_deliveries SET status = 'sent', sent_at = ${ts(now)}, last_error = NULL WHERE ${W(id, u)} = 'sending'`);
export const markFailed = (db: Db, id: number, u: string, now: Micros, error: string) =>
  count(db, sql`UPDATE public.org_announcement_deliveries SET status = 'failed', sent_at = ${ts(now)}, last_error = ${error} WHERE ${W(id, u)} = 'sending'`);
export const retryLater = (db: Db, id: number, u: string, error: string) =>
  count(db, sql`UPDATE public.org_announcement_deliveries SET status = 'pending', attempts = attempts + 1, last_error = ${error} WHERE ${W(id, u)} = 'sending'`);
export const release = (db: Db, id: number, u: string, error: string) =>
  count(db, sql`UPDATE public.org_announcement_deliveries SET status = 'pending', claimed_at = NULL, last_error = ${error} WHERE ${W(id, u)} = 'sending'`);
export const deleteClaimed = (db: Db, id: number, u: string) =>
  count(db, sql`DELETE FROM public.org_announcement_deliveries WHERE ${W(id, u)} = 'sending'`);
export const failStale = (db: Db, cutoff: Micros, error: string) =>
  count(db, sql`UPDATE public.org_announcement_deliveries SET status = 'failed', sent_at = claimed_at, last_error = ${error}
                WHERE status = 'sending' AND claimed_at < ${ts(cutoff)}`);

// ------------------------------------------------------------ opt-outs

export async function insertOptoutIfAbsent(db: Db, userId: string, org: string, now: Micros): Promise<void> {
  await db.execute(sql`INSERT INTO public.org_mail_optouts (user_id, org_slug, created_at) VALUES (${userId}, ${org}, ${ts(now)}) ON CONFLICT DO NOTHING`);
}

export async function deleteOptout(db: Db, userId: string, org: string): Promise<void> {
  await db.execute(sql`DELETE FROM public.org_mail_optouts WHERE user_id = ${userId} AND org_slug = ${org}`);
}

export async function optoutExists(db: Db, userId: string, org: string): Promise<boolean> {
  const [r] = await rows<{ ok: boolean }>(db, sql`SELECT EXISTS (SELECT 1 FROM public.org_mail_optouts WHERE user_id = ${userId} AND org_slug = ${org}) AS ok`);
  return Boolean(r?.ok);
}

export async function userExists(db: Db, id: string): Promise<boolean> {
  const [r] = await rows<{ ok: boolean }>(db, sql`SELECT EXISTS (SELECT 1 FROM public."user" WHERE id = ${id}) AS ok`);
  return Boolean(r?.ok);
}

export const parseTs = (pg: string | null) => (pg == null ? null : parsePgTimestamp(pg));
