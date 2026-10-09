import { apiGet, apiSend } from '@/api/client'
import type {
  InviteResult, MembershipRole, Organization, OrganizationInput, OrganizationList, OrgAnalytics, OrgMembers, OrgMember,
} from '../types'

// GET /organizations answers { data: [...] } (OrganizationController.list).
export async function fetchOrganizations(): Promise<OrganizationList> {
  return apiGet<OrganizationList>('/organizations')
}

export async function fetchOrganizationBySlug(slug: string): Promise<Organization> {
  return apiGet<Organization>(`/organizations/${encodeURIComponent(slug)}`)
}

export async function createOrganization(data: OrganizationInput): Promise<Organization> {
  return apiSend<Organization>('POST', '/organizations', data)
}

export async function updateOrganization(slug: string, data: OrganizationInput): Promise<Organization> {
  return apiSend<Organization>('PATCH', `/organizations/${encodeURIComponent(slug)}`, data)
}

export async function deleteOrganization(slug: string): Promise<void> {
  await apiSend<void>('DELETE', `/organizations/${encodeURIComponent(slug)}`)
}

// ── Members (org admins and STAFF; docs/ORGANIZATIONS.md) ───────────────────

const membersPath = (slug: string) => `/organizations/${encodeURIComponent(slug)}/members`

export async function fetchOrgMembers(slug: string): Promise<OrgMembers> {
  return apiGet<OrgMembers>(membersPath(slug))
}

// Existing users join now; other emails stay pending until their first login.
export async function inviteOrgMembers(slug: string, emails: string[], role: MembershipRole): Promise<InviteResult> {
  return apiSend<InviteResult>('POST', `${membersPath(slug)}/invites`, { emails, role })
}

export async function revokeOrgInvite(slug: string, email: string): Promise<void> {
  await apiSend<void>('DELETE', `${membersPath(slug)}/invites?email=${encodeURIComponent(email)}`)
}

export interface OrgMemberPatch {
  role?: MembershipRole
  title?: string
  showOnPortal?: boolean
}

export async function updateOrgMember(slug: string, userId: string, patch: OrgMemberPatch): Promise<OrgMember> {
  return apiSend<OrgMember>('PATCH', `${membersPath(slug)}/${encodeURIComponent(userId)}`, patch)
}

export async function removeOrgMember(slug: string, userId: string): Promise<void> {
  await apiSend<void>('DELETE', `${membersPath(slug)}/${encodeURIComponent(userId)}`)
}

// The calling admin makes `userId` admin and steps down to member.
export async function transferOrgAdmin(slug: string, userId: string): Promise<void> {
  await apiSend<void>('POST', `${membersPath(slug)}/${encodeURIComponent(userId)}/transfer-admin`)
}

export async function leaveOrganization(slug: string): Promise<void> {
  await apiSend<void>('DELETE', `${membersPath(slug)}/me`)
}

// Members only: views, followers and push reach over the last `days` days.
export async function fetchOrgAnalytics(slug: string, days: number): Promise<OrgAnalytics> {
  return apiGet<OrgAnalytics>(`/organizations/${encodeURIComponent(slug)}/analytics?days=${days}`)
}
