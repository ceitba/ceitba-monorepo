// service/plan/SubjectPlanService: the DB-only endpoints of /v1/plans. The
// organized GET /v1/subjects?plan= lives in features/subject (it needs the
// ITBA client and the commission overlay).

import type { Deps } from '../../deps';
import { withTx, type Db } from '../../db/client';
import { ResourceAlreadyExistsError, ResourceNotFoundError } from '../../http/errors';
import type { CreateSubjectPlanRequest, SubjectPlanResponse, UpdateSubjectPlanRequest } from './dto';
import * as repo from './repo';

export interface PlanFilters { year: number | null; semester: number | null; section: string | null; type: string | null }

export class SubjectPlanService {
  constructor(private readonly deps: Deps) {}

  getSubjectsByPlan(planId: string, f: PlanFilters): Promise<SubjectPlanResponse[]> {
    return withTx(this.deps.db, async (tx) => {
      let rows: repo.PlanSubject[];
      if (f.year !== null && f.semester !== null) rows = await repo.findByPlanIdAndYearAndSemester(tx, planId, f.year, f.semester);
      else if (f.year !== null) rows = await repo.findByPlanIdAndYear(tx, planId, f.year);
      else if (f.section !== null) rows = await repo.findByPlanIdAndSection(tx, planId, f.section);
      else if (f.type === 'elective') rows = await repo.findByPlanIdAndYearAndSemester(tx, planId, 0, 0);
      else rows = await repo.findByPlanId(tx, planId);
      return this.toResponses(tx, rows);
    }, { readOnly: true });
  }

  getPlansForSubject(subjectId: string): Promise<SubjectPlanResponse[]> {
    return withTx(this.deps.db, async (tx) => this.toResponses(tx, await repo.findBySubjectId(tx, subjectId)), { readOnly: true });
  }

  getOne(planId: string, subjectId: string): Promise<SubjectPlanResponse> {
    return withTx(this.deps.db, async (tx) => {
      const ps = await repo.findPlanSubject(tx, subjectId, planId);
      if (!ps) throw new ResourceNotFoundError('SubjectPlan', `${planId}/${subjectId}`);
      return this.toResponse(tx, ps);
    }, { readOnly: true });
  }

  create(planId: string, req: CreateSubjectPlanRequest): Promise<SubjectPlanResponse> {
    return withTx(this.deps.db, async (tx) => {
      const subjectId = req.subjectId!;
      if (!(await repo.planExists(tx, planId))) throw new ResourceNotFoundError('Plan', planId);
      if (!(await repo.subjectExists(tx, subjectId))) throw new ResourceNotFoundError('Subject', subjectId);
      if (await repo.findPlanSubject(tx, subjectId, planId)) throw new ResourceAlreadyExistsError('SubjectPlan', `${planId}/${subjectId}`);
      const ps: repo.PlanSubject = {
        subjectId, planId, section: req.section!,
        year: req.year ?? 0, semester: req.semester ?? 0,
        creditsRequired: req.creditsRequired ?? 0,
        dependencies: req.dependencies ?? [],
      };
      await repo.insertPlanSubject(tx, ps);
      return this.toResponse(tx, ps);
    });
  }

  /** Java deletes the row, flushes and saves the merged entity: net effect one row with the merged values. */
  update(planId: string, subjectId: string, req: UpdateSubjectPlanRequest): Promise<SubjectPlanResponse> {
    return withTx(this.deps.db, async (tx) => {
      const existing = await repo.findPlanSubject(tx, subjectId, planId);
      if (!existing) throw new ResourceNotFoundError('SubjectPlan', `${planId}/${subjectId}`);
      await repo.deletePlanSubject(tx, subjectId, planId);
      const merged: repo.PlanSubject = {
        subjectId, planId,
        section: req.section ?? existing.section,
        year: req.year ?? existing.year,
        semester: req.semester ?? existing.semester,
        creditsRequired: req.creditsRequired ?? existing.creditsRequired,
        dependencies: req.dependencies ?? existing.dependencies,
      };
      await repo.insertPlanSubject(tx, merged);
      return this.toResponse(tx, merged);
    });
  }

  delete(planId: string, subjectId: string): Promise<void> {
    return withTx(this.deps.db, async (tx) => {
      if (!(await repo.findPlanSubject(tx, subjectId, planId))) throw new ResourceNotFoundError('SubjectPlan', `${planId}/${subjectId}`);
      await repo.deletePlanSubject(tx, subjectId, planId);
    });
  }

  private async toResponses(db: Db, rows: repo.PlanSubject[]): Promise<SubjectPlanResponse[]> {
    const out: SubjectPlanResponse[] = [];
    for (const ps of rows) out.push(await this.toResponse(db, ps));
    return out;
  }

  /** Enriched with the subject's name + credits (subjectRepository.findById per row). */
  private async toResponse(db: Db, ps: repo.PlanSubject): Promise<SubjectPlanResponse> {
    const s = await repo.findSubject(db, ps.subjectId);
    return {
      subjectId: ps.subjectId, planId: ps.planId, section: ps.section, year: ps.year, semester: ps.semester,
      dependencies: ps.dependencies, creditsRequired: ps.creditsRequired,
      subject: s ? { id: s.id, name: s.name, credits: s.credits } : null,
    };
  }
}
