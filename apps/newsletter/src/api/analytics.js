import { apiGet } from './client'

export async function fetchAnalyticsSummary(days = 30) {
  const params = days ? `?days=${days}` : ''
  return apiGet(`/analytics/summary${params}`)
}
