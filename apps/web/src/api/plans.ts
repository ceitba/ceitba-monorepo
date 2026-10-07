import { apiGet } from './client'

// A career plan's subjects with their prerequisites (correlativas).
// planId may contain spaces: always URL-encode it.
export interface PlanSubject {
  subjectId: string
  planId: string
  section: string | null
  // Curricular position; 0/null for electives and other non-curricular
  // sections.
  year: number | null
  semester: number | null
  // Prerequisite subject ids.
  dependencies: string[]
  // Credits needed before taking it (0 = none).
  creditsRequired: number
  subject: { id: string; name: string; credits: number | null }
}

export function fetchPlanSubjects(planId: string): Promise<PlanSubject[]> {
  return apiGet<PlanSubject[]>(`/plans/${encodeURIComponent(planId)}/subjects`)
}
