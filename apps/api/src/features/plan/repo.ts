// repository/PlanSubjectRepository, SubjectRepository, PlanRepository (the
// parts the plan, subject, commission and sync features use).

import { and, asc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { plan, planEntry, planSectionRequirement, planSubject, subject } from '../../db/schema/academic';
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

export interface PlanSectionRequirement { planId: string; section: string; credits: number; year: number; semester: number }

export function findSectionRequirements(db: Db, planId: string): Promise<PlanSectionRequirement[]> {
  return db.select().from(planSectionRequirement).where(eq(planSectionRequirement.planId, planId))
    .orderBy(asc(planSectionRequirement.year), asc(planSectionRequirement.semester), asc(planSectionRequirement.section));
}

/** The plan's rows become exactly `rows` (unique sections): the ones no longer sent are deleted, the rest upserted. */
export async function replaceSectionRequirements(db: Db, planId: string, rows: PlanSectionRequirement[]): Promise<void> {
  const keep = rows.map((r) => r.section);
  await db.delete(planSectionRequirement).where(keep.length === 0
    ? eq(planSectionRequirement.planId, planId)
    : and(eq(planSectionRequirement.planId, planId), notInArray(planSectionRequirement.section, keep)));
  if (rows.length === 0) return;
  await db.insert(planSectionRequirement).values(rows).onConflictDoUpdate({
    target: [planSectionRequirement.planId, planSectionRequirement.section],
    set: { credits: sql`excluded.credits`, year: sql`excluded.year`, semester: sql`excluded.semester` },
  });
}

/** A plan entry as fetched from ITBA (plan_entry): the plan's own values, NULL where ITBA sent none. */
export interface PlanEntry {
  subjectId: string;
  section: string | null;
  year: number | null;
  semester: number | null;
  dependencies: string[];
  creditsRequired: number | null;
  subjectName: string | null;
  subjectCredits: number;
}

/** The plan's entries in the order they were fetched, and when (Postgres text; null when none are stored). */
export async function findPlanEntries(db: Db, planId: string): Promise<{ entries: PlanEntry[]; fetchedAt: string | null }> {
  const rows = await db.select().from(planEntry).where(eq(planEntry.planId, planId)).orderBy(asc(planEntry.position));
  return {
    entries: rows.map((r) => ({
      subjectId: r.subjectId, section: r.section, year: r.year, semester: r.semester, dependencies: r.dependencies,
      creditsRequired: r.creditsRequired, subjectName: r.subjectName, subjectCredits: r.subjectCredits,
    })),
    fetchedAt: rows[0]?.fetchedAt ?? null,
  };
}

/** The plan's rows become exactly `entries`, positioned by their index. */
export async function replacePlanEntries(db: Db, planId: string, entries: PlanEntry[], now: Micros): Promise<void> {
  await db.delete(planEntry).where(eq(planEntry.planId, planId));
  if (entries.length === 0) return;
  const fetchedAt = toPgTimestamp(now);
  await db.insert(planEntry).values(entries.map((e, position) => ({ planId, position, ...e, fetchedAt })));
}
