import { apiGet, apiSend } from './client'

export interface CareerWithPlans {
  id: string
  name: string
  plans: { id: string; name: string }[]
}

export interface MeProfile {
  careerId: string | null
  plan: string | null
  fileNumber: number | null
}

// /v1/careers/plans returns a Map<id, CareerResponse> on the wire. The
// SPA only needs the array of careers each with its plans, so flatten.
interface CareerResponseRaw {
  id: string
  name: string
  plans?: { id: string; name: string }[]
}

export async function fetchCareersWithPlans(): Promise<CareerWithPlans[]> {
  const map = await apiGet<Record<string, CareerResponseRaw>>('/careers/plans')
  return Object.values(map)
    .map((c) => ({ id: c.id, name: c.name, plans: c.plans ?? [] }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function fetchMyProfile(): Promise<MeProfile> {
  return apiGet('/me/profile')
}

export function patchMyProfile(payload: { careerId?: string | null; plan?: string | null }): Promise<MeProfile> {
  // Server treats `""` as "clear" and missing as "leave alone"; null from the
  // SPA gets turned into "" so the user can explicitly unset.
  return apiSend('PATCH', '/me/profile', {
    careerId: payload.careerId === undefined ? undefined : (payload.careerId ?? ''),
    plan:     payload.plan === undefined     ? undefined : (payload.plan ?? ''),
  })
}
