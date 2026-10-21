// service/digest/DigestCorrectionVoteService: the "¿Es así?" links of
// "Tu cuatrimestre". GET shows the correction (read-only: mail scanners follow
// links), POST votes as the token's user through the correction feature's
// ScheduleCorrectionService.vote.

import type { Deps } from '../../deps';
import { withTx, type Db } from '../../db/client';
import { InvalidStateError, ResourceNotFoundError } from '../../http/errors';
import { isBefore } from '../../lib/javaCompat';
import { ART } from '../../lib/time';
import { ScheduleCorrectionError } from '../correction/errors';
import { ScheduleCorrectionService } from '../correction/service';
import { isAllowedRecipient, type MailSettings } from '../mail/settings';
import type { CorrectionVoteResult, CorrectionVoteView } from './dto';
import type { DigestCorrectionVoteTokens } from './logic/digestCorrectionVoteTokens';
import { DigestException } from './logic/digestException';
import { formatOdt, odtInZone } from './odt';
import { slotsFromTimes } from './personal';
import * as repo from './repo';

type Valid = { userId: string; correctionId: string; expiresAt: number };

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
  private readonly corrections: ScheduleCorrectionService;

  constructor(private readonly deps: Deps, private readonly settings: MailSettings, private readonly tokens: DigestCorrectionVoteTokens) {
    this.corrections = new ScheduleCorrectionService(deps);
  }

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
      await this.corrections.vote(t.correctionId, t.userId, type);
    } catch (e) {
      if (e instanceof InvalidStateError || e instanceof ScheduleCorrectionError) throw closed(e.message);
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
}
