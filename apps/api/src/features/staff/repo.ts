// repository/{CeitbaStaff,CeitbaModerator,StaffMember,StaffDepartment,Benefit,BenefitCard}Repository.

import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { benefitCards, benefits, staffDepartments, staffMembers } from '../../db/schema/cms';
import { ceitbaModerators, ceitbaStaff, user } from '../../db/schema/identity';

export type StaffRow = typeof ceitbaStaff.$inferSelect;
export type ModeratorRow = typeof ceitbaModerators.$inferSelect;
export type DepartmentRow = typeof staffDepartments.$inferSelect;
export type MemberRow = typeof staffMembers.$inferSelect;
export type BenefitRow = typeof benefits.$inferSelect;
export type BenefitCardRow = typeof benefitCards.$inferSelect;
export type UserBrief = { id: string; email: string; name: string | null };

// ---------------------------------------------------------------- users

export async function findUserByEmail(db: Db, email: string): Promise<UserBrief | null> {
  const [r] = await db.select({ id: user.id, email: user.email, name: user.name }).from(user).where(eq(user.email, email)).limit(1);
  return r ?? null;
}

export async function usersByIds(db: Db, ids: string[]): Promise<UserBrief[]> {
  if (ids.length === 0) return [];
  return db.select({ id: user.id, email: user.email, name: user.name }).from(user).where(inArray(user.id, ids));
}

// ---------------------------------------------------------------- ceitba_staff

const active = (nowPg: string) => and(sql`${ceitbaStaff.start} <= ${nowPg}`, sql`${ceitbaStaff.end} >= ${nowPg}`);

/** findAllActive(now) ORDER BY userId, with the user (StaffResponse reads it). */
export function findAllActiveStaff(db: Db, nowPg: string) {
  return db.select({ staff: ceitbaStaff, email: user.email, name: user.name }).from(ceitbaStaff)
    .innerJoin(user, eq(user.id, ceitbaStaff.userId)).where(active(nowPg)).orderBy(asc(ceitbaStaff.userId));
}

/** findAllActiveForUpdate(now): the same rows locked FOR UPDATE, in user order. */
export async function lockActiveStaff(db: Db, nowPg: string): Promise<StaffRow[]> {
  return db.select().from(ceitbaStaff).where(active(nowPg)).orderBy(asc(ceitbaStaff.userId)).for('update');
}

export async function findStaff(db: Db, userId: string): Promise<StaffRow | null> {
  const [r] = await db.select().from(ceitbaStaff).where(eq(ceitbaStaff.userId, userId)).limit(1);
  return r ?? null;
}

export async function isActiveStaffAt(db: Db, userId: string, nowPg: string): Promise<boolean> {
  const [r] = await db.select({ n: sql<number>`count(*)` }).from(ceitbaStaff).where(and(eq(ceitbaStaff.userId, userId), active(nowPg)));
  return Number(r?.n ?? 0) > 0;
}

export async function deleteStaff(db: Db, userId: string): Promise<void> {
  await db.delete(ceitbaStaff).where(eq(ceitbaStaff.userId, userId));
}

export async function insertStaff(db: Db, row: { userId: string; branch: StaffRow['branch']; role: StaffRow['role']; start: string; end: string }): Promise<void> {
  await db.insert(ceitbaStaff).values(row);
}

// ---------------------------------------------------------------- ceitba_moderators

/** findByRevokedAtIsNullOrderByGrantedAtAsc. */
export function activeModerators(db: Db): Promise<ModeratorRow[]> {
  return db.select().from(ceitbaModerators).where(isNull(ceitbaModerators.revokedAt)).orderBy(asc(ceitbaModerators.grantedAt));
}

export async function findModerator(db: Db, userId: string): Promise<ModeratorRow | null> {
  const [r] = await db.select().from(ceitbaModerators).where(eq(ceitbaModerators.userId, userId)).limit(1);
  return r ?? null;
}

export async function insertModerator(db: Db, userId: string, grantedBy: string | null, grantedAtPg: string): Promise<void> {
  await db.insert(ceitbaModerators).values({ userId, grantedBy, grantedAt: grantedAtPg, revokedAt: null, revokedBy: null });
}

export async function updateModerator(db: Db, userId: string, set: Partial<Pick<ModeratorRow, 'grantedBy' | 'grantedAt' | 'revokedAt' | 'revokedBy'>>): Promise<void> {
  await db.update(ceitbaModerators).set(set).where(eq(ceitbaModerators.userId, userId));
}

// ---------------------------------------------------------------- roster

/** findAllByOrderByDisplayOrderAsc. */
export function allDepartments(db: Db): Promise<DepartmentRow[]> {
  return db.select().from(staffDepartments).orderBy(asc(staffDepartments.displayOrder));
}

export async function findDepartment(db: Db, slug: string): Promise<DepartmentRow | null> {
  const [r] = await db.select().from(staffDepartments).where(eq(staffDepartments.slug, slug)).limit(1);
  return r ?? null;
}

export async function updateDepartment(db: Db, slug: string, colorVar: string, displayOrder: number, nowPg: string): Promise<void> {
  await db.update(staffDepartments).set({ colorVar, displayOrder, updatedAt: nowPg }).where(eq(staffDepartments.slug, slug));
}

/** findDistinctYearsDesc. */
export async function distinctYearsDesc(db: Db): Promise<number[]> {
  const rows = await db.selectDistinct({ year: staffMembers.year }).from(staffMembers).orderBy(desc(staffMembers.year));
  return rows.map((r) => r.year);
}

/** findAllByYearOrderByDepartmentSlugAscDisplayOrderAscNameAsc. */
export function membersOfYear(db: Db, year: number): Promise<MemberRow[]> {
  return db.select().from(staffMembers).where(eq(staffMembers.year, year))
    .orderBy(asc(staffMembers.departmentSlug), asc(staffMembers.displayOrder), asc(staffMembers.name));
}

export async function findMember(db: Db, id: string): Promise<MemberRow | null> {
  const [r] = await db.select().from(staffMembers).where(eq(staffMembers.id, id)).limit(1);
  return r ?? null;
}

export async function insertMember(db: Db, row: Omit<MemberRow, 'createdAt' | 'updatedAt'> & { createdAt: string; updatedAt: string }): Promise<void> {
  await db.insert(staffMembers).values(row);
}

export async function updateMember(db: Db, id: string, set: Partial<MemberRow>): Promise<void> {
  await db.update(staffMembers).set(set).where(eq(staffMembers.id, id));
}

export async function deleteMember(db: Db, id: string): Promise<void> {
  await db.delete(staffMembers).where(eq(staffMembers.id, id));
}

// ---------------------------------------------------------------- benefits

/** findAllByOrderByDisplayOrderAsc. */
export function allBenefits(db: Db): Promise<BenefitRow[]> {
  return db.select().from(benefits).orderBy(asc(benefits.displayOrder));
}

export async function findBenefit(db: Db, slug: string): Promise<BenefitRow | null> {
  const [r] = await db.select().from(benefits).where(eq(benefits.slug, slug)).limit(1);
  return r ?? null;
}

export async function benefitExists(db: Db, slug: string): Promise<boolean> {
  return (await findBenefit(db, slug)) !== null;
}

export async function insertBenefit(db: Db, row: BenefitRow): Promise<void> {
  await db.insert(benefits).values(row);
}

export async function updateBenefit(db: Db, slug: string, set: Partial<BenefitRow>): Promise<void> {
  await db.update(benefits).set(set).where(eq(benefits.slug, slug));
}

export async function deleteBenefit(db: Db, slug: string): Promise<void> {
  await db.delete(benefits).where(eq(benefits.slug, slug));
}

/** findAllByOrderByDisplayOrderAscTitleEsAsc. */
export function allBenefitCards(db: Db): Promise<BenefitCardRow[]> {
  return db.select().from(benefitCards).orderBy(asc(benefitCards.displayOrder), asc(benefitCards.titleEs));
}

export async function findBenefitCard(db: Db, id: string): Promise<BenefitCardRow | null> {
  const [r] = await db.select().from(benefitCards).where(eq(benefitCards.id, id)).limit(1);
  return r ?? null;
}

export async function insertBenefitCard(db: Db, row: BenefitCardRow): Promise<void> {
  await db.insert(benefitCards).values(row);
}

export async function updateBenefitCard(db: Db, id: string, set: Partial<BenefitCardRow>): Promise<void> {
  await db.update(benefitCards).set(set).where(eq(benefitCards.id, id));
}

export async function deleteBenefitCard(db: Db, id: string): Promise<void> {
  await db.delete(benefitCards).where(eq(benefitCards.id, id));
}
