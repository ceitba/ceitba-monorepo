import { apiGet, apiSend } from '@/api/client'
import type { OrgAnnouncement, OrgMailStatus } from '../types'

// Organizations' emails to their followers (OrgMailController). The org's
// admins and staff; errors carry codes like OrgMailNotConnected,
// OrgMailWeeklyLimit, OrgMailNoRecipients, MailDisabled (ApiError.code).

const orgPath = (slug: string) => `/organizations/${encodeURIComponent(slug)}`

export async function fetchOrgMailStatus(slug: string): Promise<OrgMailStatus> {
  return apiGet<OrgMailStatus>(`${orgPath(slug)}/mail`)
}

// Google's consent URL; Google sends the browser back to
// /newsletter/mine/org/{slug}/mail?mail=connected | ?mail=error&reason=<code>.
export async function connectOrgMail(slug: string): Promise<{ authorizationUrl: string }> {
  return apiSend<{ authorizationUrl: string }>('POST', `${orgPath(slug)}/mail/connect`)
}

export async function disconnectOrgMail(slug: string): Promise<void> {
  await apiSend<void>('DELETE', `${orgPath(slug)}/mail`)
}

export async function fetchAnnouncements(slug: string): Promise<OrgAnnouncement[]> {
  return apiGet<OrgAnnouncement[]>(`${orgPath(slug)}/announcements`)
}

export async function createAnnouncement(slug: string, subject: string, body: string): Promise<OrgAnnouncement> {
  return apiSend<OrgAnnouncement>('POST', `${orgPath(slug)}/announcements`, { subject, body })
}

export async function updateAnnouncement(slug: string, id: number, subject: string, body: string): Promise<OrgAnnouncement> {
  return apiSend<OrgAnnouncement>('PATCH', `${orgPath(slug)}/announcements/${id}`, { subject, body })
}

export async function deleteAnnouncement(slug: string, id: number): Promise<void> {
  await apiSend<void>('DELETE', `${orgPath(slug)}/announcements/${id}`)
}

// To the caller only, as "[Prueba] …".
export async function sendAnnouncementTest(slug: string, id: number): Promise<void> {
  await apiSend<void>('POST', `${orgPath(slug)}/announcements/${id}/test`)
}

export async function sendAnnouncement(slug: string, id: number): Promise<OrgAnnouncement> {
  return apiSend<OrgAnnouncement>('POST', `${orgPath(slug)}/announcements/${id}/send`)
}

// Public: the token of the email's unsubscribe link. Resolves to the org's name.
export async function unsubscribeFromOrgMail(token: string): Promise<string> {
  const res = await apiSend<{ organization: string }>('POST', `/org-mail/unsubscribe?token=${encodeURIComponent(token)}`)
  return res.organization
}

export async function fetchOrgMailPreference(slug: string): Promise<boolean> {
  return (await apiGet<{ enabled: boolean }>(`/me/follows/${encodeURIComponent(slug)}/mail`)).enabled
}

export async function setOrgMailPreference(slug: string, enabled: boolean): Promise<boolean> {
  return (await apiSend<{ enabled: boolean }>('PUT', `/me/follows/${encodeURIComponent(slug)}/mail`, { enabled })).enabled
}
