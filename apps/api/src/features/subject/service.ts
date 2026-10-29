// service/subject/SubjectService + SubjectPlanService.getSubjectsByPlanOrganized
// (GET /v1/subjects?plan=).

import type { Deps } from '../../deps';
import { sqlState, withTx } from '../../db/client';
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
   * The plan comes from plan_entry_effective: the sync's copy of ITBA's plan
   * with the staff edits applied (docs/PLANS.md). A plan the sync hasn't
   * stored from ITBA yet (only BACKFILL rows, or none) is fetched live,
   * deliberately NOT inside a transaction (the call can take the client's
   * 30 s read timeout), and stored, so the edits apply and the next request
   * reads it. Then read-only queries hydrate the commissions cached by the sync.
   */
  async getSubjectsByPlanOrganized(planId: string, viewerId: string | null): Promise<OrganizedSubjects> {
    const subjectPlans = await this.planEntries(planId);
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

  private async planEntries(planId: string): Promise<planRepo.PlanEntry[]> {
    const [registered, synced, fetchedAt] = await withTx(this.deps.db, async (tx) =>
      [await planRepo.planExists(tx, planId), await planRepo.syncedFromItba(tx, planId), await planRepo.planFetchedAt(tx, planId)] as const,
    { readOnly: true });
    const stored = () => withTx(this.deps.db, (tx) => planRepo.findEffectiveEntries(tx, planId), { readOnly: true });
    // Not registered: the sync never refreshes it and staff can't edit it, so it stays live (as it always was).
    if (!registered) return (await this.deps.itba.getSubjectsByPlan(planId)).subjects;
    if (synced) {
      if (fetchedAt !== null && systemNowMicros() - parsePgTimestamp(fetchedAt) > STALE_AFTER_MICROS) {
        // Still served (better than nothing while ITBA fails), but its syncs are failing: say so.
        this.deps.log.warn({ plan: planId, fetchedAt }, 'Serving plan entries older than 2 days: its sync keeps failing');
      }
      return stored();
    }
    let live: planRepo.PlanEntry[];
    try {
      live = (await this.deps.itba.getSubjectsByPlan(planId)).subjects;
    } catch (e) {
      // A BACKFILL copy (or staff-added subjects) beats an error.
      const fallback = await stored();
      if (fallback.length === 0) throw e;
      this.deps.log.warn({ err: e, plan: planId }, 'ITBA failed for an unsynced plan: serving its stored copy');
      return fallback;
    }
    // An empty answer is not stored: it would wipe the BACKFILL copy the other readers use.
    if (live.length === 0) return stored();
    try {
      await withTx(this.deps.db, (tx) => planRepo.replacePlanEntries(tx, planId, live, systemNowMicros()));
    } catch (e) {
      // A concurrent sync or request stored it first, or a row was rejected: the stored copy has the edits.
      if (sqlState(e) === undefined) throw e;
      this.deps.log.warn({ err: e, plan: planId }, 'Could not store the plan fetched live');
    }
    return stored();
  }
}
