// external/itba/*: every call to the upstream ITBA academic gateway goes
// through ItbaApiClient. Selected like Java: ITBA_API_USE_FAKE=true ->
// FakeItbaApiClient (ITBA_API_FAKE_FROM_DB=true reads unstubbed plans from the
// local plan_subject table), else the real client.
//
// NOT PORTED YET: RestClientItbaApiClient (the HTTP client + wire mapping,
// external/itba/RestClientItbaApiClient.java and wire/*). The sync/career
// feature agent ports it into this file as `RestItbaApiClient`; until then the
// real slot throws ExternalApiError so nothing silently returns empty data.

import { sql } from 'drizzle-orm';
import type { Config } from '../config';
import type { Database } from '../db/client';
import { ExternalApiError } from '../http/errors';

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
  getSubjectsByPlan(planId: string): Promise<SubjectPlanProjection[]>;
  getCommissions(query: CommissionQuery): Promise<CommissionProjection[]>;
  getCommissionsBySubject(subjectCode: string, query: CommissionQuery): Promise<CommissionProjection[]>;
}

/** FakeItbaApiClient: canned responses staged with stub*(); optional DB fallback for plans. */
export class FakeItbaApiClient implements ItbaApiClient {
  private readonly plans = new Map<string, SubjectPlanProjection[]>();
  private commissions: CommissionProjection[] = [];
  constructor(private readonly fallbackDb: Database | null = null) {}

  stubPlan(planId: string, entries: SubjectPlanProjection[]) { this.plans.set(planId, [...entries]); }
  stubCommissions(entries: CommissionProjection[]) { this.commissions = [...entries]; }
  reset() { this.plans.clear(); this.commissions = []; }

  async getSubjectsByPlan(planId: string): Promise<SubjectPlanProjection[]> {
    const stubbed = this.plans.get(planId);
    if (stubbed) return stubbed;
    if (!this.fallbackDb) return [];
    const rows = await this.fallbackDb.execute(sql`
      SELECT ps.subject_id, ps.plan_id, ps.section, ps.year, ps.semester, ps.dependencies,
             ps.credits_required, s.name, s.credits
      FROM plan_subject ps JOIN subject s ON s.id = ps.subject_id
      WHERE ps.plan_id = ${planId}
      ORDER BY ps.year, ps.semester, ps.subject_id`);
    return (rows as unknown as Record<string, unknown>[]).map((r) => ({
      subjectId: r.subject_id as string,
      planId: r.plan_id as string,
      section: (r.section as string | null) ?? null,
      year: (r.year as number | null) ?? null,
      semester: (r.semester as number | null) ?? null,
      // A VARCHAR[] may hold NULL elements: skip them.
      dependencies: ((r.dependencies as (string | null)[] | null) ?? []).filter((d): d is string => d !== null),
      creditsRequired: (r.credits_required as number | null) ?? null,
      subjectName: (r.name as string | null) ?? null,
      subjectCredits: Number(r.credits ?? 0),
    }));
  }

  async getCommissions(): Promise<CommissionProjection[]> {
    return [...this.commissions];
  }

  async getCommissionsBySubject(subjectCode: string): Promise<CommissionProjection[]> {
    return this.commissions.filter((c) => c.subjectCode === subjectCode);
  }
}

/** Placeholder for RestClientItbaApiClient until the sync feature ports it (see header). */
export class NotPortedItbaApiClient implements ItbaApiClient {
  private fail(op: string): never {
    throw new ExternalApiError('ITBA API', op, new Error('RestClientItbaApiClient is not ported yet'));
  }
  getSubjectsByPlan(): Promise<SubjectPlanProjection[]> { return this.fail('getSubjectsByPlan'); }
  getCommissions(): Promise<CommissionProjection[]> { return this.fail('getCommissions'); }
  getCommissionsBySubject(): Promise<CommissionProjection[]> { return this.fail('getCommissionsBySubject'); }
}

export function createItbaClient(config: Config, db: Database): ItbaApiClient {
  if (config.integrations.itba.useFake) return new FakeItbaApiClient(config.integrations.itba.fakeFromDb ? db : null);
  return new NotPortedItbaApiClient();
}
