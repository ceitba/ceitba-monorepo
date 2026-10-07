import { apiGet, apiSend } from '@/api/client'
import type { Organization, OrganizationInput } from '../types'

export async function fetchOrganizations(): Promise<Organization[]> {
  return apiGet<Organization[]>('/organizations')
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
