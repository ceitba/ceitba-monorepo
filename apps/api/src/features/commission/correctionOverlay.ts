// The read overlays and the sync hook of service/correction/ScheduleCorrectionService
// (organizedCommissions, effectiveSlots, onSgaSlotsChanged) plus the
// CorrectionSlots/CorrectionSlot helpers they need. Ported here because
// GET /v1/subjects, GET /v1/commissions and the DataSync upsert call them; the
// schedule-correction feature (web/correction) owns the rest of that service
// and may move these into its own module.

import type { Db } from '../../db/client';
import type { DayOfWeek } from '../../external/itba';
import { compareUuid, DAY_NAMES, javaCompareStrings } from '../../lib/javaCompat';
import { formatInstant, parsePgTimestamp, systemNowMicros, toPgTimestamp } from '../../lib/time';
import * as repo from './repo';
import type { Commission, CommissionTime } from './repo';

/** domain/correction/CorrectionSlot: {"day":"TUESDAY","from":"08:00","to":"11:00"}. */
export interface CorrectionSlot { day: string; from: string; to: string }

/** service/correction/EffectiveSlot. Times as `HH:mm:ss[.fff]` LocalTime text. */
export interface EffectiveSlot { day: DayOfWeek; from: string; to: string; classroom: string; building: string }

/** OrganizedSubjectsResponse.Schedule. */
export interface Schedule { day: string; classroom: string; building: string; time_from: string; time_to: string }

/** OrganizedSubjectsResponse.Correction. */
export interface CorrectionDto {
  id: string;
  status: string;
  schedule: Schedule[];
  confirms: number;
  rejects: number;
  my_vote: string | null;
  created_at: string | null;
}

/** OrganizedSubjectsResponse.Commission: sga_schedule is @JsonInclude(NON_NULL). */
export interface OrganizedCommission {
  commission_id: string;
  name: string;
  course_start: string;
  course_end: string;
  schedule: Schedule[];
  sga_schedule?: Schedule[];
  corrections: CorrectionDto[];
}

const ordinal = (day: string) => DAY_NAMES.indexOf(day as (typeof DAY_NAMES)[number]);

/** LocalTime text normalized to `HH:mm:ss[.fff]` (java.sql.Time keeps milliseconds). */
function localTime(pg: string): string {
  const m = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?/.exec(pg)!;
  const ms = (m[4] ?? '').slice(0, 3).replace(/0+$/, '');
  return `${m[1]}:${m[2]}:${m[3] ?? '00'}${ms ? `.${ms.padEnd(3, '0')}` : ''}`;
}

/** DateTimeFormatter "HH:mm". */
export const hhmm = (t: string) => t.slice(0, 5);
/** DateTimeFormatter "HH:mm:ss". */
const hhmmss = (t: string) => localTime(t).slice(0, 8);

/** CorrectionSlot.ORDER: day ordinal, then from, then to (String compare). */
export function compareSlots(a: CorrectionSlot, b: CorrectionSlot): number {
  return ordinal(a.day) - ordinal(b.day) || javaCompareStrings(a.from, b.from) || javaCompareStrings(a.to, b.to);
}

const slotKey = (s: CorrectionSlot) => `${s.day} ${s.from}-${s.to}`;

/** CorrectionSlots.fromTimes: the SGA slots normalized like a proposal. */
export function fromTimes(times: readonly CommissionTime[]): CorrectionSlot[] {
  return times.map((t) => ({ day: t.day, from: hhmm(localTime(t.hourFrom)), to: hhmm(localTime(t.hourTo)) })).sort(compareSlots);
}

/** CorrectionSlots.sameSet: equal normalized (day, from, to) lists; rooms never compared. */
export function sameSet(a: readonly CorrectionSlot[], b: readonly CorrectionSlot[]): boolean {
  const key = (l: readonly CorrectionSlot[]) => [...l].sort(compareSlots).map(slotKey).join('|');
  return key(a) === key(b);
}

/** CorrectionSlots.sga: SGA slots as served, ordered by day, start, end. */
export function sga(times: readonly CommissionTime[]): EffectiveSlot[] {
  return times.map((t) => ({ day: t.day, from: localTime(t.hourFrom), to: localTime(t.hourTo), classroom: t.classroom, building: t.building }))
    .sort((a, b) => ordinal(a.day) - ordinal(b.day) || javaCompareStrings(a.from, b.from) || javaCompareStrings(a.to, b.to));
}

/** CorrectionSlots.withRooms: slot i borrows the room of SGA slot i; extra slots get "". */
export function withRooms(proposed: readonly CorrectionSlot[], sgaSlots: readonly EffectiveSlot[]): EffectiveSlot[] {
  return [...proposed].sort(compareSlots).map((p, i) => {
    const room = sgaSlots[i];
    return { day: p.day as DayOfWeek, from: localTime(p.from), to: localTime(p.to), classroom: room ? room.classroom : '', building: room ? room.building : '' };
  });
}

/** CorrectionSlots.toSchedule. */
export function toSchedule(slots: readonly EffectiveSlot[]): Schedule[] {
  return slots.map((s) => ({ day: s.day, classroom: s.classroom, building: s.building, time_from: hhmmss(s.from), time_to: hhmmss(s.to) }));
}

interface CorrectionRow {
  id: string;
  commissionId: string;
  proposedSlots: CorrectionSlot[];
  sgaSnapshot: CorrectionSlot[];
  status: string;
  confirmCount: number;
  rejectCount: number;
  createdAt: string | null;
}


/** Hibernate's JSON mapping of List<CorrectionSlot>: anything but an array (or null) fails to read. */
function slotList(v: unknown): CorrectionSlot[] {
  if (v === null || v === undefined) return null as unknown as CorrectionSlot[];
  if (!Array.isArray(v)) throw new Error('Could not deserialize string to java type: java.util.List<CorrectionSlot>');
  return v as CorrectionSlot[];
}

async function findByCommissionIdInAndStatusIn(db: Db, ids: string[], statuses: string[]): Promise<CorrectionRow[]> {
  const rows = await repo.correctionRowsOf(db, ids, statuses);
  return rows.map((r) => ({
    id: r.id as string,
    commissionId: r.commission_id as string,
    proposedSlots: slotList(r.proposed_slots),
    sgaSnapshot: slotList(r.sga_snapshot),
    status: r.status as string,
    confirmCount: Number(r.confirm_count),
    rejectCount: Number(r.reject_count),
    createdAt: (r.created_at as string | null) ?? null,
  }));
}

/** PUBLIC_ORDER: APPLIED first, then most confirmed, then oldest (nulls last), then id. */
function publicOrder(a: CorrectionRow, b: CorrectionRow): number {
  const ap = a.status === 'APPLIED' ? 0 : 1;
  const bp = b.status === 'APPLIED' ? 0 : 1;
  if (ap !== bp) return ap - bp;
  if (a.confirmCount !== b.confirmCount) return b.confirmCount - a.confirmCount;
  if (a.createdAt !== b.createdAt) {
    if (a.createdAt === null) return 1;
    if (b.createdAt === null) return -1;
    const d = parsePgTimestamp(a.createdAt) - parsePgTimestamp(b.createdAt);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return compareUuid(a.id, b.id);
}

/** organizedCommissions(list, viewerId): commission id -> the GET /v1/subjects commission object. */
export async function organizedCommissions(db: Db, commissions: readonly Commission[], viewerId: string | null): Promise<Map<string, OrganizedCommission>> {
  const out = new Map<string, OrganizedCommission>();
  if (commissions.length === 0) return out;
  const ids = [...new Set(commissions.map((c) => c.id))];
  const open = await findByCommissionIdInAndStatusIn(db, ids, ['PENDING', 'APPLIED']);
  const myVotes = new Map<string, string>();
  if (viewerId !== null && open.length > 0) {
    for (const r of await repo.correctionVotesOf(db, viewerId, open.map((c) => c.id))) myVotes.set(r.correction_id as string, r.type as string);
  }
  const byCommission = new Map<string, CorrectionRow[]>();
  for (const c of open) {
    const l = byCommission.get(c.commissionId) ?? [];
    l.push(c);
    byCommission.set(c.commissionId, l);
  }
  for (const commission of commissions) {
    const sgaSlots = sga(commission.times);
    const mine = [...(byCommission.get(commission.id) ?? [])].sort(publicOrder);
    const applied = mine.find((c) => c.status === 'APPLIED') ?? null;
    const schedule = applied ? withRooms(applied.proposedSlots, sgaSlots) : sgaSlots;
    const dto: OrganizedCommission = {
      commission_id: commission.id,
      name: commission.commissionName,
      course_start: commission.courseStart,
      course_end: commission.courseEnd,
      schedule: toSchedule(schedule),
      corrections: [],
    };
    if (applied) dto.sga_schedule = toSchedule(sgaSlots);
    dto.corrections = mine.map((c) => ({
      id: c.id,
      status: c.status,
      schedule: toSchedule(withRooms(c.proposedSlots, sgaSlots)),
      confirms: c.confirmCount,
      rejects: c.rejectCount,
      my_vote: myVotes.get(c.id) ?? null,
      created_at: c.createdAt === null ? null : formatInstant(parsePgTimestamp(c.createdAt)),
    }));
    // Key order of the record: sga_schedule sits between schedule and corrections.
    const { corrections, ...head } = dto;
    out.set(commission.id, { ...head, corrections });
  }
  return out;
}

/** effectiveSlots(list): commission id -> applied correction's slots (rooms borrowed) or SGA's. */
export async function effectiveSlots(db: Db, commissions: readonly Commission[]): Promise<Map<string, EffectiveSlot[]>> {
  const out = new Map<string, EffectiveSlot[]>();
  if (commissions.length === 0) return out;
  const applied = new Map<string, CorrectionRow>();
  for (const c of await findByCommissionIdInAndStatusIn(db, [...new Set(commissions.map((x) => x.id))], ['APPLIED'])) {
    if (!applied.has(c.commissionId)) applied.set(c.commissionId, c);
  }
  for (const commission of commissions) {
    const sgaSlots = sga(commission.times);
    const c = applied.get(commission.id);
    out.set(commission.id, c ? withRooms(c.proposedSlots, sgaSlots) : sgaSlots);
  }
  return out;
}

/**
 * onSgaSlotsChanged(commissionId, newSga), inside the sync's per-commission
 * transaction: every open correction whose snapshot differs from the new SGA
 * slots ends, RESOLVED when SGA now matches its proposal, else SUPERSEDED.
 * @UpdateTimestamp moves updated_at.
 */
export async function onSgaSlotsChanged(db: Db, commissionId: string, newSga: readonly CorrectionSlot[], log?: { info(o: object, m: string): void }): Promise<void> {
  for (const c of await findByCommissionIdInAndStatusIn(db, [commissionId], ['PENDING', 'APPLIED'])) {
    if (sameSet(c.sgaSnapshot, newSga)) continue;
    const next = sameSet(c.proposedSlots, newSga) ? 'RESOLVED' : 'SUPERSEDED';
    log?.info({ correction: c.id, commissionId, from: c.status, to: next }, 'Schedule correction ended (SGA slots changed)');
    await repo.setCorrectionStatus(db, c.id, next, toPgTimestamp(systemNowMicros()));
  }
}
