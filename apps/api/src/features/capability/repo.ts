// repository/capability/* (+ the user/org reads CapabilityAdminService does).

import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { capabilityOrgGrants, capabilitySettings, capabilityUserGrants, ceitbaStaff, user } from '../../db/schema/identity';
import { organizations, userOrganizations } from '../../db/schema/news';

export type CapabilitySettingRow = typeof capabilitySettings.$inferSelect;
export type UserGrantRow = typeof capabilityUserGrants.$inferSelect;
export type OrgGrantRow = typeof capabilityOrgGrants.$inferSelect;

export async function findSetting(db: Db, capability: string): Promise<CapabilitySettingRow | null> {
  const [r] = await db.select().from(capabilitySettings).where(eq(capabilitySettings.capability, capability)).limit(1);
  return r ?? null;
}

/** settings.save(setting): merge by id (insert or update every column). */
export async function upsertSetting(db: Db, capability: string, enabledForAll: boolean, updatedBy: string | null, updatedAtPg: string): Promise<void> {
  await db.insert(capabilitySettings).values({ capability, enabledForAll, updatedAt: updatedAtPg, updatedBy })
    .onConflictDoUpdate({ target: capabilitySettings.capability, set: { enabledForAll, updatedAt: updatedAtPg, updatedBy } });
}

export async function findEnabledForAll(db: Db): Promise<string[]> {
  const rows = await db.select({ c: capabilitySettings.capability }).from(capabilitySettings).where(eq(capabilitySettings.enabledForAll, true));
  return rows.map((r) => r.c);
}

/** findByCapabilityOrderByEmail. */
export function userGrantsOf(db: Db, capability: string): Promise<UserGrantRow[]> {
  return db.select().from(capabilityUserGrants).where(eq(capabilityUserGrants.capability, capability)).orderBy(asc(capabilityUserGrants.email));
}

/** findByCapabilityOrderByOrgSlug. */
export function orgGrantsOf(db: Db, capability: string): Promise<OrgGrantRow[]> {
  return db.select().from(capabilityOrgGrants).where(eq(capabilityOrgGrants.capability, capability)).orderBy(asc(capabilityOrgGrants.orgSlug));
}

export async function countUserGrants(db: Db, capability: string): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)` }).from(capabilityUserGrants).where(eq(capabilityUserGrants.capability, capability));
  return Number(r?.n ?? 0);
}

export async function countOrgGrants(db: Db, capability: string): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)` }).from(capabilityOrgGrants).where(eq(capabilityOrgGrants.capability, capability));
  return Number(r?.n ?? 0);
}

/** insertIfAbsent (ON CONFLICT DO NOTHING). */
export async function insertUserGrantIfAbsent(db: Db, capability: string, email: string, atPg: string, by: string | null): Promise<void> {
  await db.execute(sql`INSERT INTO public.capability_user_grants (capability, email, granted_at, granted_by)
    VALUES (${capability}, ${email}, ${atPg}, ${by}) ON CONFLICT DO NOTHING`);
}

export async function insertOrgGrantIfAbsent(db: Db, capability: string, slug: string, atPg: string, by: string | null): Promise<void> {
  await db.execute(sql`INSERT INTO public.capability_org_grants (capability, org_slug, granted_at, granted_by)
    VALUES (${capability}, ${slug}, ${atPg}, ${by}) ON CONFLICT DO NOTHING`);
}

export async function deleteUserGrant(db: Db, capability: string, email: string): Promise<void> {
  await db.delete(capabilityUserGrants).where(and(eq(capabilityUserGrants.capability, capability), eq(capabilityUserGrants.email, email)));
}

export async function deleteOrgGrant(db: Db, capability: string, slug: string): Promise<void> {
  await db.delete(capabilityOrgGrants).where(and(eq(capabilityOrgGrants.capability, capability), eq(capabilityOrgGrants.orgSlug, slug)));
}

/** users.findAllById. */
export async function usersByIds(db: Db, ids: string[]) {
  if (ids.length === 0) return [];
  return db.select({ id: user.id, email: user.email, name: user.name }).from(user).where(inArray(user.id, ids));
}

/** users.findByLowerEmailIn. */
export async function usersByLowerEmails(db: Db, emails: string[]) {
  if (emails.length === 0) return [];
  return db.select({ id: user.id, email: user.email, name: user.name }).from(user).where(inArray(sql`lower(${user.email})`, emails));
}

export async function orgsBySlugs(db: Db, slugs: string[]) {
  if (slugs.length === 0) return [];
  return db.select({ slug: organizations.slug, name: organizations.name }).from(organizations).where(inArray(organizations.slug, slugs));
}

export async function orgExists(db: Db, slug: string): Promise<boolean> {
  const [r] = await db.select({ s: organizations.slug }).from(organizations).where(eq(organizations.slug, slug)).limit(1);
  return !!r;
}

/** UserOrganizationRepository.countByOrganization. */
export async function countMembers(db: Db, slug: string): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)` }).from(userOrganizations).where(eq(userOrganizations.orgSlug, slug));
  return Number(r?.n ?? 0);
}

/** CeitbaStaffRepository.findAllActive(now): ids of active staff. */
export async function activeStaffIds(db: Db, nowPg: string): Promise<string[]> {
  const rows = await db.select({ id: ceitbaStaff.userId }).from(ceitbaStaff)
    .where(and(sql`${ceitbaStaff.start} <= ${nowPg}`, sql`${ceitbaStaff.end} >= ${nowPg}`)).orderBy(asc(ceitbaStaff.userId));
  return rows.map((r) => r.id);
}

/** CapabilityOrgGrantRepository.findMembersWithCapability. */
export async function membersWithCapability(db: Db, capability: string, userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await db.selectDistinct({ id: userOrganizations.userId }).from(capabilityOrgGrants)
    .innerJoin(userOrganizations, eq(userOrganizations.orgSlug, capabilityOrgGrants.orgSlug))
    .where(and(eq(capabilityOrgGrants.capability, capability), inArray(userOrganizations.userId, userIds)));
  return rows.map((r) => r.id);
}
