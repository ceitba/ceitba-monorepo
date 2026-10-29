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

// Credits the plan asks for in each elective group, placed in a year and
// term. `section` is the name of the section that lists the group's subjects
// (PlanSubject.section). Synced from ITBA; [] when the plan has none.
export interface PlanRequirement {
  section: string
  credits: number
  year: number
  semester: number
}

export function fetchPlanRequirements(planId: string): Promise<PlanRequirement[]> {
  return apiGet<PlanRequirement[]>(`/plans/${encodeURIComponent(planId)}/requirements`)
}
