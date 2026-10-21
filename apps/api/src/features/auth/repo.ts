// RefreshTokenRepository (V17 refresh_tokens).

import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { refreshTokens } from '../../db/schema/identity';
import { toPgTimestamp, type Micros } from '../../lib/time';

export type RefreshTokenRow = typeof refreshTokens.$inferSelect;

export async function findFamilyIdByTokenHash(db: Db, hash: string): Promise<string | null> {
  const [r] = await db.select({ f: refreshTokens.familyId }).from(refreshTokens).where(eq(refreshTokens.tokenHash, hash)).limit(1);
  return r?.f ?? null;
}

/** Transaction-scoped advisory lock on one family (pg_advisory_xact_lock(hashtext(family))). */
export async function lockFamily(db: Db, familyId: string): Promise<void> {
  await db.execute(sql`SELECT count(*) FROM (SELECT pg_advisory_xact_lock(hashtext(CAST(${familyId} AS text)))) l`);
}

export async function findByTokenHashForUpdate(db: Db, hash: string): Promise<RefreshTokenRow | null> {
  const [r] = await db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, hash)).for('update');
  return r ?? null;
}

export async function findByIdForUpdate(db: Db, id: string): Promise<RefreshTokenRow | null> {
  const [r] = await db.select().from(refreshTokens).where(eq(refreshTokens.id, id)).for('update');
  return r ?? null;
}

export async function findLiveFamilyIds(db: Db, userId: string): Promise<string[]> {
  const rows = await db.selectDistinct({ f: refreshTokens.familyId }).from(refreshTokens)
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt))).orderBy(asc(refreshTokens.familyId));
  return rows.map((r) => r.f);
}

export async function revokeFamily(db: Db, familyId: string, now: Micros): Promise<void> {
  await db.update(refreshTokens).set({ revokedAt: toPgTimestamp(now) })
    .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
}

export async function revokeAllForUser(db: Db, userId: string, now: Micros): Promise<void> {
  await db.update(refreshTokens).set({ revokedAt: toPgTimestamp(now) })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
}

export async function insertRefreshToken(db: Db, row: { id: string; userId: string; familyId: string; tokenHash: string; deviceName: string | null; expiresAt: Micros; createdAt: Micros }) {
  await db.insert(refreshTokens).values({
    id: row.id, userId: row.userId, familyId: row.familyId, tokenHash: row.tokenHash, deviceName: row.deviceName,
    expiresAt: toPgTimestamp(row.expiresAt), createdAt: toPgTimestamp(row.createdAt), revokedAt: null, replacedBy: null,
  });
}

export async function setRotation(db: Db, id: string, fields: { revokedAt?: Micros; replacedBy: string }) {
  await db.update(refreshTokens).set({
    ...(fields.revokedAt !== undefined ? { revokedAt: toPgTimestamp(fields.revokedAt) } : {}),
    replacedBy: fields.replacedBy,
  }).where(eq(refreshTokens.id, id));
}
