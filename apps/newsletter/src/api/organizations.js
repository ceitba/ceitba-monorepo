import { apiGet, apiSend } from './client'

export async function fetchOrganizations() {
  return apiGet('/organizations')
}

export async function fetchOrganizationBySlug(slug) {
  return apiGet(`/organizations/${encodeURIComponent(slug)}`)
}

export async function createOrganization(data) {
  return apiSend('POST', '/organizations', data)
}

export async function updateOrganization(slug, data) {
  return apiSend('PATCH', `/organizations/${encodeURIComponent(slug)}`, data)
}

export async function deleteOrganization(slug) {
  await apiSend('DELETE', `/organizations/${encodeURIComponent(slug)}`)
}
