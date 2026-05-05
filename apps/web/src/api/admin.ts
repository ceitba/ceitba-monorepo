import { apiGet, apiSend } from './client'

// Admin/staff API surface for the /manage UI.

export interface AdminUser {
  id: string
  email: string
  name: string | null
  file_number: number | null
  career_id: string | null
  plan: string | null
  avatarUrl: string | null
  isStaff: boolean
  organizations: { slug: string; role: string }[]
}

export interface OrganizationSummary {
  slug: string
  name: string
}

export interface StaffGrant {
  userId: string
  email: string
  name: string | null
  branch: string
  role: string
  start: string
  end: string
}

export function fetchUsers(): Promise<AdminUser[]> {
  return apiGet('/users')
}

export function fetchOrganizations(): Promise<OrganizationSummary[]> {
  // /v1/organizations returns { data: [...] }; flatten it for the picker.
  return apiGet<{ data: OrganizationSummary[] }>('/organizations').then((r) => r.data)
}

export function fetchActiveStaffGrants(): Promise<StaffGrant[]> {
  return apiGet('/staff')
}

export function assignStaff(payload: {
  email: string
  branch: string
  role: string
  start: string
  end: string
}): Promise<StaffGrant> {
  return apiSend('POST', '/staff', payload)
}

export function revokeStaff(userId: string): Promise<void> {
  return apiSend('DELETE', `/staff/${userId}`)
}

export function addUserOrganization(userId: string, slug: string, role: string): Promise<{ slug: string; role: string }> {
  return apiSend('POST', `/users/${userId}/organizations`, { slug, role })
}

export function removeUserOrganization(userId: string, slug: string): Promise<void> {
  return apiSend('DELETE', `/users/${userId}/organizations/${slug}`)
}
