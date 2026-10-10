import { apiGet, apiRequest, apiSend, ApiError, toError } from '@/api/client'
import type {
  CorrectionVote,
  CorrectionVoteResult,
  CorrectionVoteView,
  DigestDetail,
  DigestPatch,
  DigestQuota,
  DigestStats,
  DigestSummary,
  DigestTestSendResult,
  IsoDate,
  MailConnectResponse,
  SenderAccount,
} from '../types'

// "La semana en ITBA" — the weekly digest email (CEITBA-API `web/digest`).
// Everything here is STAFF-only except the subscription endpoints (any
// signed-in user) and unsubscribe (public, token-based).

const path = (id: string): string => `/digests/${encodeURIComponent(id)}`

// Each item: { id, weekStart, weekEnd, subject, status, autoSendAt, sentAt,
// createdAt, counts, resumeAt, estimatedFinishAt, openRate, clickRate }.
// resumeAt/estimatedFinishAt only while 'sending' (resumeAt only when the
// sending account is paused); rates are 0..1 over delivered emails, null
// with nothing delivered.
export async function fetchDigests(): Promise<DigestSummary[]> {
  return apiGet<DigestSummary[]>('/digests')
}

// Sending quota of the account the digest goes out from (rolling 24h):
// → { account, limit, usedLast24h, remaining, pausedUntil, pauseReason
//     ('quota' | 'transport' | null), nextCapacityAt }
export async function fetchDigestQuota(): Promise<DigestQuota> {
  return apiGet<DigestQuota>('/digests/quota')
}

// Aggregate engagement (never per person):
// → { delivered, uniqueOpens, openRate, uniqueClicks, clickRate,
//     clicksByLink: [{ label, url, uniqueClicks, totalClicks }],
//     opensByHour: [{ hour, count }] }
export async function fetchDigestStats(id: string): Promise<DigestStats> {
  return apiGet<DigestStats>(`${path(id)}/stats`)
}

// weekStart must be a Monday ("YYYY-MM-DD"). 409 DIGEST_EXISTS if that week
// already has an issue, 400 INVALID_WEEK_START if it isn't a Monday.
export async function createDigest(weekStart: IsoDate): Promise<DigestDetail> {
  return apiSend<DigestDetail>('POST', '/digests', { weekStart })
}

export async function fetchDigest(id: string): Promise<DigestDetail> {
  return apiGet<DigestDetail>(path(id))
}

// Any of { subject, intro, excludedArticleIds, excludedEventIds, autoSendAt }.
// autoSendAt: null turns auto-send off. 409 DIGEST_NOT_EDITABLE unless draft.
export async function updateDigest(id: string, patch: DigestPatch): Promise<DigestDetail> {
  return apiSend<DigestDetail>('PATCH', path(id), patch)
}

// The preview is the rendered email (text/html), not JSON, so it can't go
// through apiGet. Every recipient gets the same email, so there is one
// version to preview.
export async function fetchDigestPreview(id: string): Promise<string> {
  let res: Response
  try {
    res = await apiRequest('GET', `${path(id)}/preview`, undefined, {
      headers: { Accept: 'text/html' },
    })
  } catch {
    throw new ApiError('Network error', 0, 'NETWORK_ERROR')
  }
  if (!res.ok) throw await toError(res)
  return res.text()
}

// Sends the digest to the caller only. → { sentTo }; 422 EMAIL_NOT_ALLOWED;
// 429 MAIL_QUOTA_EXHAUSTED (err.data.resumeAt) when the account's daily
// sending quota is used up — test sends count against it.
export async function sendDigestTest(id: string): Promise<DigestTestSendResult> {
  return apiSend<DigestTestSendResult>('POST', `${path(id)}/test`)
}

// 202 → detail with status 'sending'; 409 if not a draft, 409 DIGEST_EMPTY
// if every article and event is excluded.
export async function sendDigestNow(id: string): Promise<DigestDetail> {
  return apiSend<DigestDetail>('POST', `${path(id)}/send`)
}

export async function cancelDigest(id: string): Promise<DigestDetail> {
  return apiSend<DigestDetail>('POST', `${path(id)}/cancel`)
}

// 204. Any status but 'sending' (409 DIGEST_SENDING: stop it first). Removes
// the issue with its deliveries and stats for good.
export async function deleteDigest(id: string): Promise<void> {
  return apiSend<void>('DELETE', path(id))
}

// ── Subscriber side ─────────────────────────────────────────────────────────

// fetchDigestSubscription / setDigestSubscription live in
// src/api/digestSubscription.ts: the account menu (every section) uses them.

// One-click unsubscribe from the email link. Public; 204 on success,
// 400 INVALID_TOKEN for a bad or tampered token. Idempotent.
export async function unsubscribeFromDigest(token: string): Promise<void> {
  return apiSend<void>('POST', `/digests/unsubscribe?token=${encodeURIComponent(token)}`)
}

// ── "¿Es así?" schedule-correction votes from the digest ("Tu cuatrimestre") ─
// Public, authenticated by the signed per-reader token of the email link.
// GET only shows the correction (never votes: mail scanners follow links);
// the vote is a POST from a button click.
// Error codes: INVALID_TOKEN (400), TOKEN_EXPIRED (410), INVALID_VOTE (400),
// CORRECTION_NOT_FOUND (404), CORRECTION_CLOSED (409), EMAIL_NOT_ALLOWED (422).

// → { correctionId, subjectId, subjectName, commissionName, status, open,
//     proposed: [{day, from, to}], sga: [{day, from, to}], confirms, rejects,
//     myVote: 'CONFIRM' | 'REJECT' | null, expiresAt }
export async function fetchCorrectionVote(token: string): Promise<CorrectionVoteView> {
  return apiGet<CorrectionVoteView>(`/digests/correction-vote?token=${encodeURIComponent(token)}`)
}

// vote: 'confirm' | 'reject' → { correction, previousVote }
export async function sendCorrectionVote(token: string, vote: CorrectionVote): Promise<CorrectionVoteResult> {
  return apiSend<CorrectionVoteResult>('POST', '/digests/correction-vote', { token, vote })
}

// ── Sender account (Gmail OAuth) the digests go out from ────────────────────
// STAFF-only (CEITBA-API `web/mail`).

// → { authorizationUrl }. The caller must navigate the whole window there
// (window.location.assign): no fetch, no popup. Google then sends the browser
// back to /newsletter/admin/digests?mail=connected | ?mail=error&reason=<code>,
// which NewsletterApp forwards (query included) to /manage/newsletter/digests.
export async function connectCeitbaSender(): Promise<MailConnectResponse> {
  return apiSend<MailConnectResponse>('POST', '/mail/accounts/ceitba/connect')
}

// → [{ id, email, ownerType: 'ceitba'|'organization', ownerRef,
//      status: 'connected'|'broken'|'revoked', connectedAt, lastError, lastUsedAt }]
export async function listSenderAccounts(): Promise<SenderAccount[]> {
  return apiGet<SenderAccount[]>('/mail/accounts')
}

// 204. Revokes the account at Google too.
export async function disconnectSenderAccount(id: number | string): Promise<void> {
  return apiSend<void>('DELETE', `/mail/accounts/${encodeURIComponent(id)}`)
}
