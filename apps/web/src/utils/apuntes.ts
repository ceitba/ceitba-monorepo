import type { TFunction } from 'i18next'
import { ApiError } from '../api/client'
import type { ApunteAuthor } from '../api/drive'

// Display helpers for the Apuntes (Drive notes) pages.

// Date-only values ("2026-10-02", or midnight UTC like generatedAt's
// "2026-10-02T00:00:00Z") are calendar dates, not instants: format them in
// UTC so they don't show the previous day in Argentina (UTC-3).
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}(?:T00:00(?::00(?:\.0+)?)?(?:Z|[+-]00:?00))?$/

export function formatDate(iso: string | null | undefined, lang: string): string {
  if (!iso) return '—'
  const dateOnly = DATE_ONLY.test(iso)
  const d = new Date(dateOnly ? `${iso.slice(0, 10)}T00:00:00Z` : iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(lang, {
    day: 'numeric', month: 'short', year: 'numeric',
    ...(dateOnly ? { timeZone: 'UTC' } : {}),
  })
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

// Community archive items ("Comunidad") have no student owner. The flag can
// be on the item or on its author.
export function isCommunity(
  item: { community?: boolean; author?: Pick<ApunteAuthor, 'community'> | null } | null | undefined,
): boolean {
  return !!(item?.community || item?.author?.community)
}

// "Comunidad · archivo 2019", or "Comunidad" without a year.
export function communityLabel(year: number | null | undefined, t: TFunction): string {
  return year != null
    ? t('apuntes.community.labelYear', { year })
    : t('apuntes.community.label')
}

// Display name for a student author ("Un/a estudiante" when anonymous).
// Community authors render with CommunityBadge instead; this falls back to
// the community label for plain-text contexts (aria labels).
export function authorName(author: ApunteAuthor | null | undefined, t: TFunction): string {
  if (author?.community) return t('apuntes.community.label')
  return author?.anonymous || !author?.name ? t('apuntes.anonymousAuthor') : author.name
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
