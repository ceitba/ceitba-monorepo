// repository/PlanSubjectRepository, SubjectRepository, PlanRepository (the
// parts the plan, subject, commission and sync features use).

import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { plan, planSubject, subject } from '../../db/schema/academic';
import { toPgTimestamp, type Micros } from '../../lib/time';

export type PlanSubjectRow = typeof planSubject.$inferSelect;
export type SubjectRow = typeof subject.$inferSelect;

/** PlanSubject as the entity exposes it (dependencies: null array -> []). */
export interface PlanSubject {
  subjectId: string;
  planId: string;
  section: string;
  year: number;
  semester: number;
  creditsRequired: number | null;
  /** A VARCHAR[] may hold NULL elements (a request list with nulls). */
  dependencies: (string | null)[];
}

const toEntity = (r: PlanSubjectRow): PlanSubject => ({
  subjectId: r.subjectId, planId: r.planId, section: r.section, year: r.year, semester: r.semester,
  creditsRequired: r.creditsRequired, dependencies: r.dependencies ?? [],
});

// Derived queries without ORDER BY: Postgres row order, like Spring Data.
export async function findByPlanId(db: Db, planId: string): Promise<PlanSubject[]> {
  return (await db.select().from(planSubject).where(eq(planSubject.planId, planId))).map(toEntity);
}

export async function existsByPlanId(db: Db, planId: string): Promise<boolean> {
  const [row] = await db.select({ n: sql<number>`count(*)` }).from(planSubject).where(eq(planSubject.planId, planId));
  return Number(row?.n ?? 0) > 0;
}

export async function findBySubjectId(db: Db, subjectId: string): Promise<PlanSubject[]> {
  return (await db.select().from(planSubject).where(eq(planSubject.subjectId, subjectId))).map(toEntity);
}

export async function findByPlanIdAndSection(db: Db, planId: string, section: string): Promise<PlanSubject[]> {
  return (await db.select().from(planSubject).where(and(eq(planSubject.planId, planId), eq(planSubject.section, section)))).map(toEntity);
}

export async function findByPlanIdAndYear(db: Db, planId: string, year: number): Promise<PlanSubject[]> {
  return (await db.select().from(planSubject).where(and(eq(planSubject.planId, planId), eq(planSubject.year, year)))).map(toEntity);
}

export async function findByPlanIdAndYearAndSemester(db: Db, planId: string, year: number, semester: number): Promise<PlanSubject[]> {
  return (await db.select().from(planSubject)
    .where(and(eq(planSubject.planId, planId), eq(planSubject.year, year), eq(planSubject.semester, semester)))).map(toEntity);
}

export async function findPlanSubject(db: Db, subjectId: string, planId: string): Promise<PlanSubject | null> {
  const [row] = await db.select().from(planSubject)
    .where(and(eq(planSubject.subjectId, subjectId), eq(planSubject.planId, planId))).limit(1);
  return row ? toEntity(row) : null;
}

/** INSERT every column (PlanSubject.dependencies is never null: fromList(null) = []). */
export async function insertPlanSubject(db: Db, ps: PlanSubject): Promise<void> {
  await db.insert(planSubject).values({
    subjectId: ps.subjectId, planId: ps.planId, section: ps.section, year: ps.year, semester: ps.semester,
    creditsRequired: ps.creditsRequired as number, dependencies: ps.dependencies as string[],
  });
}

/** save() of a detached entity whose row exists: Hibernate merges (UPDATE every column). */
export async function updatePlanSubject(db: Db, ps: PlanSubject): Promise<void> {
  await db.update(planSubject).set({
    section: ps.section, year: ps.year, semester: ps.semester,
    creditsRequired: ps.creditsRequired as number, dependencies: ps.dependencies as string[],
  }).where(and(eq(planSubject.subjectId, ps.subjectId), eq(planSubject.planId, ps.planId)));
}

export async function deletePlanSubject(db: Db, subjectId: string, planId: string): Promise<void> {
  await db.delete(planSubject).where(and(eq(planSubject.subjectId, subjectId), eq(planSubject.planId, planId)));
}

export async function planExists(db: Db, id: string): Promise<boolean> {
  const [row] = await db.select({ n: sql<number>`count(*)` }).from(plan).where(eq(plan.id, id));
  return Number(row?.n ?? 0) > 0;
}

export async function findSubject(db: Db, id: string): Promise<SubjectRow | null> {
  const [row] = await db.select().from(subject).where(eq(subject.id, id)).limit(1);
  return row ?? null;
}

export async function subjectExists(db: Db, id: string): Promise<boolean> {
  const [row] = await db.select({ n: sql<number>`count(*)` }).from(subject).where(eq(subject.id, id));
  return Number(row?.n ?? 0) > 0;
}

/** subjectRepository.findAllById(ids). */
export function findSubjectsByIds(db: Db, ids: string[]): Promise<SubjectRow[]> {
  if (ids.length === 0) return Promise.resolve([]);
  return db.select().from(subject).where(inArray(subject.id, ids));
}

export function findAllSubjectIds(db: Db): Promise<{ id: string }[]> {
  return db.select({ id: subject.id }).from(subject);
}

/** new Subject(id, name, credits) persisted: @UpdateTimestamp on insert. */
export async function insertSubject(db: Db, id: string, name: string, credits: number, now: Micros): Promise<void> {
  await db.insert(subject).values({ id, name, credits, updatedAt: toPgTimestamp(now) });
}

export async function updateSubject(db: Db, id: string, name: string, credits: number, now: Micros): Promise<void> {
  await db.update(subject).set({ name, credits, updatedAt: toPgTimestamp(now) }).where(eq(subject.id, id));
}
