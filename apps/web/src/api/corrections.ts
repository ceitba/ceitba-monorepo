import { apiGet, apiSend } from './client'

// STAFF moderation of student-suggested schedule corrections
// (CEITBA-API /v1/staff/schedule-corrections). Corrections normally apply on
// their own by student votes; these endpoints are the staff override.
// Corrections are anonymous: no suggester/voter identity, not even for staff.

export type CorrectionStatus = 'PENDING' | 'APPLIED' | 'REJECTED' | 'RESOLVED' | 'SUPERSEDED'

export type CorrectionDay =
  | 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY'

// Same shape as the existing `schedule` entries (snake_case slot fields).
// time_* are "HH:mm:ss"; classroom/building are empty for added slots.
export interface CorrectionSlot {
  day: CorrectionDay
  time_from: string
  time_to: string
  classroom?: string | null
  building?: string | null
}

export interface StaffCorrection {
  id: string
  commissionId: string
  status: CorrectionStatus
  schedule: CorrectionSlot[]
  confirms: number
  rejects: number
  createdAt: string
  subjectId: string
  subjectName: string
  commissionName: string
  sgaSchedule: CorrectionSlot[]
  appliedAt: string | null
  reviewedAt: string | null
  // true when the current status was set by a staff override rather than votes.
  reviewedByStaff: boolean
}

export interface StaffCorrectionsPage {
  data: StaffCorrection[]
  meta: { total: number; page: number; limit: number }
}

export interface FetchStaffCorrectionsParams {
  status: CorrectionStatus
  page?: number
  limit?: number
}

export function fetchStaffCorrections(params: FetchStaffCorrectionsParams): Promise<StaffCorrectionsPage> {
  const qs = new URLSearchParams({ status: params.status })
  if (params.page)  qs.set('page',  String(params.page))
  if (params.limit) qs.set('limit', String(params.limit))
  return apiGet<StaffCorrectionsPage>(`/staff/schedule-corrections?${qs}`)
}

// PENDING → APPLIED immediately (supersedes the commission's current APPLIED one).
export function applyCorrection(id: string): Promise<StaffCorrection> {
  return apiSend('POST', `/staff/schedule-corrections/${encodeURIComponent(id)}/apply`)
}

// PENDING/APPLIED → REJECTED. Rejecting an APPLIED correction is how staff
// revert it; a rejected correction never re-applies by votes.
export function rejectCorrection(id: string): Promise<StaffCorrection> {
  return apiSend('POST', `/staff/schedule-corrections/${encodeURIComponent(id)}/reject`)
}
