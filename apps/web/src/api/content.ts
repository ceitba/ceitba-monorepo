import { apiGet, apiSend } from './client'

export interface DepartmentEntry {
  slug: string
  colorVar: string
  displayOrder: number
}

export interface BenefitEntry {
  slug: string
  colorVar: string
  displayOrder: number
  linkUrl: string | null
  contactEmail: string | null
  highlightsEs: string[]
  highlightsEn: string[]
}

export interface StaffMember {
  id: string
  year: number
  departmentSlug: string
  displayOrder: number
  name: string
  roleEs: string
  roleEn: string
  photoUrl: string | null
  linkedinUrl: string | null
  email: string | null
}

export function fetchDepartments(): Promise<DepartmentEntry[]> {
  return apiGet('/staff-departments')
}

export function fetchBenefits(): Promise<BenefitEntry[]> {
  return apiGet('/benefits')
}

export function fetchStaffYears(): Promise<number[]> {
  return apiGet('/staff-members/years')
}

export function fetchStaffMembers(year: number): Promise<StaffMember[]> {
  return apiGet(`/staff-members?year=${year}`)
}

// Staff-only mutations used by /manage. Errors bubble up via ApiError so the
// UI can render server messages.
export function createStaffMember(payload: Omit<StaffMember, 'id'>): Promise<StaffMember> {
  return apiSend('POST', '/staff-members', payload)
}

export function updateStaffMember(id: string, payload: Omit<StaffMember, 'id'>): Promise<StaffMember> {
  return apiSend('PUT', `/staff-members/${id}`, payload)
}

export function deleteStaffMember(id: string): Promise<void> {
  return apiSend('DELETE', `/staff-members/${id}`)
}

export function updateBenefit(slug: string, payload: Omit<BenefitEntry, 'slug'>): Promise<BenefitEntry> {
  return apiSend('PUT', `/benefits/${slug}`, payload)
}
