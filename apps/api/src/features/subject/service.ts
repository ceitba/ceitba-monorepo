// service/subject/SubjectService + SubjectPlanService.getSubjectsByPlanOrganized
// (GET /v1/subjects?plan=).

import type { Deps } from '../../deps';
import { withTx } from '../../db/client';
import { ResourceNotFoundError } from '../../http/errors';
import { parsePgTimestamp, systemNowMicros } from '../../lib/time';
import { organizedCommissions, type OrganizedCommission } from '../commission/correctionOverlay';
import { currentTermBySubject, isPastTerm } from '../commission/logic/commissionTerms';
import * as commissionRepo from '../commission/repo';
import * as planRepo from '../plan/repo';

/** The sync runs twice a day: entries older than this mean its last four runs failed for the plan. */
const STALE_AFTER_MICROS = 2 * 24 * 3600 * 1_000_000;

/** OrganizedSubjectsResponse.SubjectDetail. */
export interface SubjectDetail {
  section: string | null;
  subject_id: string;
  name: string | null;
  credits: number;
  dependencies: string[];
  credits_required: number | null;
  course_start: string;
  course_end: string;
  commissions: (OrganizedCommission | null)[];
  past_term: boolean;
}

/** section -> year -> semester -> details, insertion order (LinkedHashMap). */
export type OrganizedSubjects = Map<string, Map<string, Map<string, SubjectDetail[]>>>;

export class SubjectService {
  constructor(private readonly deps: Deps) {}

  getSubjectById(id: string) {
    return withTx(this.deps.db, async (tx) => {
      const s = await planRepo.findSubject(tx, id);
      if (!s) throw new ResourceNotFoundError('Subject', id);
      return { id: s.id, name: s.name, credits: s.credits };
    }, { readOnly: true });
  }

  /**
   * The plan comes from plan_entry, which the sync fills with each plan exactly
   * as ITBA sent it (docs/PLANS.md). A plan with no stored entries (not synced
   * yet, or not registered) falls back to the live ITBA API, deliberately NOT
   * inside a transaction (the call can take the client's 30 s read timeout).
   * Then read-only queries hydrate the commissions cached by the sync.
   */
  async getSubjectsByPlanOrganized(planId: string, viewerId: string | null): Promise<OrganizedSubjects> {
    const stored = await withTx(this.deps.db, (tx) => planRepo.findPlanEntries(tx, planId), { readOnly: true });
    if (stored.fetchedAt !== null && systemNowMicros() - parsePgTimestamp(stored.fetchedAt) > STALE_AFTER_MICROS) {
      // Still served (better than nothing while ITBA fails), but its syncs are failing: say so.
      this.deps.log.warn({ plan: planId, fetchedAt: stored.fetchedAt }, 'Serving plan entries older than 2 days: its sync keeps failing');
    }
    const subjectPlans = stored.entries.length > 0 ? stored.entries : (await this.deps.itba.getSubjectsByPlan(planId)).subjects;
    if (subjectPlans.length === 0) throw new ResourceNotFoundError('Plan', planId);

    const codes = [...new Set(subjectPlans.map((sp) => sp.subjectId).filter((c): c is string => c != null))];
    const today = this.deps.clock.today();
    const currentBySubject = codes.length === 0
      ? new Map<string, commissionRepo.Commission[]>()
      : currentTermBySubject(await withTx(this.deps.db, (tx) => commissionRepo.findBySubjectCodeInWithTimes(tx, codes), { readOnly: true }), today);
    const overlay = await withTx(this.deps.db, (tx) => organizedCommissions(tx, [...currentBySubject.values()].flat(), viewerId), { readOnly: true });

    const organized: OrganizedSubjects = new Map();
    for (const sp of subjectPlans) {
      const section = String(sp.section);
      const year = sp.year != null ? String(sp.year) : '0';
      const semester = sp.semester != null ? String(sp.semester) : '0';
      const subjectCommissions = currentBySubject.get(sp.subjectId) ?? [];
      const detail: SubjectDetail = {
        section: sp.section,
        subject_id: sp.subjectId,
        name: sp.subjectName,
        credits: sp.subjectCredits,
        dependencies: sp.dependencies,
        credits_required: sp.creditsRequired,
        course_start: subjectCommissions.length === 0 ? today : subjectCommissions[0]!.courseStart,
        course_end: subjectCommissions.length === 0 ? today : subjectCommissions[0]!.courseEnd,
        commissions: subjectCommissions.map((c) => overlay.get(c.id) ?? null),
        past_term: isPastTerm(subjectCommissions, today),
      };
      let bySection = organized.get(section);
      if (!bySection) organized.set(section, (bySection = new Map()));
      let byYear = bySection.get(year);
      if (!byYear) bySection.set(year, (byYear = new Map()));
      let list = byYear.get(semester);
      if (!list) byYear.set(semester, (list = []));
      list.push(detail);
    }
    return organized;
  }
}
