import { apiGet, apiRequest, apiSend, ApiError, toError } from './client'

// "La semana en ITBA" — the weekly digest email (CEITBA-API `web/digest`).
// Everything here is STAFF-only except the subscription endpoints (any
// signed-in user) and unsubscribe (public, token-based).

const path = (id) => `/digests/${encodeURIComponent(id)}`

export async function fetchDigests() {
  return apiGet('/digests')
}

// weekStart must be a Monday ("YYYY-MM-DD"). 409 DIGEST_EXISTS if that week
// already has an issue, 400 INVALID_WEEK_START if it isn't a Monday.
export async function createDigest(weekStart) {
  return apiSend('POST', '/digests', { weekStart })
}

export async function fetchDigest(id) {
  return apiGet(path(id))
}

// Any of { subject, intro, excludedArticleIds, excludedEventIds, autoSendAt }.
// autoSendAt: null turns auto-send off. 409 DIGEST_NOT_EDITABLE unless draft.
export async function updateDigest(id, patch) {
  return apiSend('PATCH', path(id), patch)
}

// The preview is the rendered email (text/html), not JSON, so it can't go
// through apiGet. Every recipient gets the same email, so there is one
// version to preview.
export async function fetchDigestPreview(id) {
  let res
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

// Sends the digest to the caller only. → { sentTo }; 422 EMAIL_NOT_ALLOWED.
export async function sendDigestTest(id) {
  return apiSend('POST', `${path(id)}/test`)
}

// 202 → detail with status 'sending'; 409 if not a draft, 409 DIGEST_EMPTY
// if every article and event is excluded.
export async function sendDigestNow(id) {
  return apiSend('POST', `${path(id)}/send`)
}

export async function cancelDigest(id) {
  return apiSend('POST', `${path(id)}/cancel`)
}

// ── Subscriber side ─────────────────────────────────────────────────────────

export async function fetchDigestSubscription() {
  return apiGet('/digests/subscription')
}

export async function setDigestSubscription(enabled) {
  return apiSend('PUT', '/digests/subscription', { enabled })
}

// One-click unsubscribe from the email link. Public; 204 on success,
// 400 INVALID_TOKEN for a bad or tampered token. Idempotent.
export async function unsubscribeFromDigest(token) {
  return apiSend('POST', `/digests/unsubscribe?token=${encodeURIComponent(token)}`)
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
export async function fetchCorrectionVote(token) {
  return apiGet(`/digests/correction-vote?token=${encodeURIComponent(token)}`)
}

// vote: 'confirm' | 'reject' → { correction, previousVote }
export async function sendCorrectionVote(token, vote) {
  return apiSend('POST', '/digests/correction-vote', { token, vote })
}
