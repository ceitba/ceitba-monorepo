import { apiGet } from '@/api/client'
import type { AnalyticsSummary } from '../types'

export async function fetchAnalyticsSummary(days: number = 30): Promise<AnalyticsSummary> {
  const params = days ? `?days=${days}` : ''
  return apiGet<AnalyticsSummary>(`/analytics/summary${params}`)
}
