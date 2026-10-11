import type { CeitbaApi } from "./api/client";
import type { Career, CatalogSubject, SubjectCatalog } from "./api/types";

// The subjects catalog of a plan (GET /v1/subjects?plan=) is public, large
// and changes rarely, so it is fetched anonymously (no per-user my_vote) and
// cached briefly per process. Same for the commissions list (quotas).
//
// Plan ids come from tool arguments, so they are checked against the real
// plans (GET /v1/careers/plans, also cached) before anything is fetched or
// cached: made-up ids cost no upstream call and never grow the caches. The
// per-plan caches are also capped (least recently used out).

// Thrown for a plan id that isn't one of CEITBA's plans.
export class UnknownPlanError extends Error {
  constructor(readonly plan: string) {
    super(`Unknown plan: ${plan}`);
  }
}

export interface PlanSubject extends CatalogSubject {
  year: number | null;
  semester: number | null;
}

interface Entry<T> { value: T; at: number }

export class CatalogCache {
  private plans: Entry<Set<string>> | null = null;
  private readonly subjects = new Map<string, Entry<PlanSubject[]>>();
  private readonly commissions = new Map<string, Entry<CommissionInfo[]>>();

  constructor(
    private readonly ttlMs = 5 * 60_000,
    private readonly now: () => number = Date.now,
    private readonly maxPlans = 100
  ) {}

  // Every plan id of every career.
  async knownPlans(api: CeitbaApi): Promise<Set<string>> {
    if (this.plans && this.now() - this.plans.at < this.ttlMs) return this.plans.value;
    const careers = await api.withCredentials({}).get<Record<string, Career>>("/v1/careers/plans");
    const value = new Set(Object.values(careers ?? {}).flatMap(c => c.plans ?? []));
    this.plans = { value, at: this.now() };
    return value;
  }

  async planSubjects(api: CeitbaApi, plan: string): Promise<PlanSubject[]> {
    return this.cached(this.subjects, api, plan, async () =>
      flattenCatalog(await api.withCredentials({}).get<SubjectCatalog>("/v1/subjects", { plan })));
  }

  async planCommissions(api: CeitbaApi, plan: string): Promise<CommissionInfo[]> {
    return this.cached(this.commissions, api, plan, () =>
      api.withCredentials({}).get<CommissionInfo[]>("/v1/commissions", { plan }));
  }

  private async cached<T>(map: Map<string, Entry<T>>, api: CeitbaApi, plan: string, load: () => Promise<T>): Promise<T> {
    const hit = map.get(plan);
    if (hit && this.now() - hit.at < this.ttlMs) {
      map.delete(plan); // re-insert: Map order is the LRU order
      map.set(plan, hit);
      return hit.value;
    }
    if (!(await this.knownPlans(api)).has(plan)) throw new UnknownPlanError(plan);
    const value = await load();
    map.delete(plan);
    map.set(plan, { value, at: this.now() });
    while (map.size > this.maxPlans) map.delete(map.keys().next().value as string);
    return value;
  }
}

export interface CommissionInfo {
  id: string;
  subjectCode: string;
  subjectName: string;
  commissionName: string;
  quota: number | null;
  enrolledStudents: number | null;
}

const toInt = (s: string): number | null => {
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
};

export function flattenCatalog(catalog: SubjectCatalog): PlanSubject[] {
  const out: PlanSubject[] = [];
  const seen = new Set<string>();
  for (const years of Object.values(catalog ?? {})) {
    for (const [year, semesters] of Object.entries(years ?? {})) {
      for (const [semester, subjects] of Object.entries(semesters ?? {})) {
        for (const s of subjects ?? []) {
          // Electives can appear under several sections; keep the first.
          if (seen.has(s.subject_id)) continue;
          seen.add(s.subject_id);
          out.push({ ...s, year: toInt(year), semester: toInt(semester) });
        }
      }
    }
  }
  return out;
}

export const sharedCatalog = new CatalogCache();
