// service/correction/ScheduleCorrectionService (student and staff actions,
// account deletion). The read overlays and the sync hook (organizedCommissions,
// effectiveSlots, onSgaSlotsChanged) live in commission/correctionOverlay.ts.
//
// Rules: the suggestion counts as the suggester's CONFIRM; PENDING -> APPLIED
// at confirms >= 3 and confirms > rejects; APPLIED -> PENDING when that stops
// holding unless STAFF applied it; one APPLIED per commission (applying
// supersedes the previous one first, for the partial unique index);
// REJECTED / RESOLVED / SUPERSEDED are final. Every write locks the parent
// commission row first, then reads the correction fresh.
//
// The applied push is collected in the transaction and fired after commit.

import type { Deps } from '../../deps';
import { withTx, type Tx } from '../../db/client';
import { InvalidStateError, ResourceNotFoundError } from '../../http/errors';
import { pushMessage } from '../push/service';
import { formatInstant, parsePgTimestamp, systemNowMicros } from '../../lib/time';
import { fromTimes, sga as sgaOf, toSchedule, withRooms } from '../commission/correctionOverlay';
import { findForUpdate as findCommissionForUpdate, type Commission } from '../commission/repo';
import { pageResponse, type PageResponse } from '../news/paging';
import { firePushes, type PushTrigger } from '../news/pushTriggers';
import {
  CORRECTION_STATUSES, type CorrectionResponse, type CorrectionStatus, type MyCorrectionResponse, type StaffCorrectionResponse,
  type SuggestCorrectionResponse, type VoteType,
} from './dto';
import { ScheduleCorrectionError } from './errors';
import { key, normalize, type ScheduleSlotInput } from './logic/slots';
import * as repo from './repo';

export const APPLY_THRESHOLD = 3;
export const PUSH_TYPE = 'schedule_correction_applied';
export const PUSH_TITLE = 'Tu corrección fue aplicada';
const MAX_PAGE_SIZE = 100;
const OPEN: readonly CorrectionStatus[] = ['PENDING', 'APPLIED'];
const isOpen = (s: CorrectionStatus) => s === 'PENDING' || s === 'APPLIED';

const instant = (pg: string | null) => (pg === null ? null : formatInstant(parsePgTimestamp(pg)));

interface Ctx { commissions: Map<string, Commission>; subjectNames: Map<string, string> }

export class ScheduleCorrectionService {
  constructor(private readonly deps: Deps) {}

  /** Runs `fn` in a transaction and fires the pushes it collected after commit. */
  private async write<T>(fn: (tx: Tx, pushes: PushTrigger[]) => Promise<T>): Promise<T> {
    const pushes: PushTrigger[] = [];
    const out = await withTx(this.deps.db, (tx) => fn(tx, pushes));
    firePushes(this.deps, pushes);
    return out;
  }

  // ---- student actions

  suggest(commissionId: string, userId: string, input: readonly (ScheduleSlotInput | null)[]): Promise<SuggestCorrectionResponse> {
    return this.write(async (tx, pushes) => {
      const commission = await findCommissionForUpdate(tx, commissionId);
      if (!commission) throw new ResourceNotFoundError('Commission', commissionId);
      const proposed = normalize(input);
      this.requireNotEnded(commission);
      const sga = fromTimes(commission.times);
      const k = key(proposed);
      if (k === key(sga)) throw new ScheduleCorrectionError('SAME_AS_SGA', 'The proposed schedule is the same as the SGA schedule');

      const identical = await repo.findFirstOpenByKey(tx, commissionId, k, OPEN);
      if (identical) {
        return { created: false, correction: toResponse(identical, commission, await repo.findVote(tx, identical.id, userId)) };
      }
      if (await repo.existsPendingBySuggester(tx, commissionId, userId)) {
        throw new ScheduleCorrectionError('ALREADY_SUGGESTED', 'You already have a pending correction for this commission');
      }
      const now = systemNowMicros();
      const id = await repo.insertCorrection(tx, { commissionId, suggesterId: userId, proposed, sga, slotsKey: k }, now);
      await repo.insertVote(tx, id, userId, 'CONFIRM', systemNowMicros());
      const c = await this.recountAndEvaluate(tx, (await repo.findById(tx, id))!, commission, pushes);
      return { created: true, correction: toResponse(c, commission, 'CONFIRM') };
    });
  }

  vote(correctionId: string, userId: string, type: VoteType): Promise<CorrectionResponse> {
    return this.write(async (tx, pushes) => {
      const { correction, commission } = await this.lock(tx, correctionId);
      this.requireVotable(correction, commission);
      const existing = await repo.findVote(tx, correctionId, userId);
      if (existing === null) await repo.insertVote(tx, correctionId, userId, type, systemNowMicros());
      else if (existing !== type) await repo.updateVote(tx, correctionId, userId, type, systemNowMicros());
      const c = await this.recountAndEvaluate(tx, correction, commission, pushes);
      return toResponse(c, commission, type);
    });
  }

  /** Idempotent; the suggester may withdraw their implicit CONFIRM too. */
  removeVote(correctionId: string, userId: string): Promise<CorrectionResponse> {
    return this.write(async (tx, pushes) => {
      const { correction, commission } = await this.lock(tx, correctionId);
      this.requireVotable(correction, commission);
      await repo.deleteVote(tx, correctionId, userId);
      const c = await this.recountAndEvaluate(tx, correction, commission, pushes);
      return toResponse(c, commission, null);
    });
  }

  /** The caller's own suggestions, newest first. */
  mine(userId: string): Promise<MyCorrectionResponse[]> {
    return withTx(this.deps.db, async (tx) => {
      const mine = await repo.findBySuggester(tx, userId);
      if (!mine.length) return [];
      const ctx = await context(tx, mine);
      const votes = await repo.votesOf(tx, userId, mine.map((c) => c.id));
      return mine.map((c) => {
        const commission = ctx.commissions.get(c.commissionId);
        const base = toResponse(c, commission, votes.get(c.id) ?? null);
        const subjectId = commission ? commission.subjectCode : null;
        return {
          ...base,
          subjectId,
          subjectName: subjectId === null ? null : (ctx.subjectNames.get(subjectId) ?? null),
          commissionName: commission ? commission.commissionName : null,
          appliedAt: instant(c.appliedAt),
          seen: c.appliedAt === null || c.seenAt !== null,
        };
      });
    }, { readOnly: true });
  }

  /** Idempotent; someone else's correction is a 404 like a missing one. */
  markSeen(correctionId: string, userId: string): Promise<void> {
    return withTx(this.deps.db, async (tx) => {
      const c = await repo.findByIdAndSuggester(tx, correctionId, userId);
      if (!c) throw new ResourceNotFoundError('ScheduleCorrection', correctionId);
      if (c.seenAt === null) await repo.update(tx, c.id, { seenAt: this.deps.clock.now() }, systemNowMicros());
    });
  }

  // ---- staff

  /** Newest first; corrections of ended commissions are hidden unless a final status is asked for. */
  staffList(status: CorrectionStatus | null, page: number, limit: number): Promise<PageResponse<StaffCorrectionResponse>> {
    const size = Math.min(Math.max(limit, 1), MAX_PAGE_SIZE);
    const p = Math.max(page, 1);
    const offset = (p - 1) * size;
    return withTx(this.deps.db, async (tx) => {
      const today = this.deps.clock.today();
      const result = status === null
        ? await repo.findOnRunningCommissionsPage(tx, CORRECTION_STATUSES, today, offset, size)
        : OPEN.includes(status)
          ? await repo.findOnRunningCommissionsPage(tx, [status], today, offset, size)
          : await repo.findByStatusPage(tx, status, offset, size);
      const ctx = await context(tx, result.rows);
      return pageResponse(result.rows.map((c) => toStaffResponse(c, ctx)), { page: p - 1, size }, result.total);
    }, { readOnly: true });
  }

  /** Applies a PENDING correction (superseding the applied one) or marks an APPLIED one staff-reviewed. */
  staffApply(correctionId: string, staffUserId: string | null): Promise<StaffCorrectionResponse> {
    return this.write(async (tx, pushes) => {
      const { correction, commission } = await this.lock(tx, correctionId);
      requireOpen(correction);
      await repo.update(tx, correction.id, { reviewedBy: staffUserId, reviewedAt: this.deps.clock.now() }, systemNowMicros());
      let c = (await repo.findById(tx, correction.id))!;
      if (c.status !== 'APPLIED') c = await this.apply(tx, c, commission, pushes);
      return toStaffResponse(c, await context(tx, [c]));
    });
  }

  /** Rejects a PENDING correction or reverts an APPLIED one. Final. */
  staffReject(correctionId: string, staffUserId: string | null): Promise<StaffCorrectionResponse> {
    return this.write(async (tx) => {
      const { correction } = await this.lock(tx, correctionId);
      requireOpen(correction);
      await repo.update(tx, correction.id, { reviewedBy: staffUserId, reviewedAt: this.deps.clock.now(), status: 'REJECTED' }, systemNowMicros());
      const c = (await repo.findById(tx, correction.id))!;
      return toStaffResponse(c, await context(tx, [c]));
    });
  }

  // ---- account deletion

  /**
   * DELETE /v1/me, inside AccountDeletionService's transaction: removes the
   * user's votes and recounts / re-evaluates every correction they voted on,
   * locking each commission first in commission-id order. Returns the push
   * triggers to fire after that transaction commits (firePushes).
   */
  async withdrawVotesOf(tx: Tx, userId: string): Promise<PushTrigger[]> {
    const pushes: PushTrigger[] = [];
    for (const commissionId of await repo.findCommissionIdsVotedOnBy(tx, userId)) {
      const commission = await findCommissionForUpdate(tx, commissionId);
      if (!commission) continue;
      for (const c of await repo.findByCommissionIdVotedOnBy(tx, commissionId, userId)) {
        await repo.deleteVote(tx, c.id, userId);
        if (isOpen(c.status)) await this.recountAndEvaluate(tx, c, commission, pushes);
        else await this.recount(tx, c);
      }
    }
    return pushes;
  }

  // ---- transitions

  private async recount(tx: Tx, c: repo.CorrectionRow): Promise<repo.CorrectionRow> {
    const confirms = await repo.countVotes(tx, c.id, 'CONFIRM');
    const rejects = await repo.countVotes(tx, c.id, 'REJECT');
    if (confirms !== c.confirmCount || rejects !== c.rejectCount) {
      await repo.update(tx, c.id, { confirmCount: confirms, rejectCount: rejects }, systemNowMicros());
    }
    return { ...c, confirmCount: confirms, rejectCount: rejects };
  }

  private async recountAndEvaluate(tx: Tx, c0: repo.CorrectionRow, commission: Commission, pushes: PushTrigger[]): Promise<repo.CorrectionRow> {
    let c = await this.recount(tx, c0);
    const meetsRule = c.confirmCount >= APPLY_THRESHOLD && c.confirmCount > c.rejectCount;
    if (c.status === 'PENDING' && meetsRule) {
      c = await this.apply(tx, c, commission, pushes);
    } else if (c.status === 'APPLIED' && !meetsRule && !c.reviewedByStaff) {
      await repo.update(tx, c.id, { status: 'PENDING' }, systemNowMicros());
      c = { ...c, status: 'PENDING' };
    }
    return c;
  }

  /** Makes `c` the applied correction (superseding the previous one first); notifies the suggester once. */
  private async apply(tx: Tx, c: repo.CorrectionRow, commission: Commission, pushes: PushTrigger[]): Promise<repo.CorrectionRow> {
    for (const previous of await repo.findByCommissionIdAndStatusIn(tx, c.commissionId, ['APPLIED'])) {
      if (previous.id !== c.id) await repo.update(tx, previous.id, { status: 'SUPERSEDED' }, systemNowMicros());
    }
    if (c.appliedAt === null) {
      await repo.update(tx, c.id, { status: 'APPLIED', appliedAt: this.deps.clock.now() }, systemNowMicros());
      await this.notifyApplied(tx, c, commission, pushes);
    } else {
      await repo.update(tx, c.id, { status: 'APPLIED' }, systemNowMicros());
    }
    return (await repo.findById(tx, c.id))!;
  }

  private async notifyApplied(tx: Tx, c: repo.CorrectionRow, commission: Commission, pushes: PushTrigger[]): Promise<void> {
    if (c.suggesterId === null) return;
    const subjectName = (await repo.subjectNames(tx, [commission.subjectCode])).get(commission.subjectCode) ?? commission.subjectCode;
    const body = `${subjectName} · Comisión ${commission.commissionName}: el horario corregido ya se usa en el Combinador.`;
    pushes.push({
      kind: 'users',
      userIds: [c.suggesterId],
      message: pushMessage(PUSH_TITLE, body, { type: PUSH_TYPE, correctionId: c.id, subjectId: commission.subjectCode, commissionId: commission.id }),
    });
  }

  // ---- helpers

  /** Locks the parent commission, then loads the correction fresh. */
  private async lock(tx: Tx, correctionId: string): Promise<{ correction: repo.CorrectionRow; commission: Commission }> {
    const commissionId = await repo.findCommissionIdById(tx, correctionId);
    if (commissionId === null) throw new ResourceNotFoundError('ScheduleCorrection', correctionId);
    const commission = await findCommissionForUpdate(tx, commissionId);
    if (!commission) throw new ResourceNotFoundError('ScheduleCorrection', correctionId);
    const correction = await repo.findById(tx, correctionId);
    if (!correction) throw new ResourceNotFoundError('ScheduleCorrection', correctionId);
    return { correction, commission };
  }

  private requireVotable(c: repo.CorrectionRow, commission: Commission): void {
    requireOpen(c);
    this.requireNotEnded(commission);
  }

  private requireNotEnded(commission: Commission): void {
    if (commission.courseEnd < this.deps.clock.today()) {
      throw new ScheduleCorrectionError('COMMISSION_ENDED', `Commission ${commission.id} has ended`);
    }
  }
}

function requireOpen(c: repo.CorrectionRow): void {
  if (!isOpen(c.status)) throw new InvalidStateError(`Schedule correction is ${c.status}`);
}

async function context(tx: Tx, list: readonly repo.CorrectionRow[]): Promise<Ctx> {
  if (!list.length) return { commissions: new Map(), subjectNames: new Map() };
  const commissions = await repo.commissionsWithTimes(tx, [...new Set(list.map((c) => c.commissionId))]);
  const subjectNames = await repo.subjectNames(tx, [...new Set([...commissions.values()].map((c) => c.subjectCode))]);
  return { commissions, subjectNames };
}

function toResponse(c: repo.CorrectionRow, commission: Commission | undefined, myVote: VoteType | null): CorrectionResponse {
  const sga = commission ? sgaOf(commission.times) : [];
  return {
    id: c.id,
    commissionId: c.commissionId,
    status: c.status,
    schedule: toSchedule(withRooms(c.proposedSlots, sga)),
    confirms: c.confirmCount,
    rejects: c.rejectCount,
    myVote,
    createdAt: instant(c.createdAt),
  };
}

function toStaffResponse(c: repo.CorrectionRow, ctx: Ctx): StaffCorrectionResponse {
  const commission = ctx.commissions.get(c.commissionId);
  const sga = commission ? sgaOf(commission.times) : [];
  const subjectId = commission ? commission.subjectCode : null;
  return {
    id: c.id,
    commissionId: c.commissionId,
    status: c.status,
    schedule: toSchedule(withRooms(c.proposedSlots, sga)),
    confirms: c.confirmCount,
    rejects: c.rejectCount,
    createdAt: instant(c.createdAt),
    subjectId,
    subjectName: subjectId === null ? null : (ctx.subjectNames.get(subjectId) ?? null),
    commissionName: commission ? commission.commissionName : null,
    sgaSchedule: toSchedule(sga),
    appliedAt: instant(c.appliedAt),
    reviewedAt: instant(c.reviewedAt),
    reviewedByStaff: c.reviewedByStaff,
  };
}
