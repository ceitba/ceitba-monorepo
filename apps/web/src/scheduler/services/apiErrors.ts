import { ApiError } from '@/api/client'

// Known API failures mapped to "apiErrors.*" keys of the scheduler locale.
// Anything else falls back to the caller's generic copy; the raw server
// message is only logged, never shown.
type ApiErrorKey = 'offline' | 'signInRequired' | 'notFound'

function apiErrorKey(err: unknown): ApiErrorKey | null {
  if (!(err instanceof ApiError)) return null
  if (err.status === 0) return 'offline'
  if (err.status === 401) return 'signInRequired'
  if (err.status === 404) return 'notFound'
  return null
}

// i18n key for a failed request: the specific reason when known, otherwise
// `fallbackKey` (e.g. "saved.errors.deleteFailed").
export function errorMessageKey(err: unknown, fallbackKey: string): string {
  console.error(err)
  const key = apiErrorKey(err)
  return key ? `apiErrors.${key}` : fallbackKey
}
