// service/digest/DigestCorrectionVoteService: the "¿Es así?" links of
// "Tu cuatrimestre". GET shows the correction (read-only: mail scanners follow
// links), POST votes as the token's user through ScheduleCorrectionService.vote.
//
// ScheduleCorrectionService.vote is not ported by its feature yet; `voteAs`
// below is a faithful port of that one method (lock the commission, load the
// correction, require it open and its commission not ended, upsert the vote,
// recount, apply/un-apply on the 3-confirm rule, notify the suggester once).
// When the correction feature lands, call its service instead.

import type { Deps } from '../../deps';
import { withTx, type Db } from '../../db/client';
import { InvalidStateError, ResourceNotFoundError } from '../../http/errors';
import { isBefore } from '../../lib/javaCompat';
import { ART } from '../../lib/time';
import { firePush, pushToUsers } from '../push/service';
import { pushMessage } from '../push/logic/pushMessage';
import { isAllowedRecipient, type MailSettings } from '../mail/settings';
import type { CorrectionVoteResult, CorrectionVoteView } from './dto';
import type { DigestCorrectionVoteTokens } from './logic/digestCorrectionVoteTokens';
import { DigestException } from './logic/digestException';
import { formatOdt, odtInZone } from './odt';
import { slotsFromTimes } from './personal';
import * as repo from './repo';

export const APPLY_THRESHOLD = 3;
export const PUSH_TYPE = 'schedule_correction_applied';
export const PUSH_TITLE = 'Tu corrección fue aplicada';

type Valid = { userId: string; correctionId: string; expiresAt: number };

/** ScheduleCorrectionException(COMMISSION_ENDED) -> 409 CommissionEnded. */
class CommissionEndedError extends InvalidStateError {}

export function parseVote(vote: string | null | undefined): 'CONFIRM' | 'REJECT' {
  if (vote != null) {
    const v = vote.trim().toLowerCase();
    if (v === 'confirm') return 'CONFIRM';
    if (v === 'reject') return 'REJECT';
  }
  throw new DigestException('INVALID_VOTE', 'vote must be confirm or reject');
}

const notFound = () => new DigestException('CORRECTION_NOT_FOUND', 'Schedule correction not found');
const closed = (detail: string) => new DigestException('CORRECTION_CLOSED', `This correction no longer accepts votes (${detail})`);
const isOpen = (status: string) => status === 'PENDING' || status === 'APPLIED';

export class DigestCorrectionVoteService {
  constructor(private readonly deps: Deps, private readonly settings: MailSettings, private readonly tokens: DigestCorrectionVoteTokens) {}

  view(token: string | null): Promise<CorrectionVoteView> {
    return withTx(this.deps.db, async (tx) => this.load(tx, await this.holder(tx, token)), { readOnly: true });
  }

  /** Not transactional itself: the vote is its own transaction. */
  async vote(token: string | null, vote: string | null): Promise<CorrectionVoteResult> {
    const type = parseVote(vote);
    const t = await this.holder(this.deps.db, token);
    const before = await this.load(this.deps.db, t);
    if (!before.open) throw closed(before.status);
    try {
      await this.voteAs(t.correctionId, t.userId, type);
    } catch (e) {
      if (e instanceof InvalidStateError) throw closed(e.message);
      if (e instanceof ResourceNotFoundError) throw notFound();
      throw e;
    }
    return { correction: await this.load(this.deps.db, t), previousVote: before.myVote };
  }

  private async holder(db: Db, token: string | null): Promise<Valid> {
    const v = this.tokens.verify(token);
    if (v.type === 'Expired') throw new DigestException('TOKEN_EXPIRED', 'This link has expired');
    if (v.type !== 'Valid') throw new DigestException('INVALID_TOKEN', 'Invalid correction vote token');
    const user = await repo.findUser(db, v.userId);
    if (user == null) throw new DigestException('INVALID_TOKEN', 'Invalid correction vote token');
    if (!isAllowedRecipient(this.settings, user.email)) {
      throw new DigestException('EMAIL_NOT_ALLOWED', `Digest links only work for ${this.settings.digest.allowedDomains.join(', ')} addresses`);
    }
    return v;
  }

  private async load(db: Db, t: Valid): Promise<CorrectionVoteView> {
    const c = await repo.findCorrection(db, t.correctionId);
    if (c == null) throw notFound();
    const commission = await repo.findCommissionWithTimes(db, c.commissionId);
    if (commission == null) throw notFound();
    const subjectName = (await repo.findSubjectName(db, commission.subjectCode)) ?? commission.subjectCode;
    const ended = isBefore(commission.courseEnd, this.deps.clock.today());
    const myVote = await repo.findVoteType(db, c.id, t.userId);
    return {
      correctionId: c.id, subjectId: commission.subjectCode, subjectName, commissionName: commission.commissionName, status: c.status,
      open: isOpen(c.status) && !ended, proposed: c.proposedSlots.map((s) => ({ day: s.day, from: s.from, to: s.to })),
      sga: slotsFromTimes(commission.times), confirms: c.confirmCount, rejects: c.rejectCount, myVote,
      expiresAt: formatOdt(odtInZone(t.expiresAt, ART)),
    };
  }

  /** ScheduleCorrectionService.vote (PUT /v1/schedule-corrections/{id}/vote). */
  async voteAs(correctionId: string, userId: string, type: 'CONFIRM' | 'REJECT'): Promise<void> {
    const push = await withTx(this.deps.db, async (tx) => {
      const commissionId = await repo.findCorrectionCommissionId(tx, correctionId);
      if (commissionId == null) throw new ResourceNotFoundError('ScheduleCorrection', correctionId);
      const commission = await repo.findCommissionWithTimes(tx, commissionId, true);
      if (commission == null) throw new ResourceNotFoundError('ScheduleCorrection', correctionId);
      const c = await repo.findCorrection(tx, correctionId);
      if (c == null) throw new ResourceNotFoundError('ScheduleCorrection', correctionId);
      if (!isOpen(c.status)) throw new InvalidStateError(`Schedule correction is ${c.status}`);
      if (isBefore(commission.courseEnd, this.deps.clock.today())) {
        throw new CommissionEndedError(`Commission ${commission.id} has ended`);
      }
      const now = this.deps.clock.now();
      const existing = await repo.findVoteType(tx, correctionId, userId);
      if (existing == null) await repo.insertVote(tx, correctionId, userId, type, now);
      else if (existing !== type) await repo.updateVote(tx, correctionId, userId, type, now);

      // recountAndEvaluate
      const confirms = await repo.countVotes(tx, correctionId, 'CONFIRM');
      const rejects = await repo.countVotes(tx, correctionId, 'REJECT');
      const meetsRule = confirms >= APPLY_THRESHOLD && confirms > rejects;
      let status = c.status;
      let appliedAt = c.appliedAt;
      let notify = false;
      if (c.status === 'PENDING' && meetsRule) {
        await repo.supersedeOtherApplied(tx, c.commissionId, c.id, now);
        status = 'APPLIED';
        if (appliedAt == null) {
          appliedAt = now;
          notify = true;
        }
      } else if (c.status === 'APPLIED' && !meetsRule && !c.reviewedByStaff) {
        status = 'PENDING';
      }
      if (status !== c.status || confirms !== c.confirmCount || rejects !== c.rejectCount || appliedAt !== c.appliedAt) {
        await repo.updateCorrectionState(tx, c.id, { status, confirmCount: confirms, rejectCount: rejects, appliedAt }, now);
      }
      if (!notify || c.suggesterId == null) return null;
      const subjectName = (await repo.findSubjectName(tx, commission.subjectCode)) ?? commission.subjectCode;
      return pushToUsers([c.suggesterId], pushMessage(PUSH_TITLE,
        `${subjectName} · Comisión ${commission.commissionName}: el horario corregido ya se usa en el Combinador.`,
        { type: PUSH_TYPE, correctionId: c.id, subjectId: commission.subjectCode, commissionId: commission.id }));
    });
    // PushTriggerListener: after commit.
    if (push != null) firePush(this.deps, push);
  }
}
