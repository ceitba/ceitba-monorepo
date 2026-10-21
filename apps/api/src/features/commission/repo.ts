// repository/CommissionRepository + CommissionTimeRepository (the queries the
// commission, subject, classroom and sync features use). Commissions come back
// with their `times` hydrated (the @EntityGraph queries), ordered like
// @OrderBy("day ASC, hourFrom ASC") (day_of_week enum order).

import { sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import type { DayOfWeek, SubjectType } from '../../external/itba';

export interface CommissionTime {
  courseId: string;
  day: DayOfWeek;
  classroom: string;
  building: string;
  /** Postgres TIME text (`HH:mm:ss[.ffffff]`). */
  hourFrom: string;
  hourTo: string;
}

export interface Commission {
  id: string;
  subjectCode: string;
  commissionName: string;
  /** LocalDate `YYYY-MM-DD`. */
  courseStart: string;
  courseEnd: string;
  enrolledStudents: number;
  quota: number;
  subjectType: SubjectType;
  termYear: number | null;
  termPeriod: string | null;
  times: CommissionTime[];
}

type Row = Record<string, unknown>;

const toCommission = (r: Row): Commission => ({
  id: r.id as string,
  subjectCode: r.subject_code as string,
  commissionName: r.commission_name as string,
  courseStart: r.course_start as string,
  courseEnd: r.course_end as string,
  enrolledStudents: Number(r.enrolled_students),
  quota: Number(r.quota),
  subjectType: r.subject_type as SubjectType,
  termYear: r.term_year === null || r.term_year === undefined ? null : Number(r.term_year),
  termPeriod: (r.term_period as string | null) ?? null,
  times: [],
});

const toTime = (r: Row): CommissionTime => ({
  courseId: r.course_id as string,
  day: r.day as DayOfWeek,
  classroom: r.classroom as string,
  building: r.building as string,
  hourFrom: r.hour_from as string,
  hourTo: r.hour_to as string,
});

const COLS = sql`c.id, c.subject_code, c.commission_name, c.course_start::text AS course_start, c.course_end::text AS course_end,
  c.enrolled_students, c.quota, c.subject_type::text AS subject_type, c.term_year, c.term_period`;

async function hydrate(db: Db, commissions: Commission[]): Promise<Commission[]> {
  if (commissions.length === 0) return commissions;
  const ids = commissions.map((c) => c.id);
  const rows = (await db.execute(sql`
    SELECT ct.course_id, ct.day::text AS day, ct.classroom, ct.building, ct.hour_from::text AS hour_from, ct.hour_to::text AS hour_to
    FROM public.commission_time ct WHERE ct.course_id IN ${sql`(${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`}
    ORDER BY ct.course_id, ct.day ASC, ct.hour_from ASC`)) as unknown as Row[];
  const byId = new Map(commissions.map((c) => [c.id, c]));
  for (const r of rows) byId.get(r.course_id as string)?.times.push(toTime(r));
  return commissions;
}

/** findBySubjectCodeInWithTimes: every synced commission (all terms) of the subjects. */
export async function findBySubjectCodeInWithTimes(db: Db, codes: string[]): Promise<Commission[]> {
  if (codes.length === 0) return [];
  const rows = (await db.execute(sql`
    SELECT ${COLS} FROM public.commission c
    WHERE c.subject_code IN ${sql`(${sql.join(codes.map((i) => sql`${i}`), sql`, `)})`}
    ORDER BY c.subject_code, c.course_start, c.commission_name, c.id`)) as unknown as Row[];
  return hydrate(db, rows.map(toCommission));
}

/** findCurrentByPlanWithTimes: not-ended commissions of the plan's subjects. */
export async function findCurrentByPlanWithTimes(db: Db, planId: string, today: string): Promise<Commission[]> {
  const rows = (await db.execute(sql`
    SELECT DISTINCT ${COLS} FROM public.commission c
    WHERE c.course_end >= ${today}::date
      AND c.subject_code IN (SELECT ps.subject_id FROM public.plan_subject ps WHERE ps.plan_id = ${planId})
    ORDER BY c.subject_code, c.commission_name, c.id`)) as unknown as Row[];
  return hydrate(db, rows.map(toCommission));
}

/** findForUpdate: SELECT ... FOR UPDATE on the commission row, times hydrated (lazy load). */
export async function findForUpdate(db: Db, id: string): Promise<Commission | null> {
  const rows = (await db.execute(sql`SELECT ${COLS} FROM public.commission c WHERE c.id = ${id} FOR UPDATE`)) as unknown as Row[];
  if (rows.length === 0) return null;
  return (await hydrate(db, [toCommission(rows[0]!)]))[0]!;
}

export async function insertCommission(db: Db, c: Commission): Promise<void> {
  await db.execute(sql`
    INSERT INTO public.commission (id, subject_code, commission_name, course_start, course_end, enrolled_students, quota,
                                   subject_type, term_year, term_period)
    VALUES (${c.id}, ${c.subjectCode}, ${c.commissionName}, ${c.courseStart}::date, ${c.courseEnd}::date, ${c.enrolledStudents},
            ${c.quota}, ${c.subjectType}::subject_type, ${c.termYear}, ${c.termPeriod})`);
}

export async function updateCommission(db: Db, c: Commission): Promise<void> {
  await db.execute(sql`
    UPDATE public.commission SET subject_code = ${c.subjectCode}, commission_name = ${c.commissionName},
      course_start = ${c.courseStart}::date, course_end = ${c.courseEnd}::date, enrolled_students = ${c.enrolledStudents},
      quota = ${c.quota}, subject_type = ${c.subjectType}::subject_type, term_year = ${c.termYear}, term_period = ${c.termPeriod}
    WHERE id = ${c.id}`);
}

export async function deleteTimes(db: Db, courseId: string): Promise<void> {
  await db.execute(sql`DELETE FROM public.commission_time WHERE course_id = ${courseId}`);
}

export async function insertTime(db: Db, t: CommissionTime): Promise<void> {
  await db.execute(sql`
    INSERT INTO public.commission_time (course_id, day, hour_from, classroom, building, hour_to)
    VALUES (${t.courseId}, ${t.day}::day_of_week, ${t.hourFrom}::time, ${t.classroom}, ${t.building}, ${t.hourTo}::time)`);
}

// ---------------------------------------------------------------- CommissionTimeRepository

/** findAllOrdered: SELECT DISTINCT ct ORDER BY building, classroom, day, hourFrom. */
export async function findAllTimesOrdered(db: Db): Promise<CommissionTime[]> {
  const rows = (await db.execute(sql`
    SELECT DISTINCT ct.course_id, ct.day, ct.classroom, ct.building, ct.hour_from, ct.hour_to
    FROM public.commission_time ct ORDER BY ct.building, ct.classroom, ct.day, ct.hour_from`)) as unknown as Row[];
  return rows.map((r) => toTime({ ...r, day: String(r.day), hour_from: String(r.hour_from), hour_to: String(r.hour_to) }));
}

/** findActiveOrdered(today): times of commissions running today (course_start <= today <= course_end). */
export async function findActiveTimesOrdered(db: Db, today: string): Promise<CommissionTime[]> {
  const rows = (await db.execute(sql`
    SELECT ct.course_id, ct.day, ct.classroom, ct.building, ct.hour_from, ct.hour_to
    FROM public.commission_time ct JOIN public.commission c ON c.id = ct.course_id
    WHERE c.course_start <= ${today}::date AND c.course_end >= ${today}::date
    ORDER BY ct.building, ct.classroom, ct.day, ct.hour_from`)) as unknown as Row[];
  return rows.map((r) => toTime({ ...r, day: String(r.day), hour_from: String(r.hour_from), hour_to: String(r.hour_to) }));
}

// ---- schedule corrections read by the overlay (commission/correctionOverlay.ts; raw rows, mapped there)

const inList = (values: readonly string[]) => sql`(${sql.join(values.map((v) => sql`${v}`), sql`, `)})`;

/** schedule_correction rows of these commissions in these statuses (created_at as Postgres text). */
export async function correctionRowsOf(db: Db, commissionIds: readonly string[], statuses: readonly string[]): Promise<Record<string, unknown>[]> {
  return (await db.execute(sql`
    SELECT id, commission_id, proposed_slots, sga_snapshot, status, confirm_count, reject_count, created_at::text AS created_at
    FROM public.schedule_correction WHERE commission_id IN ${inList(commissionIds)} AND status IN ${inList(statuses)}`)) as unknown as Record<string, unknown>[];
}

/** The user's votes on these corrections: {correction_id, type}. */
export async function correctionVotesOf(db: Db, userId: string, correctionIds: readonly string[]): Promise<Record<string, unknown>[]> {
  return (await db.execute(sql`
    SELECT correction_id, type FROM public.schedule_correction_vote
    WHERE user_id = ${userId} AND correction_id IN ${inList(correctionIds)}`)) as unknown as Record<string, unknown>[];
}

export async function setCorrectionStatus(db: Db, id: string, status: string, updatedAt: string): Promise<void> {
  await db.execute(sql`UPDATE public.schedule_correction SET status = ${status}, updated_at = ${updatedAt} WHERE id = ${id}`);
}
