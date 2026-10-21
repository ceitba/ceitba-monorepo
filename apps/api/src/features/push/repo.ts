// repository/UserDeviceRepository (push recipients) + PushLogRepository.

import { inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { pushLog, userDevices } from '../../db/schema/identity';

/** findTokensByUserIds: `SELECT d.token FROM UserDevice d WHERE d.userId IN :userIds` (no ORDER BY). */
export async function findTokensByUserIds(db: Db, userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await db.select({ token: userDevices.token }).from(userDevices).where(inArray(userDevices.userId, userIds));
  return rows.map((r) => r.token);
}

/** findTokensOfOrgFollowers (native, no ORDER BY). */
export async function findTokensOfOrgFollowers(db: Db, orgSlug: string): Promise<string[]> {
  const rows = await db.execute<{ token: string }>(sql`
    SELECT d.token FROM public.user_devices d
    JOIN public.user_follows f ON f.user_id = d.user_id
    WHERE f.org_slug = ${orgSlug}`);
  return [...rows].map((r) => r.token);
}

/** findAllTokens. */
export async function findAllTokens(db: Db): Promise<string[]> {
  const rows = await db.select({ token: userDevices.token }).from(userDevices);
  return rows.map((r) => r.token);
}

/** deleteByTokens (own transaction in Java: runs outside any service transaction). */
export async function deleteByTokens(db: Db, tokens: string[]): Promise<number> {
  if (tokens.length === 0) return 0;
  const rows = await db.delete(userDevices).where(inArray(userDevices.token, tokens)).returning({ token: userDevices.token });
  return rows.length;
}

/** pushLog.save(new PushLog(org, kind, refId, targeted, sent)): created_at by @CreationTimestamp. */
export async function insertPushLog(db: Db, row: { orgSlug: string | null; kind: string | null; refId: string | null; targeted: number; sent: number; createdAt: string }): Promise<void> {
  await db.insert(pushLog).values({ orgSlug: row.orgSlug, kind: row.kind, refId: row.refId, targeted: row.targeted, sent: row.sent, createdAt: row.createdAt });
}

/** PushLogRepository.totalsForOrgSince: [pushes, devices targeted, devices reached]. */
export async function totalsForOrgSince(db: Db, org: string, sincePg: string): Promise<{ pushes: number; targeted: number; sent: number }> {
  const [r] = await db.execute<{ pushes: number; targeted: number; sent: number }>(sql`
    SELECT count(*)::int8 AS pushes, coalesce(sum(targeted), 0)::int8 AS targeted, coalesce(sum(sent), 0)::int8 AS sent
    FROM public.push_log WHERE org_slug = ${org} AND created_at >= ${sincePg}`);
  return { pushes: Number(r?.pushes ?? 0), targeted: Number(r?.targeted ?? 0), sent: Number(r?.sent ?? 0) };
}
