// web/correction/dto/*.

import type { z } from 'zod';
import { MalformedBodyError } from '../../http/errors';
import { jv } from '../../http/validation';
import type { Schedule } from '../commission/correctionOverlay';
import type { ScheduleSlotInput } from './logic/slots';

export const CORRECTION_STATUSES = ['PENDING', 'APPLIED', 'REJECTED', 'RESOLVED', 'SUPERSEDED'] as const;
export type CorrectionStatus = (typeof CORRECTION_STATUSES)[number];
export const VOTE_TYPES = ['CONFIRM', 'REJECT'] as const;
export type VoteType = (typeof VOTE_TYPES)[number];

/** SuggestCorrectionRequest(@NotNull List<ScheduleSlotInput> schedule): items bound by `bindSlots`. */
export const SuggestCorrectionRequest = jv.object({
  schedule: jv.list(jv.json(), { notNull: true }),
});
export type SuggestCorrectionRequest = NonNullable<z.output<typeof SuggestCorrectionRequest>>;

/** Jackson's binding of a String field: scalars coerce, containers fail. */
function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  throw new MalformedBodyError();
}

/**
 * ScheduleSlotInput binding: `time_from`/`time_to` with the `timeFrom`/`timeTo`
 * aliases (the last one in the JSON wins, like Jackson). No bean validation:
 * the service validates.
 */
export function bindSlots(items: unknown[]): (ScheduleSlotInput | null)[] {
  return items.map((it) => {
    if (it === null) return null;
    if (typeof it !== 'object' || Array.isArray(it)) throw new MalformedBodyError();
    const out: ScheduleSlotInput = { day: null, timeFrom: null, timeTo: null };
    for (const [k, v] of Object.entries(it as Record<string, unknown>)) {
      if (k === 'day') out.day = str(v);
      else if (k === 'time_from' || k === 'timeFrom') out.timeFrom = str(v);
      else if (k === 'time_to' || k === 'timeTo') out.timeTo = str(v);
    }
    return out;
  });
}

/** VoteCorrectionRequest(@NotNull ScheduleCorrectionVoteType type). */
export const VoteCorrectionRequest = jv.object({ type: jv.enum(VOTE_TYPES, { notNull: true }) });
export type VoteCorrectionRequest = NonNullable<z.output<typeof VoteCorrectionRequest>>;

/** CorrectionResponse: createdAt is an Instant. */
export interface CorrectionResponse {
  id: string;
  commissionId: string;
  status: CorrectionStatus;
  schedule: Schedule[];
  confirms: number;
  rejects: number;
  myVote: VoteType | null;
  createdAt: string | null;
}

/** SuggestCorrectionResponse(created, correction). */
export interface SuggestCorrectionResponse {
  created: boolean;
  correction: CorrectionResponse;
}

/** MyCorrectionResponse. */
export interface MyCorrectionResponse extends CorrectionResponse {
  subjectId: string | null;
  subjectName: string | null;
  commissionName: string | null;
  appliedAt: string | null;
  seen: boolean;
}

/** StaffCorrectionResponse: no myVote. */
export interface StaffCorrectionResponse {
  id: string;
  commissionId: string;
  status: CorrectionStatus;
  schedule: Schedule[];
  confirms: number;
  rejects: number;
  createdAt: string | null;
  subjectId: string | null;
  subjectName: string | null;
  commissionName: string | null;
  sgaSchedule: Schedule[];
  appliedAt: string | null;
  reviewedAt: string | null;
  reviewedByStaff: boolean;
}
