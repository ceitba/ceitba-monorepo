// service/plan/SubjectPlanService: the DB-only endpoints of /v1/plans, on
// plan_entry_effective (ITBA's plan with the staff edits, docs/PLANS.md). The
// organized GET /v1/subjects?plan= lives in features/subject (it needs the
// ITBA client and the commission overlay).

import type { Deps } from '../../deps';
import { withTx, type Db } from '../../db/client';
import { ResourceAlreadyExistsError, ResourceNotFoundError } from '../../http/errors';
import type { CreateSubjectPlanRequest, PlanSectionRequirementResponse, SubjectPlanResponse, UpdateSubjectPlanRequest } from './dto';
import * as repo from './repo';

export interface PlanFilters { year: number | null; semester: number | null; section: string | null; type: string | null }

export class SubjectPlanService {
  constructor(private readonly deps: Deps) {}

  /** The plan's entries (plan_entry_effective: ITBA's plan with the staff edits), in plan order; a subject may repeat. */
  getSubjectsByPlan(planId: string, f: PlanFilters): Promise<SubjectPlanResponse[]> {
    let filter: repo.EntryFilter;
    if (f.year !== null && f.semester !== null) filter = { year: f.year, semester: f.semester };
    else if (f.year !== null) filter = { year: f.year };
    else if (f.section !== null) filter = { section: f.section };
    else if (f.type === 'elective') filter = { year: 0, semester: 0 };
    else filter = {};
    return withTx(this.deps.db, async (tx) => (await repo.findEffectiveEntries(tx, planId, filter)).map(response), { readOnly: true });
  }

  /** The elective-group credits the sync stored for the plan; [] for a plan without them or an unknown plan. */
  getRequirements(planId: string): Promise<PlanSectionRequirementResponse[]> {
    return withTx(this.deps.db, async (tx) => (await repo.findSectionRequirements(tx, planId))
      .map((r) => ({ section: r.section, credits: r.credits, year: r.year, semester: r.semester })), { readOnly: true });
  }

  getPlansForSubject(subjectId: string): Promise<SubjectPlanResponse[]> {
    return withTx(this.deps.db, async (tx) => (await repo.findEffectiveEntriesOfSubject(tx, subjectId)).map(response), { readOnly: true });
  }

  /** The subject's first entry in the plan, when it sits in several sections. */
  getOne(planId: string, subjectId: string): Promise<SubjectPlanResponse> {
    return withTx(this.deps.db, async (tx) => response(await this.entry(tx, planId, subjectId)), { readOnly: true });
  }

  /**
   * Staff edits are kept apart from ITBA's copy (plan_entry_override) and win over it: the sync never touches them.
   * Adds a subject the plan doesn't show: one ITBA doesn't send (listed after ITBA's, unset fields 0 / []), or one
   * staff hid, which shows again with only the given fields changed (its section only if it isn't already one of
   * ITBA's for it).
   */
  create(planId: string, req: CreateSubjectPlanRequest): Promise<SubjectPlanResponse> {
    return withTx(this.deps.db, async (tx) => {
      const subjectId = req.subjectId!;
      if (!(await repo.planExists(tx, planId))) throw new ResourceNotFoundError('Plan', planId);
      if (!(await repo.subjectExists(tx, subjectId))) throw new ResourceNotFoundError('Subject', subjectId);
      if (await repo.findEffectiveEntry(tx, planId, subjectId)) throw new ResourceAlreadyExistsError('SubjectPlan', `${planId}/${subjectId}`);
      const deps = req.dependencies?.filter((d): d is string => d !== null) ?? null;
      const itbaSections = await repo.itbaSectionsOf(tx, planId, subjectId);
      if (itbaSections.length > 0) {
        await repo.patchOverride(tx, planId, subjectId, {
          section: itbaSections.includes(req.section!) ? null : req.section!, year: req.year, semester: req.semester,
          dependencies: deps, creditsRequired: req.creditsRequired,
        }, this.deps.clock.now());
      } else {
        await repo.addOverride(tx, planId, subjectId, {
          section: req.section!, year: req.year ?? 0, semester: req.semester ?? 0, dependencies: deps ?? [], creditsRequired: req.creditsRequired ?? 0,
        }, this.deps.clock.now());
      }
      return response(await this.entry(tx, planId, subjectId));
    });
  }

  /** A patch: each given field replaces ITBA's value from now on (null keeps the current one). */
  update(planId: string, subjectId: string, req: UpdateSubjectPlanRequest): Promise<SubjectPlanResponse> {
    return withTx(this.deps.db, async (tx) => {
      await this.entry(tx, planId, subjectId);
      await repo.patchOverride(tx, planId, subjectId, {
        section: req.section, year: req.year, semester: req.semester,
        dependencies: req.dependencies?.filter((d): d is string => d !== null) ?? null, creditsRequired: req.creditsRequired,
      }, this.deps.clock.now());
      return response(await this.entry(tx, planId, subjectId));
    });
  }

  /** Hides a subject ITBA lists (it stays hidden across syncs); removes one staff added. */
  delete(planId: string, subjectId: string): Promise<void> {
    return withTx(this.deps.db, async (tx) => {
      await this.entry(tx, planId, subjectId);
      if ((await repo.itbaSectionsOf(tx, planId, subjectId)).length > 0) await repo.hideOverride(tx, planId, subjectId, this.deps.clock.now());
      else await repo.deleteOverride(tx, planId, subjectId);
    });
  }

  private async entry(db: Db, planId: string, subjectId: string): Promise<repo.EffectiveEntry> {
    const e = await repo.findEffectiveEntry(db, planId, subjectId);
    if (!e) throw new ResourceNotFoundError('SubjectPlan', `${planId}/${subjectId}`);
    return e;
  }
}

/** The response keeps the plan_subject shape: no year/semester is 0, no credits_required is 0. */
function response(e: repo.EffectiveEntry): SubjectPlanResponse {
  return {
    subjectId: e.subjectId, planId: e.planId, section: e.section ?? '', year: e.year ?? 0, semester: e.semester ?? 0,
    dependencies: e.dependencies, creditsRequired: e.creditsRequired ?? 0,
    subject: e.subjectName !== null ? { id: e.subjectId, name: e.subjectName, credits: e.subjectCredits } : null,
  };
}
