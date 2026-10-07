import { apiGet, apiSend } from '@/api/client'
import type { Follow, FollowerList } from '../types'

export async function fetchMyFollows(): Promise<Follow[]> {
  return apiGet<Follow[]>('/me/follows')
}

export async function followOrganization(slug: string): Promise<Follow> {
  return apiSend<Follow>('POST', `/me/follows/${encodeURIComponent(slug)}`)
}

export async function unfollowOrganization(slug: string): Promise<void> {
  await apiSend<void>('DELETE', `/me/follows/${encodeURIComponent(slug)}`)
}

export async function fetchOrganizationFollowers(slug: string): Promise<FollowerList> {
  return apiGet<FollowerList>(`/organizations/${encodeURIComponent(slug)}/followers`)
}
