import { apiGet, apiSend } from './client'

// "La semana en ITBA", the weekly digest email (CEITBA-API `web/digest`):
// the signed-in user's own subscription, toggled from the account menu.
export interface DigestSubscription {
  enabled: boolean
}

export function fetchDigestSubscription(): Promise<DigestSubscription> {
  return apiGet('/digests/subscription')
}

export function setDigestSubscription(enabled: boolean): Promise<DigestSubscription | undefined> {
  return apiSend('PUT', '/digests/subscription', { enabled })
}
