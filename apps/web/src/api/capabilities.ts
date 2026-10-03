import { apiGet, apiSend } from './client'

// STAFF API for feature capabilities (CEITBA-API /v1/staff/capabilities).
// A capability is enabled for a user if it's enabled for everyone, granted to
// their email, or granted to an organization they belong to.

export interface Capability {
  key: string
  label: string
  description: string
  enabledForAll: boolean
  userGrantCount: number
  orgGrantCount: number
}

export interface CapabilityUserGrant {
  email: string
  // null until that person signs in for the first time.
  userId: string | null
  name: string | null
  grantedAt: string
  grantedByName: string | null
}

export interface CapabilityOrgGrant {
  slug: string
  name: string
  memberCount: number
  grantedAt: string
  grantedByName: string | null
}

export interface CapabilityGrants {
  users: CapabilityUserGrant[]
  orgs: CapabilityOrgGrant[]
}

const base = (key: string) => `/staff/capabilities/${encodeURIComponent(key)}`

export function listCapabilities(): Promise<Capability[]> {
  return apiGet('/staff/capabilities')
}

export function setCapabilityEnabledForAll(key: string, enabledForAll: boolean): Promise<Capability> {
  return apiSend('PUT', base(key), { enabledForAll })
}

export function getCapabilityGrants(key: string): Promise<CapabilityGrants> {
  return apiGet(`${base(key)}/grants`)
}

export function grantCapabilityToUsers(key: string, emails: string[]): Promise<CapabilityGrants> {
  return apiSend('POST', `${base(key)}/users`, { emails })
}

export function revokeCapabilityFromUser(key: string, email: string): Promise<void> {
  return apiSend('DELETE', `${base(key)}/users/${encodeURIComponent(email)}`)
}

export function grantCapabilityToOrg(key: string, slug: string): Promise<unknown> {
  return apiSend('PUT', `${base(key)}/orgs/${encodeURIComponent(slug)}`)
}

export function revokeCapabilityFromOrg(key: string, slug: string): Promise<void> {
  return apiSend('DELETE', `${base(key)}/orgs/${encodeURIComponent(slug)}`)
}
