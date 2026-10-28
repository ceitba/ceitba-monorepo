// repository/PlanSubjectRepository, SubjectRepository, PlanRepository (the
// parts the plan, subject, commission and sync features use). plan_subject is
// only written by the sync now (one more release, for rollback); every reader
// uses plan_entry_effective.

import { and, asc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { plan, planEntry, planEntryOverride, planSectionRequirement, planSubject, subject } from '../../db/schema/academic';
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

/** A plan's entries with the staff edits applied (plan_entry_effective), in plan order. */
export interface EffectiveEntry extends PlanEntry {
  planId: string;
  position: number;
  /** ITBA, BACKFILL (copied from plan_subject until the first sync) or STAFF (edited or added by staff). */
  source: string;
}

type ViewRow = {
  plan_id: string; position: number; subject_id: string; section: string | null; year: number | null; semester: number | null;
  dependencies: (string | null)[] | null; credits_required: number | null; subject_name: string | null; subject_credits: number | null; source: string;
};
const toEffective = (r: ViewRow): EffectiveEntry => ({
  planId: r.plan_id, position: Number(r.position), subjectId: r.subject_id, section: r.section, year: r.year, semester: r.semester,
  dependencies: (r.dependencies ?? []).filter((d): d is string => d !== null), creditsRequired: r.credits_required,
  subjectName: r.subject_name, subjectCredits: Number(r.subject_credits ?? 0), source: r.source,
});

/** Filters of GET /v1/plans/{planId}/subjects: NULL year/semester count as 0 (electives). */
export interface EntryFilter { year?: number; semester?: number; section?: string }

export async function findEffectiveEntries(db: Db, planId: string, f: EntryFilter = {}): Promise<EffectiveEntry[]> {
  const rows = await db.execute<ViewRow>(sql`
    SELECT * FROM public.plan_entry_effective
    WHERE plan_id = ${planId}
      ${f.year !== undefined ? sql`AND COALESCE(year, 0) = ${f.year}` : sql``}
      ${f.semester !== undefined ? sql`AND COALESCE(semester, 0) = ${f.semester}` : sql``}
      ${f.section !== undefined ? sql`AND section = ${f.section}` : sql``}
    ORDER BY position`);
  return [...rows].map(toEffective);
}

/** Every entry of a subject across plans (plan id, then plan order). */
export async function findEffectiveEntriesOfSubject(db: Db, subjectId: string): Promise<EffectiveEntry[]> {
  const rows = await db.execute<ViewRow>(sql`
    SELECT * FROM public.plan_entry_effective WHERE subject_id = ${subjectId} ORDER BY plan_id, position`);
  return [...rows].map(toEffective);
}

/** The subject's first entry in the plan (it may sit in several sections). */
export async function findEffectiveEntry(db: Db, planId: string, subjectId: string): Promise<EffectiveEntry | null> {
  const rows = await db.execute<ViewRow>(sql`
    SELECT * FROM public.plan_entry_effective WHERE plan_id = ${planId} AND subject_id = ${subjectId} ORDER BY position LIMIT 1`);
  const [r] = [...rows];
  return r ? toEffective(r) : null;
}

export async function effectiveEntriesExist(db: Db, planId: string): Promise<boolean> {
  const rows = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM public.plan_entry_effective WHERE plan_id = ${planId}`);
  return Number([...rows][0]?.n ?? 0) > 0;
}

/** True once the sync stored the plan from ITBA (BACKFILL rows don't count). */
export async function syncedFromItba(db: Db, planId: string): Promise<boolean> {
  const rows = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM public.plan_entry WHERE plan_id = ${planId} AND source = 'ITBA'`);
  return Number([...rows][0]?.n ?? 0) > 0;
}


/** When the plan's ITBA rows were stored (Postgres text), or null. */
export async function planFetchedAt(db: Db, planId: string): Promise<string | null> {
  const [row] = await db.select({ at: planEntry.fetchedAt }).from(planEntry)
    .where(and(eq(planEntry.planId, planId), eq(planEntry.source, 'ITBA'))).limit(1);
  return row?.at ?? null;
}

/** The plan's rows become exactly `entries` from ITBA, positioned by their index. */
export async function replacePlanEntries(db: Db, planId: string, entries: PlanEntry[], now: Micros): Promise<void> {
  await db.delete(planEntry).where(eq(planEntry.planId, planId));
  if (entries.length === 0) return;
  const fetchedAt = toPgTimestamp(now);
  await db.insert(planEntry).values(entries.map((e, position) => ({ planId, position, ...e, fetchedAt, source: 'ITBA' })));
}

/** ITBA's raw copy of a plan (no staff edits), in plan order: what the fake ITBA client replays. */
export async function findItbaEntries(db: Db, planId: string): Promise<PlanEntry[]> {
  const rows = await db.select().from(planEntry).where(eq(planEntry.planId, planId)).orderBy(asc(planEntry.position));
  return rows.map((r) => ({
    subjectId: r.subjectId, section: r.section, year: r.year, semester: r.semester, dependencies: r.dependencies,
    creditsRequired: r.creditsRequired, subjectName: r.subjectName, subjectCredits: r.subjectCredits,
  }));
}

/** Fields a staff edit sets; null leaves the value to ITBA (or to the previous edit). */
export interface EntryFields {
  section: string | null;
  year: number | null;
  semester: number | null;
  dependencies: string[] | null;
  creditsRequired: number | null;
}

/** A subject staff add to the plan (added: listed after ITBA's entries with these values). */
export async function addOverride(db: Db, planId: string, subjectId: string, f: EntryFields, now: Micros): Promise<void> {
  const at = toPgTimestamp(now);
  await db.insert(planEntryOverride).values({ planId, subjectId, added: true, hidden: false, ...f, createdAt: at, updatedAt: at })
    .onConflictDoUpdate({ target: [planEntryOverride.planId, planEntryOverride.subjectId], set: { added: true, hidden: false, ...f, updatedAt: at } });
}

/**
 * A patch on the subject's entries, merged in one statement (concurrent patches to different fields both stay):
 * each non-null field replaces the stored one; a hidden subject shows again.
 */
export async function patchOverride(db: Db, planId: string, subjectId: string, f: EntryFields, now: Micros): Promise<void> {
  const at = toPgTimestamp(now);
  const keep = (col: string) => sql.raw(`COALESCE(EXCLUDED.${col}, plan_entry_override.${col})`);
  await db.insert(planEntryOverride).values({ planId, subjectId, added: false, hidden: false, ...f, createdAt: at, updatedAt: at })
    .onConflictDoUpdate({ target: [planEntryOverride.planId, planEntryOverride.subjectId], set: {
      hidden: false, section: keep('section'), year: keep('year'), semester: keep('semester'),
      dependencies: keep('dependencies'), creditsRequired: keep('credits_required'), updatedAt: at,
    } });
}

/** Leaves the subject out of the plan, keeping any patch for when it shows again. */
export async function hideOverride(db: Db, planId: string, subjectId: string, now: Micros): Promise<void> {
  const at = toPgTimestamp(now);
  await db.insert(planEntryOverride).values({ planId, subjectId, added: false, hidden: true, section: null, year: null, semester: null,
    dependencies: null, creditsRequired: null, createdAt: at, updatedAt: at })
    .onConflictDoUpdate({ target: [planEntryOverride.planId, planEntryOverride.subjectId], set: { hidden: true, updatedAt: at } });
}

export async function deleteOverride(db: Db, planId: string, subjectId: string): Promise<void> {
  await db.delete(planEntryOverride).where(and(eq(planEntryOverride.planId, planId), eq(planEntryOverride.subjectId, subjectId)));
}

/** The sections ITBA's copy lists the subject in (plan order). */
export async function itbaSectionsOf(db: Db, planId: string, subjectId: string): Promise<(string | null)[]> {
  const rows = await db.select({ section: planEntry.section }).from(planEntry)
    .where(and(eq(planEntry.planId, planId), eq(planEntry.subjectId, subjectId))).orderBy(asc(planEntry.position));
  return rows.map((r) => r.section);
}
