// repository/mail/*: MailSendLogRepository, MailAccountStateRepository,
// MailSenderAccountRepository, MailTrackingEventRepository (+ the retention
// deletes of DigestDeliveryLinkRepository / OrgAnnouncementDeliveryRepository
// that MailRetentionService runs). Native SQL with bound parameters.

import { sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { parsePgTimestamp, toPgTimestamp, type Micros } from '../../lib/time';

const ts = (us: Micros) => sql`${toPgTimestamp(us)}::timestamptz`;
const rows = async <T>(db: Db, q: ReturnType<typeof sql>): Promise<T[]> => (await db.execute(q)) as unknown as T[];

// ------------------------------------------------------------ mail_send_log

export async function sumCountedSince(db: Db, account: string, since: Micros): Promise<number> {
  const [r] = await rows<{ n: number | null }>(db, sql`
    SELECT COALESCE(SUM(l.recipients), 0)::bigint AS n FROM public.mail_send_log l
    WHERE l.account = ${account} AND l.attempted_at > ${ts(since)} AND l.outcome IN ('sent', 'rejected')`);
  return Number(r?.n ?? 0);
}

export async function findCountedSince(db: Db, account: string, since: Micros): Promise<{ at: Micros; recipients: number }[]> {
  const list = await rows<{ attempted_at: string; recipients: number }>(db, sql`
    SELECT l.attempted_at, l.recipients FROM public.mail_send_log l
    WHERE l.account = ${account} AND l.attempted_at > ${ts(since)} AND l.outcome IN ('sent', 'rejected')
    ORDER BY l.attempted_at ASC, l.id ASC`);
  return list.map((r) => ({ at: parsePgTimestamp(r.attempted_at), recipients: Number(r.recipients) }));
}

export async function insertSendLog(db: Db, account: string, kind: string, recipients: number, outcome: string,
                                    error: string | null, at: Micros): Promise<void> {
  await db.execute(sql`
    INSERT INTO public.mail_send_log (account, kind, recipients, outcome, error, attempted_at)
    VALUES (${account}, ${kind}, ${recipients}, ${outcome}, ${error}, ${ts(at)})`);
}

export async function deleteSendLogOlderThan(db: Db, cutoff: Micros): Promise<number> {
  const r = await db.execute(sql`DELETE FROM public.mail_send_log WHERE attempted_at < ${ts(cutoff)}`);
  return (r as unknown as { count: number }).count;
}

// ------------------------------------------------------------ mail_account_state

export interface AccountStateRow { pausedUntil: Micros | null; pauseReason: string | null; consecutiveFailures: number }

export async function findAccountState(db: Db, account: string): Promise<AccountStateRow | null> {
  const [r] = await rows<{ paused_until: string | null; pause_reason: string | null; consecutive_failures: number }>(db, sql`
    SELECT paused_until, pause_reason, consecutive_failures FROM public.mail_account_state WHERE account = ${account}`);
  if (!r) return null;
  return {
    pausedUntil: r.paused_until == null ? null : parsePgTimestamp(r.paused_until),
    pauseReason: r.pause_reason,
    consecutiveFailures: Number(r.consecutive_failures),
  };
}

/** findById + set + save (insert when missing). */
export async function saveAccountState(db: Db, account: string, s: AccountStateRow, now: Micros): Promise<void> {
  await db.execute(sql`
    INSERT INTO public.mail_account_state (account, paused_until, pause_reason, consecutive_failures, updated_at)
    VALUES (${account}, ${s.pausedUntil == null ? null : toPgTimestamp(s.pausedUntil)}::timestamptz, ${s.pauseReason},
            ${s.consecutiveFailures}, ${ts(now)})
    ON CONFLICT (account) DO UPDATE SET paused_until = EXCLUDED.paused_until, pause_reason = EXCLUDED.pause_reason,
      consecutive_failures = EXCLUDED.consecutive_failures, updated_at = EXCLUDED.updated_at`);
}

// ------------------------------------------------------------ mail_sender_account

export interface SenderAccountRow {
  id: number;
  email: string;
  ownerType: string;
  ownerRef: string | null;
  refreshTokenEnc: string;
  scopes: string;
  status: string;
  connectedBy: string | null;
  connectedAt: string;
  lastError: string | null;
  lastUsedAt: string | null;
}

const ACCOUNT_COLS = sql`id, email, owner_type, owner_ref, refresh_token_enc, scopes, status, connected_by, connected_at,
                         last_error, last_used_at`;

interface RawAccount {
  id: number; email: string; owner_type: string; owner_ref: string | null; refresh_token_enc: string; scopes: string;
  status: string; connected_by: string | null; connected_at: string; last_error: string | null; last_used_at: string | null;
}

const account = (r: RawAccount): SenderAccountRow => ({
  id: Number(r.id), email: r.email, ownerType: r.owner_type, ownerRef: r.owner_ref, refreshTokenEnc: r.refresh_token_enc,
  scopes: r.scopes, status: r.status, connectedBy: r.connected_by, connectedAt: r.connected_at, lastError: r.last_error,
  lastUsedAt: r.last_used_at,
});

export async function findAccountByEmailIgnoreCase(db: Db, email: string): Promise<SenderAccountRow | null> {
  const [r] = await rows<RawAccount>(db, sql`SELECT ${ACCOUNT_COLS} FROM public.mail_sender_account WHERE lower(email) = lower(${email})`);
  return r ? account(r) : null;
}

export async function findAccountById(db: Db, id: number): Promise<SenderAccountRow | null> {
  const [r] = await rows<RawAccount>(db, sql`SELECT ${ACCOUNT_COLS} FROM public.mail_sender_account WHERE id = ${id}`);
  return r ? account(r) : null;
}

/** findFirstByOwnerTypeAndOwnerRefIsNull / findFirstByOwnerTypeAndOwnerRef */
export async function findAccountByOwner(db: Db, ownerType: string, ownerRef: string | null): Promise<SenderAccountRow | null> {
  const [r] = await rows<RawAccount>(db, ownerRef == null
    ? sql`SELECT ${ACCOUNT_COLS} FROM public.mail_sender_account WHERE owner_type = ${ownerType} AND owner_ref IS NULL LIMIT 1`
    : sql`SELECT ${ACCOUNT_COLS} FROM public.mail_sender_account WHERE owner_type = ${ownerType} AND owner_ref = ${ownerRef} LIMIT 1`);
  return r ? account(r) : null;
}

export async function findAllAccounts(db: Db): Promise<SenderAccountRow[]> {
  return (await rows<RawAccount>(db, sql`SELECT ${ACCOUNT_COLS} FROM public.mail_sender_account ORDER BY id ASC`)).map(account);
}

/** save(new MailSenderAccount(...)): every column, connected. */
export async function insertAccount(db: Db, email: string, ownerType: string, ownerRef: string | null, enc: string, scopes: string,
                                    by: string | null, now: Micros): Promise<void> {
  await db.execute(sql`
    INSERT INTO public.mail_sender_account (email, owner_type, owner_ref, refresh_token_enc, scopes, status, connected_by,
                                            connected_at, last_error, last_used_at)
    VALUES (${email}, ${ownerType}, ${ownerRef}, ${enc}, ${scopes}, 'connected', ${by}, ${ts(now)}, NULL, NULL)`);
}

/** MailSenderAccount.connect + save (Hibernate updates every column of the loaded row). */
export async function reconnectAccount(db: Db, a: SenderAccountRow, enc: string, scopes: string, by: string | null, now: Micros): Promise<void> {
  await db.execute(sql`
    UPDATE public.mail_sender_account SET email = ${a.email}, owner_type = ${a.ownerType}, owner_ref = ${a.ownerRef},
      refresh_token_enc = ${enc}, scopes = ${scopes}, status = 'connected', connected_by = ${by}, connected_at = ${ts(now)},
      last_error = NULL, last_used_at = ${a.lastUsedAt}::timestamptz
    WHERE id = ${a.id}`);
}

export async function deleteAccount(db: Db, id: number): Promise<void> {
  await db.execute(sql`DELETE FROM public.mail_sender_account WHERE id = ${id}`);
}

export async function markAccountBroken(db: Db, id: number, tokenEnc: string, error: string | null): Promise<number> {
  const r = await db.execute(sql`
    UPDATE public.mail_sender_account SET status = 'broken', last_error = ${error} WHERE id = ${id} AND refresh_token_enc = ${tokenEnc}`);
  return (r as unknown as { count: number }).count;
}

export async function markAccountUsed(db: Db, id: number, at: Micros): Promise<void> {
  await db.execute(sql`UPDATE public.mail_sender_account SET last_used_at = ${ts(at)} WHERE id = ${id}`);
}

export async function isActiveStaffAt(db: Db, userId: string, now: Micros): Promise<boolean> {
  const [r] = await rows<{ ok: boolean }>(db, sql`
    SELECT EXISTS (SELECT 1 FROM public.ceitba_staff cs WHERE cs.user_id = ${userId} AND cs.start <= ${ts(now)} AND cs."end" >= ${ts(now)}) AS ok`);
  return Boolean(r?.ok);
}

/** OrganizationMembershipService.userIsAdminOf */
export async function isOrgAdmin(db: Db, userId: string | null, slug: string | null): Promise<boolean> {
  if (userId == null || slug == null) return false;
  const [r] = await rows<{ ok: boolean }>(db, sql`
    SELECT EXISTS (SELECT 1 FROM public.user_organizations WHERE user_id = ${userId} AND org_slug = ${slug} AND role = 'admin') AS ok`);
  return Boolean(r?.ok);
}

// ------------------------------------------------------------ mail_tracking_event

export async function insertTrackingEvent(db: Db, trackingId: string, type: string, linkId: number | null, at: Micros,
                                          flagReason: string | null, uaClass: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO public.mail_tracking_event (tracking_id, type, link_id, at, flagged, flag_reason, ua_class)
    VALUES (${trackingId}, ${type}, ${linkId}, ${ts(at)}, ${flagReason != null}, ${flagReason}, ${uaClass})`);
}

export async function deleteTrackingEventsOlderThan(db: Db, cutoff: Micros): Promise<number> {
  const r = await db.execute(sql`DELETE FROM public.mail_tracking_event WHERE at < ${ts(cutoff)}`);
  return (r as unknown as { count: number }).count;
}

/** DigestDeliveryLinkRepository.deleteOfDeliveriesSentBefore */
export async function deleteDeliveryLinksSentBefore(db: Db, cutoff: Micros): Promise<number> {
  const r = await db.execute(sql`
    DELETE FROM public.digest_delivery_links WHERE tracking_id IN
      (SELECT d.tracking_id FROM public.digest_deliveries d WHERE d.sent_at < ${ts(cutoff)})`);
  return (r as unknown as { count: number }).count;
}

/** OrgAnnouncementDeliveryRepository.deleteFinishedBefore */
export async function deleteOrgDeliveriesFinishedBefore(db: Db, cutoff: Micros): Promise<number> {
  const r = await db.execute(sql`
    DELETE FROM public.org_announcement_deliveries d USING public.org_announcements a
    WHERE a.id = d.announcement_id AND a.status = 'sent' AND a.finished_at < ${ts(cutoff)}`);
  return (r as unknown as { count: number }).count;
}
