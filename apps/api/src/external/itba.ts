// external/itba/*: every call to the upstream ITBA academic gateway goes
// through ItbaApiClient. Selected like Java: ITBA_API_USE_FAKE=true ->
// FakeItbaApiClient (ITBA_API_FAKE_FROM_DB=true replays unstubbed plans from
// the local plan_entry table), else the real client.
//
// The real client (RestClientItbaApiClient + wire/*) is in ./itba/restClient.ts
// and ./itba/wire.ts.

import { sql } from 'drizzle-orm';
import type { Config } from '../config';
import type { Database } from '../db/client';
import type { Clock } from '../infra/clock';
import type { Logger } from '../infra/logger';
import { RestItbaApiClient } from './itba/restClient';

export type SubjectType = 'ANNUAL' | 'SEMESTRAL' | 'SAMINARY';
export type DayOfWeek = 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY';

/** SubjectPlanProjection: one subject within a plan as the gateway returns it. */
export interface SubjectPlanProjection {
  subjectId: string;
  planId: string;
  section: string | null;
  year: number | null;
  semester: number | null;
  dependencies: string[];
  creditsRequired: number | null;
  subjectName: string | null;
  subjectCredits: number;
}

/**
 * The credits a plan asks for in one elective group: a term entry of type "section" whose name is the
 * section that lists the group's subjects (docs/ITBA-GATEWAY.md "Elective groups").
 */
export interface PlanSectionRequirementProjection {
  planId: string;
  section: string;
  credits: number;
  year: number | null;
  semester: number | null;
}

/** GET /careerPlans for one plan: its subjects and its elective-group requirements. */
export interface PlanProjection {
  subjects: SubjectPlanProjection[];
  requirements: PlanSectionRequirementProjection[];
}

export interface TimeSlot {
  day: DayOfWeek | null;
  classroom: string | null;
  building: string | null;
  /** LocalTime `HH:mm:ss`. */
  hourFrom: string | null;
  hourTo: string | null;
}

/** CommissionProjection. Dates are LocalDate `YYYY-MM-DD`. */
export interface CommissionProjection {
  id: string;
  subjectCode: string;
  subjectName: string | null;
  commissionName: string;
  courseStart: string | null;
  courseEnd: string | null;
  enrolledStudents: number;
  quota: number;
  /** null when ITBA sent none or an unknown one. */
  subjectType: SubjectType | null;
  times: TimeSlot[];
}

/** CommissionQuery: missing fields fall back to the current period. */
export interface CommissionQuery {
  year?: number | null;
  period?: string | null;
  levels?: string[] | null;
}
export const DEFAULT_LEVELS = ['GRADUATE', 'UNDERGRADUATE'];
export const PERIODS = ['FirstSemester', 'SecondSemester'];

/** CommissionQuery.withDefaultsFilled(today): Feb-June = FirstSemester, else SecondSemester. */
export function withDefaultsFilled(q: CommissionQuery, today: string): Required<{ [K in keyof CommissionQuery]: NonNullable<CommissionQuery[K]> }> {
  const [y, m] = today.split('-').map(Number) as [number, number];
  return {
    year: q.year ?? y,
    period: q.period ?? (m >= 2 && m <= 6 ? 'FirstSemester' : 'SecondSemester'),
    levels: q.levels && q.levels.length ? q.levels : DEFAULT_LEVELS,
  };
}

export interface ItbaApiClient {
  getSubjectsByPlan(planId: string): Promise<PlanProjection>;
  getCommissions(query: CommissionQuery): Promise<CommissionProjection[]>;
  getCommissionsBySubject(subjectCode: string, query: CommissionQuery): Promise<CommissionProjection[]>;
}

/** FakeItbaApiClient: canned responses staged with stub*(); optional DB fallback for plans. */
export class FakeItbaApiClient implements ItbaApiClient {
  private readonly plans = new Map<string, PlanProjection>();
  private commissions: CommissionProjection[] = [];
  constructor(private readonly fallbackDb: Database | null = null) {}

  stubPlan(planId: string, entries: SubjectPlanProjection[], requirements: PlanSectionRequirementProjection[] = []) {
    this.plans.set(planId, { subjects: [...entries], requirements: [...requirements] });
  }
  stubCommissions(entries: CommissionProjection[]) { this.commissions = [...entries]; }
  reset() { this.plans.clear(); this.commissions = []; }

  async getSubjectsByPlan(planId: string): Promise<PlanProjection> {
    const stubbed = this.plans.get(planId);
    if (stubbed) return { subjects: [...stubbed.subjects], requirements: [...stubbed.requirements] };
    if (!this.fallbackDb) return { subjects: [], requirements: [] };
    // Replays the stored copy of ITBA's plan (plan_entry, no staff edits: those apply on top, as with the real one).
    const rows = await this.fallbackDb.execute(sql`
      SELECT subject_id, plan_id, section, year, semester, dependencies, credits_required, subject_name, subject_credits
      FROM plan_entry WHERE plan_id = ${planId} ORDER BY position`);
    const subjects = (rows as unknown as Record<string, unknown>[]).map((r) => ({
      subjectId: r.subject_id as string,
      planId: r.plan_id as string,
      section: (r.section as string | null) ?? null,
      year: (r.year as number | null) ?? null,
      semester: (r.semester as number | null) ?? null,
      dependencies: ((r.dependencies as (string | null)[] | null) ?? []).filter((d): d is string => d !== null),
      creditsRequired: (r.credits_required as number | null) ?? null,
      subjectName: (r.subject_name as string | null) ?? null,
      subjectCredits: Number(r.subject_credits ?? 0),
    }));
    // Read back too, or a sync from the fake would wipe the stored requirements.
    const reqRows = await this.fallbackDb.execute(sql`
      SELECT plan_id, section, credits, year, semester FROM plan_section_requirement
      WHERE plan_id = ${planId} ORDER BY year, semester, section`);
    const requirements = (reqRows as unknown as Record<string, unknown>[]).map((r) => ({
      planId: r.plan_id as string, section: r.section as string, credits: Number(r.credits),
      year: r.year as number, semester: r.semester as number,
    }));
    return { subjects, requirements };
  }

  async getCommissions(): Promise<CommissionProjection[]> {
    return [...this.commissions];
  }

  async getCommissionsBySubject(subjectCode: string): Promise<CommissionProjection[]> {
    return this.commissions.filter((c) => c.subjectCode === subjectCode);
  }
}

/**
 * The Java client takes the ART ClockConfig clock, used only to fill a
 * CommissionQuery's defaults (DataSyncService always passes a filled one).
 */
/** ItbaClientConfig: the fake (ITBA_API_USE_FAKE) or the REST client with the app's Clock bean and logger. */
export function createItbaClient(config: Config, db: Database, clock: Clock, log: Logger): ItbaApiClient {
  const itba = config.integrations.itba;
  if (itba.useFake) return new FakeItbaApiClient(itba.fakeFromDb ? db : null);
  return new RestItbaApiClient({ baseUrl: itba.baseUrl, token: itba.token, timeoutMs: itba.timeoutMs }, clock,
    log.child({ component: 'RestClientItbaApiClient' }));
}
