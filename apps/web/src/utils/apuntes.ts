import type { TFunction } from 'i18next'
import { ApiError } from '../api/client'

// Display helpers for the Apuntes (Drive notes) pages.

export function formatDate(iso: string | null | undefined, lang: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatDateTime(iso: string | null | undefined, lang: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function formatSize(bytes: number | null | undefined): string {
  if (bytes == null || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++ }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`
}

// Friendly message for an API failure: Drive error codes have their own copy
// under apuntes.errors.<CODE>; anything else falls back to the server message.
export function apuntesErrorMessage(e: unknown, t: TFunction): string {
  if (e instanceof ApiError) {
    return t(`apuntes.errors.${e.code}`, { defaultValue: e.message })
  }
  if (e instanceof Error && e.message) return e.message
  return t('errors.somethingWrong')
}

// Only same-app paths are valid post-login destinations (no open redirects).
export function isSafeReturnPath(path: string | null | undefined): path is string {
  return !!path && path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\')
}
