// Identity queries the security layer needs (users, staff rows, moderator
// grants, memberships, API keys). Features that own these tables (user, staff,
// moderators) may reuse the readers; writes for their own endpoints live in
// their repo.ts.

import { and, desc, eq, gt, gte, isNull, lte, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import {
  apiKeys, capabilityOrgGrants, capabilitySettings, capabilityUserGrants, ceitbaModerators, ceitbaStaff, user,
} from '../../db/schema/identity';
import { orgInvites, organizations, userFollows, userOrganizations } from '../../db/schema/news';
import { toPgTimestamp, type Micros } from '../../lib/time';

export type UserRow = typeof user.$inferSelect;
export type ApiKeyRow = typeof apiKeys.$inferSelect;

/** UserRepository.findByEmail: exact (case-sensitive) match, like Spring Data. */
export async function findUserByEmail(db: Db, email: string): Promise<UserRow | null> {
  const [row] = await db.select().from(user).where(eq(user.email, email)).limit(1);
  return row ?? null;
}

export async function findUserById(db: Db, id: string): Promise<UserRow | null> {
  const [row] = await db.select().from(user).where(eq(user.id, id)).limit(1);
  return row ?? null;
}

/** CeitbaStaffRepository.isActiveStaff: start <= now <= end. */
export async function isActiveStaff(db: Db, userId: string, now: Micros): Promise<boolean> {
  const ts = toPgTimestamp(now);
  const [row] = await db.select({ n: sql<number>`count(*)` }).from(ceitbaStaff)
    .where(and(eq(ceitbaStaff.userId, userId), lte(ceitbaStaff.start, ts), gte(ceitbaStaff.end, ts)));
  return Number(row?.n ?? 0) > 0;
}

/** CeitbaModeratorRepository.isActiveModerator: revoked_at IS NULL. */
export async function isActiveModerator(db: Db, userId: string): Promise<boolean> {
  const [row] = await db.select({ n: sql<number>`count(*)` }).from(ceitbaModerators)
    .where(and(eq(ceitbaModerators.userId, userId), isNull(ceitbaModerators.revokedAt)));
  return Number(row?.n ?? 0) > 0;
}

/** UserOrganizationRepository.findByUserId (no ORDER BY, like the derived query). */
export async function membershipsOf(db: Db, userId: string) {
  return db.select({ organization: userOrganizations.orgSlug, role: userOrganizations.role })
    .from(userOrganizations).where(eq(userOrganizations.userId, userId));
}

/** UserFollowRepository.findByUserId. */
// Java's JPA query had no ORDER BY: Postgres returned the rows of this user's index range in heap order (ctid).
// An explicit ctid order keeps that order even when the planner picks an index-only scan on the primary key,
// which would sort by org_slug instead (found by scripts/dropin.ts on a vacuumed table).
export async function followsOf(db: Db, userId: string) {
  return db.select({ organization: userFollows.orgSlug }).from(userFollows).where(eq(userFollows.userId, userId)).orderBy(sql`ctid`);
}

/** FollowService.followIfMissing. */
export async function followIfMissing(db: Db, userId: string, orgSlug: string): Promise<void> {
  const [org] = await db.select({ slug: organizations.slug }).from(organizations).where(eq(organizations.slug, orgSlug)).limit(1);
  if (!org) return;
  const [exists] = await db.select({ u: userFollows.userId }).from(userFollows)
    .where(and(eq(userFollows.userId, userId), eq(userFollows.orgSlug, orgSlug))).limit(1);
  if (exists) return;
  await db.insert(userFollows).values({ userId, orgSlug });
}

/** OrganizationMembershipService.claimInvites: pending invites of the email become memberships. */
export async function claimInvites(db: Db, userId: string, email: string): Promise<number> {
  const lower = email.toLowerCase();
  const res = await db.execute(sql`
    INSERT INTO public.user_organizations (user_id, org_slug, role, added_by)
    SELECT ${userId}, i.org_slug, i.role, i.invited_by
    FROM public.org_invites i WHERE i.email = ${lower}
    ON CONFLICT DO NOTHING`);
  await db.delete(orgInvites).where(eq(orgInvites.email, lower));
  return (res as unknown as { count?: number }).count ?? 0;
}

// ---------------------------------------------------------------- api keys

export async function findApiKeyByHash(db: Db, keyHash: string): Promise<ApiKeyRow | null> {
  const [row] = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, keyHash)).limit(1);
  return row ?? null;
}

export async function markApiKeyUsed(db: Db, id: string, now: Micros): Promise<void> {
  await db.update(apiKeys).set({ lastUsedAt: toPgTimestamp(now) }).where(eq(apiKeys.id, id));
}

export async function insertApiKey(db: Db, row: { id: string; userId: string; name: string; keyHash: string; expiresAt: Micros; scopes: string; createdAt: Micros }) {
  await db.insert(apiKeys).values({
    id: row.id, userId: row.userId, name: row.name, keyHash: row.keyHash,
    expiresAt: toPgTimestamp(row.expiresAt), scopes: row.scopes, createdAt: toPgTimestamp(row.createdAt), lastUsedAt: null,
  });
}

/** ApiKeyRepository.findActiveByUserId: expires_at > now ORDER BY created_at DESC. */
export async function activeApiKeysOf(db: Db, userId: string, now: Micros): Promise<ApiKeyRow[]> {
  return db.select().from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), gt(apiKeys.expiresAt, toPgTimestamp(now))))
    .orderBy(desc(apiKeys.createdAt));
}

export async function deleteApiKey(db: Db, id: string, userId: string): Promise<number> {
  const rows = await db.delete(apiKeys).where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId))).returning({ id: apiKeys.id });
  return rows.length;
}

// ---------------------------------------------------------------- capabilities

export async function capabilitiesEnabledForAll(db: Db): Promise<string[]> {
  const rows = await db.select({ c: capabilitySettings.capability }).from(capabilitySettings).where(eq(capabilitySettings.enabledForAll, true));
  return rows.map((r) => r.c);
}

export async function capabilitiesByEmail(db: Db, emailLower: string): Promise<string[]> {
  const rows = await db.select({ c: capabilityUserGrants.capability }).from(capabilityUserGrants).where(eq(capabilityUserGrants.email, emailLower));
  return rows.map((r) => r.c);
}

export async function capabilitiesByMember(db: Db, userId: string): Promise<string[]> {
  const rows = await db.selectDistinct({ c: capabilityOrgGrants.capability }).from(capabilityOrgGrants)
    .innerJoin(userOrganizations, eq(userOrganizations.orgSlug, capabilityOrgGrants.orgSlug))
    .where(eq(userOrganizations.userId, userId));
  return rows.map((r) => r.c);
}

