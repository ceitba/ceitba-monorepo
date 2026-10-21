// service/commission/CommissionService: the flat commission catalog for the
// app's schedule builder, served from the DataSync cache (never calls ITBA).

import type { Deps } from '../../deps';
import { withTx } from '../../db/client';
import { ResourceNotFoundError } from '../../http/errors';
import * as planRepo from '../plan/repo';
import { effectiveSlots, hhmm } from './correctionOverlay';
import type { CommissionResponse } from './dto';
import { currentTermBySubject } from './logic/commissionTerms';
import * as repo from './repo';

export class CommissionService {
  constructor(private readonly deps: Deps) {}

  /** @Transactional(readOnly = true) */
  currentByPlan(planId: string): Promise<CommissionResponse[]> {
    return withTx(this.deps.db, async (tx) => {
      if (!(await planRepo.planExists(tx, planId)) && !(await planRepo.existsByPlanId(tx, planId))) {
        throw new ResourceNotFoundError('Plan', planId);
      }
      const today = this.deps.clock.today();
      const commissions = [...currentTermBySubject(await repo.findCurrentByPlanWithTimes(tx, planId, today), today).values()].flat();
      const codes = [...new Set(commissions.map((c) => c.subjectCode))];
      const names = new Map((await planRepo.findSubjectsByIds(tx, codes)).map((s) => [s.id, s.name]));
      const times = await effectiveSlots(tx, commissions);
      return commissions.map((c) => ({
        id: c.id,
        subjectCode: c.subjectCode,
        subjectName: names.get(c.subjectCode) ?? null,
        subjectType: c.subjectType,
        commissionName: c.commissionName,
        quota: c.quota,
        enrolledStudents: c.enrolledStudents,
        courseStart: c.courseStart,
        courseEnd: c.courseEnd,
        times: (times.get(c.id) ?? []).map((t) => ({ day: t.day, hourFrom: hhmm(t.from), hourTo: hhmm(t.to), building: t.building, classroom: t.classroom })),
      }));
    }, { readOnly: true });
  }
}
