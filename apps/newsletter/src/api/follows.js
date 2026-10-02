import { apiGet, apiSend } from './client'

export async function fetchMyFollows() {
  return apiGet('/me/follows')
}

export async function followOrganization(slug) {
  return apiSend('POST', `/me/follows/${encodeURIComponent(slug)}`)
}

export async function unfollowOrganization(slug) {
  await apiSend('DELETE', `/me/follows/${encodeURIComponent(slug)}`)
}

export async function fetchOrganizationFollowers(slug) {
  return apiGet(`/organizations/${encodeURIComponent(slug)}/followers`)
}
