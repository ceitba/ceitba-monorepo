// service/sync/DataSyncService + SyncUpserter + DataSyncResult: pulls the ITBA
// snapshot and upserts subjects, plan-subjects and commissions. One
// transaction per plan and per commission (REQUIRES_NEW): a bad row in plan A
// does not roll back plan B.

import type { Deps } from '../../deps';
import { sqlState, withSavepoint, withTx, type Db } from '../../db/client';
import type { CommissionProjection, CommissionQuery, PlanSectionRequirementProjection, SubjectPlanProjection } from '../../external/itba';
import { withDefaultsFilled } from '../../external/itba';
import { javaCompareStrings, javaIsBlank } from '../../lib/javaCompat';
import { systemNowMicros } from '../../lib/time';
import { compareSlots, fromTimes, hhmm, onSgaSlotsChanged, sameSet, type CorrectionSlot } from '../commission/correctionOverlay';
import * as commissionRepo from '../commission/repo';
import * as planRepo from '../plan/repo';
import * as syncRepo from './repo';

export class Counters {
  created = 0;
  updated = 0;
  errors = 0;
}

/** DataSyncResult. Serialized by toJSON() (see dto.ts dataSyncResultJson for the Jackson shape). */
export class DataSyncResult {
  readonly subjects = new Counters();
  readonly subjectPlans = new Counters();
  readonly commissions = new Counters();
  totalProcessed = 0;
  duration = 0;

  finish(durationMs: number) {
    this.duration = durationMs;
    this.totalProcessed = this.subjects.created + this.subjects.updated + this.subjectPlans.created
      + this.subjectPlans.updated + this.commissions.created + this.commissions.updated;
  }
}

const DEFAULTS: CommissionQuery = { year: null, period: null, levels: null };

export class DataSyncService {
  private readonly log;
  constructor(private readonly deps: Deps) {
    this.log = deps.log.child({ component: 'DataSyncService' });
  }

  async syncAll(query: CommissionQuery | null): Promise<DataSyncResult> {
    const t0 = Date.now();
    this.log.info('Starting full data sync');
    const result = new DataSyncResult();
    try {
      await this.syncSubjectsAndPlans(result);
      await this.syncCommissions(result, query ?? DEFAULTS);
      return result;
    } finally {
      result.finish(Date.now() - t0);
      this.log.info({ duration: result.duration, processed: result.totalProcessed }, 'Full data sync done');
    }
  }

  async syncSubjectsAndPlansOnly(): Promise<DataSyncResult> {
    const t0 = Date.now();
    const result = new DataSyncResult();
    try {
      await this.syncSubjectsAndPlans(result);
      return result;
    } finally {
      result.finish(Date.now() - t0);
    }
  }

  async syncCommissionsOnly(query: CommissionQuery | null): Promise<DataSyncResult> {
    const t0 = Date.now();
    const result = new DataSyncResult();
    try {
      await this.syncCommissions(result, query ?? DEFAULTS);
      return result;
    } finally {
      result.finish(Date.now() - t0);
    }
  }

  async syncByPlan(planId: string): Promise<SubjectPlanProjection[]> {
    const { subjects, requirements } = await this.deps.itba.getSubjectsByPlan(planId);
    await this.upsertPlanEntries(planId, subjects, new DataSyncResult(), requirements);
    return subjects;
  }

  async syncCommissionsBySubject(subjectCode: string, query: CommissionQuery | null): Promise<CommissionProjection[]> {
    const q = withDefaultsFilled(query ?? DEFAULTS, this.deps.clock.today());
    const commissions = await this.deps.itba.getCommissionsBySubject(subjectCode, q);
    const result = new DataSyncResult();
    for (const c of commissions) await this.countCommission(c, q, result);
    return commissions;
  }

  private async syncSubjectsAndPlans(result: DataSyncResult) {
    this.log.info('Syncing subjects + plans');
    // careerRepository.findAll() / planRepository.findByCareer_Id: no ORDER BY.
    const careers = await withTx(this.deps.db, (tx) => syncRepo.careerIds(tx), { readOnly: true });
    for (const careerId of careers) {
      const plans = await withTx(this.deps.db, (tx) => syncRepo.planIdsOfCareer(tx, careerId), { readOnly: true });
      for (const planId of plans) {
        try {
          const { subjects, requirements } = await this.deps.itba.getSubjectsByPlan(planId);
          await this.upsertPlanEntries(planId, subjects, result, requirements);
        } catch (e) {
          this.log.error({ err: e, plan: planId, career: careerId }, 'Failed to sync plan');
          result.subjectPlans.errors++;
        }
      }
    }
  }

  private async syncCommissions(result: DataSyncResult, query: CommissionQuery) {
    const q = withDefaultsFilled(query, this.deps.clock.today());
    this.log.info({ year: q.year, period: q.period, levels: q.levels }, 'Syncing commissions');
    let commissions: CommissionProjection[];
    try {
      commissions = await this.deps.itba.getCommissions(q);
    } catch (e) {
      this.log.error({ err: e }, 'Failed to fetch commissions from ITBA API');
      throw e;
    }
    if (commissions.length === 0) {
      this.log.warn('No commissions returned from ITBA API');
      return;
    }
    // Backfill missing subjects so the commissions reference something (each save its own transaction).
    const existing = new Set((await withTx(this.deps.db, (tx) => planRepo.findAllSubjectIds(tx), { readOnly: true })).map((s) => s.id));
    for (const c of commissions) {
      if (existing.has(c.subjectCode)) continue;
      try {
        const name = c.subjectName !== null && !javaIsBlank(c.subjectName) ? c.subjectName : c.subjectCode;
        await withTx(this.deps.db, (tx) => planRepo.insertSubject(tx, c.subjectCode, name, 0, systemNowMicros()));
        existing.add(c.subjectCode);
        result.subjects.created++;
      } catch (e) {
        this.log.error({ err: e, subject: c.subjectCode }, 'Failed to backfill subject');
        result.subjects.errors++;
      }
    }
    for (const c of commissions) {
      try {
        await this.countCommission(c, q, result);
      } catch (e) {
        this.log.error({ err: e, commission: c.id }, 'Failed to upsert commission');
        result.commissions.errors++;
      }
    }
  }

  /** `term` is the filled query: its year and period are stamped on the row. */
  private async countCommission(p: CommissionProjection, term: Required<{ [K in keyof CommissionQuery]: NonNullable<CommissionQuery[K]> }>, result: DataSyncResult) {
    if (await this.upsertCommission(p, term)) result.commissions.created++;
    else result.commissions.updated++;
  }

  // ------------------------------------------------------------ SyncUpserter

  /**
   * @Transactional(REQUIRES_NEW): one transaction per plan. Hibernate queues
   * the saves and flushes them at commit, so a row the database rejects is
   * counted like the others and then fails the whole plan once (the caller
   * counts one error and nothing of the plan is kept). Emulated by counting
   * before writing, running each entry's writes in a savepoint, and failing
   * the transaction at the end when a write was rejected.
   *
   * The plan's elective-group requirements are replaced in the same transaction (not counted in the result, whose
   * JSON is fixed), in a savepoint: a rejected requirement is logged and leaves the stored ones as they were, never
   * failing the subjects. They need the plan row (FK): a plan synced by id before staff added it keeps only its
   * subjects.
   */
  async upsertPlanEntries(planId: string, entries: SubjectPlanProjection[], result: DataSyncResult,
    requirements: PlanSectionRequirementProjection[] = []): Promise<void> {
    await withTx(this.deps.db, async (tx) => {
      if (await planRepo.planExists(tx, planId)) {
        try {
          await withSavepoint(tx, (sp) => planRepo.replaceSectionRequirements(sp, planId, requirements.map((r) => ({
            planId, section: r.section, credits: r.credits, year: r.year ?? 0, semester: r.semester ?? 0,
          }))));
        } catch (e) {
          if (sqlState(e) === undefined) throw e;
          this.log.error({ err: e, plan: planId }, 'Failed to replace plan section requirements');
        }
      }
      let rejected: unknown = null;
      for (const entry of entries) {
        try {
          const writes: ((db: Db) => Promise<void>)[] = [];
          await this.upsertSubject(tx, entry, result, writes);
          await this.upsertPlanSubject(tx, entry, result, writes);
          try {
            await withSavepoint(tx, async (sp) => {
              for (const w of writes) await w(sp);
            });
          } catch (e) {
            if (sqlState(e) === undefined) throw e;
            rejected ??= e;
          }
        } catch (e) {
          this.log.error({ err: e, plan: planId, subject: entry.subjectId }, 'Failed to upsert plan subject');
          result.subjectPlans.errors++;
        }
      }
      if (rejected !== null) throw rejected;
    });
  }

  private async upsertSubject(tx: Db, entry: SubjectPlanProjection, result: DataSyncResult, writes: ((db: Db) => Promise<void>)[]) {
    const s = await planRepo.findSubject(tx, entry.subjectId);
    if (s) {
      if (s.name !== entry.subjectName || s.credits !== entry.subjectCredits) {
        writes.push((db) => planRepo.updateSubject(db, s.id, entry.subjectName as string, entry.subjectCredits, systemNowMicros()));
        result.subjects.updated++;
      }
    } else {
      writes.push((db) => planRepo.insertSubject(db, entry.subjectId, entry.subjectName as string, entry.subjectCredits, systemNowMicros()));
      result.subjects.created++;
    }
  }

  private async upsertPlanSubject(tx: Db, entry: SubjectPlanProjection, result: DataSyncResult, writes: ((db: Db) => Promise<void>)[]) {
    const existing = await planRepo.findPlanSubject(tx, entry.subjectId, entry.planId);
    const ps: planRepo.PlanSubject = {
      subjectId: entry.subjectId, planId: entry.planId,
      section: entry.section ?? '',
      year: entry.year ?? 0,
      semester: entry.semester ?? 0,
      creditsRequired: entry.creditsRequired ?? 0, // schema is NOT NULL; default 0
      dependencies: entry.dependencies ?? [],
    };
    if (!existing) {
      writes.push((db) => planRepo.insertPlanSubject(db, ps));
      result.subjectPlans.created++;
    } else if (planSubjectChanged(existing, ps)) {
      writes.push((db) => planRepo.updatePlanSubject(db, ps));
      result.subjectPlans.updated++;
    }
  }

  /**
   * @Transactional(REQUIRES_NEW). True when created. An existing commission is
   * locked (SELECT ... FOR UPDATE); name/dates/type are refreshed, a missing
   * name or unknown type keeps the stored value; slots are replaced, and a
   * slot change ends the open schedule corrections made against the old ones.
   */
  async upsertCommission(p: CommissionProjection, term: { year: number; period: string }): Promise<boolean> {
    return withTx(this.deps.db, async (tx) => {
      const existing = await commissionRepo.findForUpdate(tx, p.id);
      const c: commissionRepo.Commission = existing ?? {
        id: p.id, subjectCode: p.subjectCode, commissionName: p.commissionName, courseStart: p.courseStart as string,
        courseEnd: p.courseEnd as string, enrolledStudents: p.enrolledStudents, quota: p.quota,
        subjectType: p.subjectType ?? 'SEMESTRAL', termYear: null, termPeriod: null, times: [],
      };
      const name = p.commissionName != null && !javaIsBlank(p.commissionName) ? p.commissionName : c.commissionName;
      const type = p.subjectType ?? c.subjectType;
      if (existing && (c.commissionName !== name || c.courseStart !== p.courseStart || c.courseEnd !== p.courseEnd || c.subjectType !== type)) {
        this.log.info({ commission: p.id, subject: p.subjectCode,
          before: [c.commissionName, c.courseStart, c.courseEnd, c.subjectType], after: [name, p.courseStart, p.courseEnd, type] },
        'Commission changed upstream');
      }
      const updated: commissionRepo.Commission = {
        ...c, commissionName: name, courseStart: p.courseStart as string, courseEnd: p.courseEnd as string, subjectType: type,
        enrolledStudents: p.enrolledStudents, quota: p.quota,
        // setTerm(int, String): (short) year.
        termYear: ((term.year << 16) >> 16), termPeriod: term.period,
      };
      const newSlots: CorrectionSlot[] = p.times
        .map((t) => ({ day: t.day as string, from: hhmm(t.hourFrom as string), to: hhmm(t.hourTo as string) }))
        .sort(compareSlots);
      const slotsChanged = existing !== null && !sameSet(fromTimes(c.times), newSlots);

      if (existing) {
        await commissionRepo.deleteTimes(tx, p.id);
        await commissionRepo.updateCommission(tx, updated);
      } else {
        await commissionRepo.insertCommission(tx, updated);
      }
      for (const slot of p.times) {
        await commissionRepo.insertTime(tx, {
          courseId: p.id, day: slot.day as commissionRepo.CommissionTime['day'], hourFrom: slot.hourFrom as string,
          classroom: slot.classroom as string, building: slot.building as string, hourTo: slot.hourTo as string,
        });
      }
      // Student corrections were made against the old SGA slots.
      if (slotsChanged) await onSgaSlotsChanged(tx, p.id, newSlots, this.log);
      return existing === null;
    });
  }
}

function planSubjectChanged(a: planRepo.PlanSubject, b: planRepo.PlanSubject): boolean {
  const sorted = (l: (string | null)[]) => [...l].sort((x, y) => javaCompareStrings(x as string, y as string)).join('\u0000');
  return a.section !== b.section || a.year !== b.year || a.semester !== b.semester
    || a.creditsRequired !== b.creditsRequired || sorted(a.dependencies) !== sorted(b.dependencies);
}
