import { apiRequest, ApiError } from './client'

export async function fetchAnalyticsSummary(days = 30) {
  const params = days ? `?days=${days}` : ''
  const res = await apiRequest('GET', `/analytics/summary${params}`)
  if (!res || !res.ok) throw new ApiError('Failed to fetch analytics', res?.status ?? 500)
  return res.json()
}
