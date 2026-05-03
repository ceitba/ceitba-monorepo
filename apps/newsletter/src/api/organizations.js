import { apiRequest, ApiError } from './client'

export async function fetchOrganizations() {
  const res = await apiRequest('GET', '/organizations')
  if (!res || !res.ok) throw new ApiError('Failed to fetch organizations', res?.status)
  return res.json()
}

export async function fetchOrganizationBySlug(slug) {
  const res = await apiRequest('GET', `/organizations/${slug}`)
  if (!res) throw new ApiError('Request failed', 0)
  if (res.status === 404) throw new ApiError(`Organization "${slug}" not found`, 404, 'NOT_FOUND')
  if (!res.ok) throw new ApiError('Failed to fetch organization', res.status)
  return res.json()
}

export async function createOrganization(data) {
  const res = await apiRequest('POST', '/organizations', data)
  if (!res || !res.ok) throw new ApiError('Failed to create organization', res?.status)
  return res.json()
}

export async function updateOrganization(slug, data) {
  const res = await apiRequest('PATCH', `/organizations/${slug}`, data)
  if (!res || !res.ok) throw new ApiError('Failed to update organization', res?.status)
  return res.json()
}

export async function deleteOrganization(slug) {
  const res = await apiRequest('DELETE', `/organizations/${slug}`)
  if (res && !res.ok && res.status !== 204) throw new ApiError('Failed to delete organization', res.status)
}
