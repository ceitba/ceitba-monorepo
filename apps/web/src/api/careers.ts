import { apiGet, apiSend } from './client'

// Careers and their plans for the /manage editor (STAFF writes). Ids are
// fixed once created: users, schedules and the ITBA sync reference them.

export interface Career {
  id: string
  name: string
}

export interface Plan {
  id: string
  careerId: string
  // null for plans seeded without one (the id doubles as the name).
  name: string | null
}

export interface CareerWithPlanDetails extends Career {
  plans: Plan[]
}

export async function fetchCareersWithPlanDetails(): Promise<CareerWithPlanDetails[]> {
  const careers = await apiGet<Career[]>('/careers')
  const plans = await Promise.all(careers.map((c) => apiGet<Plan[]>(`/careers/${encodeURIComponent(c.id)}/plans`)))
  return careers.map((c, i) => ({ id: c.id, name: c.name, plans: plans[i] ?? [] }))
}

export function createCareer(id: string, name: string): Promise<Career> {
  return apiSend('POST', '/careers', { id, name })
}

export function renameCareer(id: string, name: string): Promise<Career> {
  return apiSend('PUT', `/careers/${encodeURIComponent(id)}`, { name })
}

// The plan id must be spelled exactly as ITBA's careerPlans spells it, or the
// sync finds no subjects for it. An empty name falls back to the id.
export function addPlan(careerId: string, id: string, name: string | null): Promise<Plan> {
  return apiSend('POST', `/careers/${encodeURIComponent(careerId)}/plans`, { id, name })
}

export function renamePlan(careerId: string, planId: string, name: string): Promise<Plan> {
  return apiSend('PUT', `/careers/${encodeURIComponent(careerId)}/plans/${encodeURIComponent(planId)}`, { name })
}
