import { apiRequest, ApiError } from './client'

export async function fetchMyFollows() {
  const res = await apiRequest('GET', '/me/follows')
  if (!res || !res.ok) throw new ApiError('Failed to fetch follows', res?.status)
  return res.json()
}

export async function followOrganization(slug) {
  const res = await apiRequest('POST', `/me/follows/${slug}`)
  if (!res || !res.ok) throw new ApiError('Failed to follow', res?.status)
  return res.json()
}

export async function unfollowOrganization(slug) {
  const res = await apiRequest('DELETE', `/me/follows/${slug}`)
  if (!res) throw new ApiError('Failed to unfollow', 0)
  if (res.status !== 204 && !res.ok) throw new ApiError('Failed to unfollow', res.status)
}
