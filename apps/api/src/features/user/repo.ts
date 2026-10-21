// repository/{User,UserDevice,SavedSchedule}Repository, the user_follows /
// user_organizations / event_rsvps reads and writes of the /v1/me and
// /v1/users controllers (the news feature owns those tables' other endpoints),
// and AccountDeletionRepository (bulk, cross-schema DELETE /v1/me statements).

import { and, asc, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { careers, plan } from '../../db/schema/academic';
import { ceitbaStaff, user, userDevices } from '../../db/schema/identity';
import { eventRsvps, organizations, userFollows, userOrganizations } from '../../db/schema/news';
import { savedSchedules } from '../../db/schema/schedules';

export type UserRow = typeof user.$inferSelect;
export type DeviceRow = typeof userDevices.$inferSelect;
export type SavedScheduleRow = Omit<typeof savedSchedules.$inferSelect, 'payload'> & { payloadText: string };

// ---------------------------------------------------------------- users

export async function findUser(db: Db, id: string): Promise<UserRow | null> {
  const [r] = await db.select().from(user).where(eq(user.id, id)).limit(1);
  return r ?? null;
}

export async function findUserByEmail(db: Db, email: string): Promise<UserRow | null> {
  const [r] = await db.select().from(user).where(eq(user.email, email)).limit(1);
  return r ?? null;
}

export async function findUserByFileNumber(db: Db, fileNumber: number): Promise<UserRow | null> {
  const [r] = await db.select().from(user).where(eq(user.fileNumber, fileNumber)).limit(1);
  return r ?? null;
}

export async function insertUser(db: Db, row: UserRow): Promise<void> {
  await db.insert(user).values(row);
}

/** @DynamicUpdate: only the changed columns (plus updated_at). */
export async function updateUserColumns(db: Db, id: string, set: Partial<UserRow>): Promise<void> {
  await db.update(user).set(set).where(eq(user.id, id));
}

/** setFileNumberIfNull: the conditional UPDATE (0 rows when another request set it first). */
export async function setFileNumberIfNull(db: Db, id: string, fileNumber: number, nowPg: string): Promise<number> {
  const rows = await db.update(user).set({ fileNumber, updatedAt: nowPg })
    .where(and(eq(user.id, id), isNull(user.fileNumber))).returning({ id: user.id });
  return rows.length;
}

/**
 * findFiltered: lower(name) or lower(email) contains q, optional org
 * membership, optional active-staff filter; Pageable sort by created_at.
 */
export async function findFilteredUsers(db: Db, f: { q: string; organization: string | null; staffOnly: boolean; nowPg: string; asc: boolean; offset: number; limit: number }) {
  const like = `%${f.q}%`;
  const conds: SQL[] = [sql`(lower(${user.name}) LIKE ${like} OR lower(${user.email}) LIKE ${like})`];
  if (f.organization !== null) {
    conds.push(sql`EXISTS (SELECT 1 FROM public.user_organizations m WHERE m.user_id = ${user.id} AND m.org_slug = ${f.organization})`);
  }
  if (f.staffOnly) {
    conds.push(sql`EXISTS (SELECT 1 FROM public.ceitba_staff cs WHERE cs.user_id = ${user.id} AND cs.start <= ${f.nowPg} AND cs."end" >= ${f.nowPg})`);
  }
  const where = and(...conds);
  const rows = await db.select().from(user).where(where).orderBy(f.asc ? asc(user.createdAt) : desc(user.createdAt)).limit(f.limit).offset(f.offset);
  const [c] = await db.select({ n: sql<number>`count(*)` }).from(user).where(where);
  return { rows, total: Number(c?.n ?? 0) };
}

export async function careerExists(db: Db, id: string): Promise<boolean> {
  const [r] = await db.select({ id: careers.id }).from(careers).where(eq(careers.id, id)).limit(1);
  return !!r;
}

export async function findPlan(db: Db, id: string) {
  const [r] = await db.select().from(plan).where(eq(plan.id, id)).limit(1);
  return r ?? null;
}

export async function isActiveStaffAt(db: Db, userId: string, nowPg: string): Promise<boolean> {
  const [r] = await db.select({ n: sql<number>`count(*)` }).from(ceitbaStaff)
    .where(and(eq(ceitbaStaff.userId, userId), sql`${ceitbaStaff.start} <= ${nowPg}`, sql`${ceitbaStaff.end} >= ${nowPg}`));
  return Number(r?.n ?? 0) > 0;
}

/** CeitbaStaffRepository.findAllActiveForUpdate: active rows locked FOR UPDATE, in user order. */
export async function lockActiveStaffIds(db: Db, nowPg: string): Promise<string[]> {
  const rows = await db.select({ id: ceitbaStaff.userId }).from(ceitbaStaff)
    .where(and(sql`${ceitbaStaff.start} <= ${nowPg}`, sql`${ceitbaStaff.end} >= ${nowPg}`)).orderBy(asc(ceitbaStaff.userId)).for('update');
  return rows.map((r) => r.id);
}

// ---------------------------------------------------------------- memberships / follows / rsvps

/** UserOrganizationRepository.findByUserId (no ORDER BY). */
export function membershipsOf(db: Db, userId: string) {
  return db.select().from(userOrganizations).where(eq(userOrganizations.userId, userId));
}

export async function findMembership(db: Db, userId: string, slug: string) {
  const [r] = await db.select().from(userOrganizations).where(and(eq(userOrganizations.userId, userId), eq(userOrganizations.orgSlug, slug))).limit(1);
  return r ?? null;
}

export async function insertMembership(db: Db, row: { userId: string; orgSlug: string; role: string; addedBy: string | null; createdAtPg: string }): Promise<void> {
  await db.insert(userOrganizations).values({
    userId: row.userId, orgSlug: row.orgSlug, role: row.role, addedBy: row.addedBy, title: null, showOnPortal: false, createdAt: row.createdAtPg,
  });
}

export async function updateMembershipRole(db: Db, userId: string, slug: string, role: string): Promise<void> {
  await db.update(userOrganizations).set({ role }).where(and(eq(userOrganizations.userId, userId), eq(userOrganizations.orgSlug, slug)));
}

export async function deleteMembership(db: Db, userId: string, slug: string): Promise<void> {
  await db.delete(userOrganizations).where(and(eq(userOrganizations.userId, userId), eq(userOrganizations.orgSlug, slug)));
}

/** findAdminsForUpdate(org): the org's admin rows locked, in user order. */
export async function lockOrgAdmins(db: Db, slug: string): Promise<string[]> {
  const rows = await db.select({ id: userOrganizations.userId }).from(userOrganizations)
    .where(and(eq(userOrganizations.orgSlug, slug), eq(userOrganizations.role, 'admin'))).orderBy(asc(userOrganizations.userId)).for('update');
  return rows.map((r) => r.id);
}

export async function orgExists(db: Db, slug: string): Promise<boolean> {
  const [r] = await db.select({ s: organizations.slug }).from(organizations).where(eq(organizations.slug, slug)).limit(1);
  return !!r;
}

/** UserFollowRepository.findByUserId (no ORDER BY). */
export function followsOf(db: Db, userId: string) {
  return db.select().from(userFollows).where(eq(userFollows.userId, userId));
}

export async function followExists(db: Db, userId: string, slug: string): Promise<boolean> {
  const [r] = await db.select({ u: userFollows.userId }).from(userFollows).where(and(eq(userFollows.userId, userId), eq(userFollows.orgSlug, slug))).limit(1);
  return !!r;
}

export async function insertFollow(db: Db, userId: string, slug: string, createdAtPg: string): Promise<void> {
  await db.insert(userFollows).values({ userId, orgSlug: slug, createdAt: createdAtPg });
}

export async function deleteFollow(db: Db, userId: string, slug: string): Promise<void> {
  await db.delete(userFollows).where(and(eq(userFollows.userId, userId), eq(userFollows.orgSlug, slug)));
}

/** EventRsvpRepository.findEventIdsByUserId (no ORDER BY). */
export async function rsvpEventIdsOf(db: Db, userId: string): Promise<string[]> {
  const rows = await db.select({ id: eventRsvps.eventId }).from(eventRsvps).where(eq(eventRsvps.userId, userId));
  return rows.map((r) => r.id);
}

/** OrganizationMembershipService.claimInvites: pending invites of the email become memberships. */
export async function claimInvites(db: Db, userId: string, email: string): Promise<void> {
  const lower = email.toLowerCase();
  await db.execute(sql`
    INSERT INTO public.user_organizations (user_id, org_slug, role, added_by)
    SELECT ${userId}, i.org_slug, i.role, i.invited_by FROM public.org_invites i WHERE i.email = ${lower}
    ON CONFLICT DO NOTHING`);
  await db.execute(sql`DELETE FROM public.org_invites WHERE email = ${lower}`);
}

// ---------------------------------------------------------------- devices

/** UserDeviceRepository.upsert: insert-or-update on the token PK; a token of another user moves (created_at restarts). */
export async function upsertDevice(db: Db, d: { token: string; userId: string; platform: string; appVersion: string | null; nowPg: string }): Promise<void> {
  await db.execute(sql`
    INSERT INTO public.user_devices (token, user_id, platform, app_version, created_at, last_seen_at)
    VALUES (${d.token}, ${d.userId}, ${d.platform}, ${d.appVersion}, ${d.nowPg}, ${d.nowPg})
    ON CONFLICT (token) DO UPDATE SET
        created_at   = CASE WHEN public.user_devices.user_id = EXCLUDED.user_id
                            THEN public.user_devices.created_at ELSE EXCLUDED.created_at END,
        user_id      = EXCLUDED.user_id,
        platform     = EXCLUDED.platform,
        app_version  = EXCLUDED.app_version,
        last_seen_at = EXCLUDED.last_seen_at`);
}

/** trimForUser: keeps the `keep` most recently seen devices of the user. */
export async function trimDevices(db: Db, userId: string, keep: number): Promise<void> {
  await db.execute(sql`
    DELETE FROM public.user_devices
    WHERE user_id = ${userId}
      AND token NOT IN (SELECT token FROM public.user_devices WHERE user_id = ${userId}
                        ORDER BY last_seen_at DESC, created_at DESC LIMIT ${keep})`);
}

export async function findDevice(db: Db, token: string): Promise<DeviceRow | null> {
  const [r] = await db.select().from(userDevices).where(eq(userDevices.token, token)).limit(1);
  return r ?? null;
}

/** findByUserIdOrderByLastSeenAtDesc. */
export function devicesOf(db: Db, userId: string): Promise<DeviceRow[]> {
  return db.select().from(userDevices).where(eq(userDevices.userId, userId)).orderBy(desc(userDevices.lastSeenAt));
}

export async function deleteDevice(db: Db, token: string, userId: string): Promise<void> {
  await db.delete(userDevices).where(and(eq(userDevices.token, token), eq(userDevices.userId, userId)));
}

// ---------------------------------------------------------------- saved schedules

// The payload as jsonb TEXT: Hibernate's Jackson mapper reads that text (key order, number literals).
const scheduleCols = {
  id: savedSchedules.id, userId: savedSchedules.userId, name: savedSchedules.name, careerId: savedSchedules.careerId,
  plan: savedSchedules.plan, payloadText: sql<string>`${savedSchedules.payload}::text`, createdAt: savedSchedules.createdAt,
  updatedAt: savedSchedules.updatedAt, isPrimary: savedSchedules.isPrimary, payloadUpdatedAt: savedSchedules.payloadUpdatedAt,
};

/** findByUserIdOrderByUpdatedAtDesc. */
export function schedulesOf(db: Db, userId: string): Promise<SavedScheduleRow[]> {
  return db.select(scheduleCols).from(savedSchedules).where(eq(savedSchedules.userId, userId)).orderBy(desc(savedSchedules.updatedAt));
}

export async function findSchedule(db: Db, id: string, userId: string): Promise<SavedScheduleRow | null> {
  const [r] = await db.select(scheduleCols).from(savedSchedules).where(and(eq(savedSchedules.id, id), eq(savedSchedules.userId, userId))).limit(1);
  return r ?? null;
}

export async function countSchedules(db: Db, userId: string): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)` }).from(savedSchedules).where(eq(savedSchedules.userId, userId));
  return Number(r?.n ?? 0);
}

/** lockUserSchedules: transaction-scoped advisory lock on the user's schedules. */
export async function lockUserSchedules(db: Db, userId: string): Promise<void> {
  await db.execute(sql`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext('saved_schedules:' || CAST(${userId}::uuid AS text)))) l`);
}

export async function insertSchedule(db: Db, s: { id: string; userId: string; name: string; careerId: string | null; plan: string | null; payloadJson: string; isPrimary: boolean; createdAtPg: string; payloadUpdatedAtPg: string }): Promise<void> {
  await db.execute(sql`
    INSERT INTO public.saved_schedules (id, user_id, name, career_id, plan, payload, is_primary, created_at, updated_at, payload_updated_at)
    VALUES (${s.id}, ${s.userId}, ${s.name}, ${s.careerId}, ${s.plan}, ${s.payloadJson}::jsonb, ${s.isPrimary}, ${s.createdAtPg}, ${s.createdAtPg}, ${s.payloadUpdatedAtPg})`);
}

export async function updateSchedule(db: Db, id: string, s: { name: string; careerId: string | null; plan: string | null; payloadJson: string; updatedAtPg: string; payloadUpdatedAtPg?: string }): Promise<void> {
  await db.execute(sql`
    UPDATE public.saved_schedules SET name = ${s.name}, career_id = ${s.careerId}, plan = ${s.plan}, payload = ${s.payloadJson}::jsonb,
      updated_at = ${s.updatedAtPg}${s.payloadUpdatedAtPg ? sql`, payload_updated_at = ${s.payloadUpdatedAtPg}` : sql``}
    WHERE id = ${id}`);
}

/** clearPrimaryExcept: the user's current primary (other than keepId) loses the flag. */
export async function clearPrimaryExcept(db: Db, userId: string, keepId: string): Promise<void> {
  await db.execute(sql`UPDATE public.saved_schedules SET is_primary = false WHERE user_id = ${userId} AND is_primary = true AND id <> ${keepId}`);
}

export async function setPrimary(db: Db, id: string, updatedAtPg: string): Promise<void> {
  await db.execute(sql`UPDATE public.saved_schedules SET is_primary = true, updated_at = ${updatedAtPg} WHERE id = ${id}`);
}

export async function deleteSchedule(db: Db, id: string): Promise<void> {
  await db.delete(savedSchedules).where(eq(savedSchedules.id, id));
}
