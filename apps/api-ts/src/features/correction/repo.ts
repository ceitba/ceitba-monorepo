// repository/correction/ScheduleCorrectionRepository + ScheduleCorrectionVoteRepository
// (+ the Commission / Subject reads ScheduleCorrectionService batches).

import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { toPgTimestamp, type Micros } from '../../lib/time';
import type { CorrectionSlot } from '../commission/correctionOverlay';
import type { Commission, CommissionTime } from '../commission/repo';
import type { CorrectionStatus, VoteType } from './dto';

export interface CorrectionRow {
  id: string;
  commissionId: string;
  suggesterId: string | null;
  proposedSlots: CorrectionSlot[];
  sgaSnapshot: CorrectionSlot[];
  slotsKey: string;
  status: CorrectionStatus;
  confirmCount: number;
  rejectCount: number;
  createdAt: string;
  appliedAt: string | null;
  reviewedAt: string | null;
  reviewedByStaff: boolean;
  seenAt: string | null;
}

type Row = Record<string, unknown>;
const rowsOf = (r: unknown) => r as unknown as Row[];
const inList = (values: readonly string[]) => sql`(${sql.join(values.map((v) => sql`${v}`), sql`, `)})`;

const COLS = sql`c.id, c.commission_id, c.suggester_id, c.proposed_slots, c.sga_snapshot, c.slots_key, c.status, c.confirm_count,
  c.reject_count, c.created_at::text AS created_at, c.applied_at::text AS applied_at, c.reviewed_at::text AS reviewed_at,
  c.reviewed_by_staff, c.seen_at::text AS seen_at`;

function toRow(r: Row): CorrectionRow {
  return {
    id: r.id as string,
    commissionId: r.commission_id as string,
    suggesterId: (r.suggester_id as string | null) ?? null,
    proposedSlots: r.proposed_slots as CorrectionSlot[],
    sgaSnapshot: r.sga_snapshot as CorrectionSlot[],
    slotsKey: r.slots_key as string,
    status: r.status as CorrectionStatus,
    confirmCount: Number(r.confirm_count),
    rejectCount: Number(r.reject_count),
    createdAt: r.created_at as string,
    appliedAt: (r.applied_at as string | null) ?? null,
    reviewedAt: (r.reviewed_at as string | null) ?? null,
    reviewedByStaff: Boolean(r.reviewed_by_staff),
    seenAt: (r.seen_at as string | null) ?? null,
  };
}

async function select(db: Db, where: SQL, tail: SQL = sql``): Promise<CorrectionRow[]> {
  return rowsOf(await db.execute(sql`SELECT ${COLS} FROM public.schedule_correction c WHERE ${where} ${tail}`)).map(toRow);
}

export async function findById(db: Db, id: string): Promise<CorrectionRow | null> {
  return (await select(db, sql`c.id = ${id}`))[0] ?? null;
}

/** findCommissionIdById */
export async function findCommissionIdById(db: Db, id: string): Promise<string | null> {
  const [r] = rowsOf(await db.execute(sql`SELECT commission_id FROM public.schedule_correction WHERE id = ${id}`));
  return (r?.commission_id as string | undefined) ?? null;
}

export function findByCommissionIdAndStatusIn(db: Db, commissionId: string, statuses: readonly CorrectionStatus[]): Promise<CorrectionRow[]> {
  return select(db, sql`c.commission_id = ${commissionId} AND c.status IN ${inList(statuses)}`);
}

export async function findFirstOpenByKey(db: Db, commissionId: string, slotsKey: string, statuses: readonly CorrectionStatus[]): Promise<CorrectionRow | null> {
  return (await select(db, sql`c.commission_id = ${commissionId} AND c.slots_key = ${slotsKey} AND c.status IN ${inList(statuses)}`, sql`LIMIT 1`))[0] ?? null;
}

export async function existsPendingBySuggester(db: Db, commissionId: string, suggesterId: string): Promise<boolean> {
  const [r] = rowsOf(await db.execute(sql`SELECT count(*) AS n FROM public.schedule_correction
    WHERE commission_id = ${commissionId} AND suggester_id = ${suggesterId} AND status = 'PENDING'`));
  return Number(r?.n ?? 0) > 0;
}

/** findBySuggesterIdOrderByCreatedAtDescIdDesc */
export function findBySuggester(db: Db, suggesterId: string): Promise<CorrectionRow[]> {
  return select(db, sql`c.suggester_id = ${suggesterId}`, sql`ORDER BY c.created_at DESC, c.id DESC`);
}

export async function findByIdAndSuggester(db: Db, id: string, suggesterId: string): Promise<CorrectionRow | null> {
  return (await select(db, sql`c.id = ${id} AND c.suggester_id = ${suggesterId}`))[0] ?? null;
}

/** findByStatusOrderByCreatedAtDescIdDesc(status, pageable) */
export async function findByStatusPage(db: Db, status: CorrectionStatus, offset: number, size: number): Promise<{ rows: CorrectionRow[]; total: number }> {
  const rows = await select(db, sql`c.status = ${status}`, sql`ORDER BY c.created_at DESC, c.id DESC LIMIT ${size} OFFSET ${offset}`);
  const [r] = rowsOf(await db.execute(sql`SELECT count(*) AS n FROM public.schedule_correction WHERE status = ${status}`));
  return { rows, total: Number(r?.n ?? 0) };
}

/** findOnRunningCommissions: corrections whose commission has not ended (course_end >= today). */
export async function findOnRunningCommissionsPage(db: Db, statuses: readonly CorrectionStatus[], today: string, offset: number, size: number): Promise<{ rows: CorrectionRow[]; total: number }> {
  const where = sql`c.status IN ${inList(statuses)}
    AND EXISTS (SELECT 1 FROM public.commission m WHERE m.id = c.commission_id AND m.course_end >= ${today}::date)`;
  const rows = await select(db, where, sql`ORDER BY c.created_at DESC, c.id DESC LIMIT ${size} OFFSET ${offset}`);
  const [r] = rowsOf(await db.execute(sql`SELECT count(*) AS n FROM public.schedule_correction c WHERE ${where}`));
  return { rows, total: Number(r?.n ?? 0) };
}

/** findCommissionIdsVotedOnBy: distinct, ordered by commission id. */
export async function findCommissionIdsVotedOnBy(db: Db, userId: string): Promise<string[]> {
  return rowsOf(await db.execute(sql`SELECT DISTINCT c.commission_id FROM public.schedule_correction c
    WHERE c.id IN (SELECT v.correction_id FROM public.schedule_correction_vote v WHERE v.user_id = ${userId})
    ORDER BY c.commission_id`)).map((r) => r.commission_id as string);
}

export function findByCommissionIdVotedOnBy(db: Db, commissionId: string, userId: string): Promise<CorrectionRow[]> {
  return select(db, sql`c.commission_id = ${commissionId}
    AND c.id IN (SELECT v.correction_id FROM public.schedule_correction_vote v WHERE v.user_id = ${userId})`);
}

export async function insertCorrection(db: Db, c: { commissionId: string; suggesterId: string; proposed: CorrectionSlot[]; sga: CorrectionSlot[]; slotsKey: string }, now: Micros): Promise<string> {
  const id = crypto.randomUUID();
  const ts = toPgTimestamp(now);
  await db.execute(sql`INSERT INTO public.schedule_correction (id, commission_id, suggester_id, proposed_slots, sga_snapshot, slots_key, status,
      confirm_count, reject_count, created_at, updated_at, applied_at, reviewed_at, reviewed_by, reviewed_by_staff, seen_at)
    VALUES (${id}, ${c.commissionId}, ${c.suggesterId}, CAST(${JSON.stringify(c.proposed)} AS jsonb), CAST(${JSON.stringify(c.sga)} AS jsonb),
      ${c.slotsKey}, 'PENDING', 0, 0, ${ts}, ${ts}, NULL, NULL, NULL, false, NULL)`);
  return id;
}

/** A flush of the dirty fields; @UpdateTimestamp moves updated_at. */
export async function update(db: Db, id: string, set: Partial<{ status: CorrectionStatus; confirmCount: number; rejectCount: number; appliedAt: Micros; reviewedAt: Micros; reviewedBy: string | null; seenAt: Micros }>, now: Micros): Promise<void> {
  const parts: SQL[] = [];
  if (set.status !== undefined) parts.push(sql`status = ${set.status}`);
  if (set.confirmCount !== undefined) parts.push(sql`confirm_count = ${set.confirmCount}`);
  if (set.rejectCount !== undefined) parts.push(sql`reject_count = ${set.rejectCount}`);
  if (set.appliedAt !== undefined) parts.push(sql`applied_at = ${toPgTimestamp(set.appliedAt)}`);
  if (set.reviewedAt !== undefined) parts.push(sql`reviewed_at = ${toPgTimestamp(set.reviewedAt)}, reviewed_by_staff = true`);
  if (set.reviewedBy !== undefined) parts.push(sql`reviewed_by = ${set.reviewedBy}`);
  if (set.seenAt !== undefined) parts.push(sql`seen_at = ${toPgTimestamp(set.seenAt)}`);
  if (!parts.length) return;
  parts.push(sql`updated_at = ${toPgTimestamp(now)}`);
  await db.execute(sql`UPDATE public.schedule_correction SET ${sql.join(parts, sql`, `)} WHERE id = ${id}`);
}

// ---------------------------------------------------------------- votes

export async function findVote(db: Db, correctionId: string, userId: string): Promise<VoteType | null> {
  const [r] = rowsOf(await db.execute(sql`SELECT type FROM public.schedule_correction_vote WHERE correction_id = ${correctionId} AND user_id = ${userId}`));
  return (r?.type as VoteType | undefined) ?? null;
}

export async function insertVote(db: Db, correctionId: string, userId: string, type: VoteType, now: Micros): Promise<void> {
  const ts = toPgTimestamp(now);
  await db.execute(sql`INSERT INTO public.schedule_correction_vote (correction_id, user_id, type, created_at, updated_at)
    VALUES (${correctionId}, ${userId}, ${type}, ${ts}, ${ts})`);
}

export async function updateVote(db: Db, correctionId: string, userId: string, type: VoteType, now: Micros): Promise<void> {
  await db.execute(sql`UPDATE public.schedule_correction_vote SET type = ${type}, updated_at = ${toPgTimestamp(now)}
    WHERE correction_id = ${correctionId} AND user_id = ${userId}`);
}

export async function deleteVote(db: Db, correctionId: string, userId: string): Promise<void> {
  await db.execute(sql`DELETE FROM public.schedule_correction_vote WHERE correction_id = ${correctionId} AND user_id = ${userId}`);
}

export async function countVotes(db: Db, correctionId: string, type: VoteType): Promise<number> {
  const [r] = rowsOf(await db.execute(sql`SELECT count(*) AS n FROM public.schedule_correction_vote WHERE correction_id = ${correctionId} AND type = ${type}`));
  return Number(r?.n ?? 0);
}

/** findByUserIdAndCorrectionIdIn: correctionId -> type. */
export async function votesOf(db: Db, userId: string, correctionIds: readonly string[]): Promise<Map<string, VoteType>> {
  if (!correctionIds.length) return new Map();
  const rows = rowsOf(await db.execute(sql`SELECT correction_id, type FROM public.schedule_correction_vote
    WHERE user_id = ${userId} AND correction_id IN ${inList(correctionIds)}`));
  return new Map(rows.map((r) => [r.correction_id as string, r.type as VoteType]));
}

// ---------------------------------------------------------------- commissions / subjects

/** commissions.findByIdInWithTimes */
export async function commissionsWithTimes(db: Db, ids: readonly string[]): Promise<Map<string, Commission>> {
  if (!ids.length) return new Map();
  const cs = rowsOf(await db.execute(sql`SELECT id, subject_code, commission_name, course_start::text AS course_start, course_end::text AS course_end,
      enrolled_students, quota, subject_type::text AS subject_type, term_year, term_period
    FROM public.commission WHERE id IN ${inList(ids)}`));
  const ts = rowsOf(await db.execute(sql`SELECT course_id, day::text AS day, classroom, building, hour_from::text AS hour_from, hour_to::text AS hour_to
    FROM public.commission_time WHERE course_id IN ${inList(ids)} ORDER BY day, hour_from`));
  const out = new Map<string, Commission>();
  for (const r of cs) {
    out.set(r.id as string, {
      id: r.id as string, subjectCode: r.subject_code as string, commissionName: r.commission_name as string,
      courseStart: r.course_start as string, courseEnd: r.course_end as string, enrolledStudents: Number(r.enrolled_students),
      quota: Number(r.quota), subjectType: r.subject_type, termYear: r.term_year ?? null, termPeriod: r.term_period ?? null,
      times: [],
    } as unknown as Commission);
  }
  for (const t of ts) {
    out.get(t.course_id as string)?.times.push({
      courseId: t.course_id as string, day: t.day as CommissionTime['day'], classroom: t.classroom as string,
      building: t.building as string, hourFrom: t.hour_from as string, hourTo: t.hour_to as string,
    });
  }
  return out;
}

export async function subjectNames(db: Db, ids: readonly string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = rowsOf(await db.execute(sql`SELECT id, name FROM public.subject WHERE id IN ${inList(ids)}`));
  return new Map(rows.map((r) => [r.id as string, r.name as string]));
}
