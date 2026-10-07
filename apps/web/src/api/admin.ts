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

// Mirrors CEITBA-API web/staff/dto/StaffResponse: `userId` is serialized as
// `user_id` (@JsonProperty); start/end are ISO-8601 offset date-times.
export interface StaffGrant {
  user_id: string
  email: string
  name: string | null
  branch: string
  role: string
  start: string
  end: string
}

export interface UsersPage {
  data: AdminUser[]
  meta: { total: number; page: number; limit: number }
}

export interface FetchUsersParams {
  page?: number
  limit?: number
  q?: string
  sort?: 'newest' | 'oldest'
  organization?: string
}

export function fetchUsers(params: FetchUsersParams = {}): Promise<UsersPage> {
  const qs = new URLSearchParams()
  if (params.page)         qs.set('page',         String(params.page))
  if (params.limit)        qs.set('limit',        String(params.limit))
  if (params.q)            qs.set('q',            params.q)
  if (params.sort)         qs.set('sort',         params.sort)
  if (params.organization) qs.set('organization', params.organization)
  const suffix = qs.toString() ? `?${qs}` : ''
  return apiGet<UsersPage>(`/users${suffix}`)
}

export function fetchOrganizations(): Promise<OrganizationSummary[]> {
  // /v1/organizations returns { data: [...] }; flatten it for the picker.
  return apiGet<{ data: OrganizationSummary[] }>('/organizations').then((r) => r.data)
}

// Full org as returned by GET/POST /v1/organizations (web/news OrganizationResponse).
// `color` is a named scheme (blue | amber | green | violet) that ITBA News maps
// to its hero background; logo/background are set later by the org's admins.
export interface Organization {
  slug: string
  name: string
  fullName: string
  description: string | null
  category: string | null
  color: string | null
  followerCount: number
  logoUrl: string | null
  backgroundUrl: string | null
}

export interface CreateOrganizationPayload {
  slug: string
  name: string
  fullName: string
  description?: string
  category?: string
  color?: string
}

export function listOrganizations(): Promise<Organization[]> {
  return apiGet<{ data: Organization[] }>('/organizations').then((r) => r.data)
}

// STAFF-only. 409 ResourceAlreadyExists if the slug is taken, 400
// ValidationError ("field: message; …") if a field is rejected.
export function createOrganization(payload: CreateOrganizationPayload): Promise<Organization> {
  return apiSend('POST', '/organizations', payload)
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

export type MembershipRole = 'member' | 'admin'

// 404 if the user isn't in that org (use addUserOrganization first).
export function updateUserOrganizationRole(userId: string, slug: string, role: MembershipRole): Promise<{ slug: string; role: string }> {
  return apiSend('PATCH', `/users/${userId}/organizations/${slug}`, { role })
}

export function removeUserOrganization(userId: string, slug: string): Promise<void> {
  return apiSend('DELETE', `/users/${userId}/organizations/${slug}`)
}
