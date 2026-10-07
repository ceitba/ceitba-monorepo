import type { CeitbaApi } from "./api/client";
import type { CatalogSubject, SubjectCatalog } from "./api/types";

// The subjects catalog of a plan (GET /v1/subjects?plan=) is public, large
// and changes rarely, so it is fetched anonymously (no per-user my_vote) and
// cached briefly per process. Same for the commissions list (quotas).

export interface PlanSubject extends CatalogSubject {
  year: number | null;
  semester: number | null;
}

interface Entry<T> { value: T; at: number }

export class CatalogCache {
  private readonly subjects = new Map<string, Entry<PlanSubject[]>>();
  private readonly commissions = new Map<string, Entry<CommissionInfo[]>>();

  constructor(private readonly ttlMs = 5 * 60_000, private readonly now: () => number = Date.now) {}

  async planSubjects(api: CeitbaApi, plan: string): Promise<PlanSubject[]> {
    const hit = this.subjects.get(plan);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.value;
    const raw = await api.withCredentials({}).get<SubjectCatalog>("/v1/subjects", { plan });
    const value = flattenCatalog(raw);
    this.subjects.set(plan, { value, at: this.now() });
    return value;
  }

  async planCommissions(api: CeitbaApi, plan: string): Promise<CommissionInfo[]> {
    const hit = this.commissions.get(plan);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.value;
    const value = await api.withCredentials({}).get<CommissionInfo[]>("/v1/commissions", { plan });
    this.commissions.set(plan, { value, at: this.now() });
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
