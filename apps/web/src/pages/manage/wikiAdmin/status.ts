import type { TFunction } from 'i18next'
import type { BadgeTone } from '@/components/ui'

// Run / eval / batch / per-subject statuses the API returns (upper-cased;
// DigitalOcean batch statuses arrive lower-case). Each maps to a Badge tone
// and a translated label under manage.wikiAi.status.<STATUS>.
const STATUS_TONES: Record<string, BadgeTone> = {
  DONE: 'success', SUCCEEDED: 'success', COMPLETED: 'success', PUBLISHED: 'success', OK: 'success',
  RUNNING: 'info', SUBMITTED: 'info', QUEUED: 'info', PENDING: 'info', IN_PROGRESS: 'info', VALIDATING: 'info',
  FINALIZING: 'info', WAITING: 'info', WAITING_BATCH: 'info', PLANNING: 'info', WRITING: 'info', CANCELLING: 'info',
  PARTIAL: 'warning', BLOCKED_BY_COST_LIMIT: 'warning', DEFERRED: 'warning', RATE_LIMITED: 'warning', EMPTY_TOOL: 'warning',
  FAILED: 'danger', ERROR: 'danger', CANCELLED: 'danger', CANCELED: 'danger', EXPIRED: 'danger',
  SKIPPED: 'neutral',
}

// Statuses we don't know yet still get a sensible tone and a generic label.
function fallback(s: string): { tone: BadgeTone; key: string } {
  if (/FAIL|ERROR|EXPIRED|CANCEL/.test(s)) return { tone: 'danger', key: 'FAILED' }
  if (/BLOCKED/.test(s)) return { tone: 'warning', key: 'BLOCKED' }
  if (/PARTIAL/.test(s)) return { tone: 'warning', key: 'PARTIAL' }
  if (/DONE|COMPLETE|SUCCE|PUBLISHED/.test(s)) return { tone: 'success', key: 'DONE' }
  if (/RUNNING|WAITING|PENDING|PROGRESS|QUEUED/.test(s)) return { tone: 'info', key: 'RUNNING' }
  return { tone: 'neutral', key: 'other' }
}

export function statusInfo(status: string | null | undefined): { tone: BadgeTone; key: string } | null {
  const s = (status ?? '').trim().toUpperCase()
  if (!s) return null
  return STATUS_TONES[s] ? { tone: STATUS_TONES[s], key: s } : fallback(s)
}

// Translated label for a status, for plain-text contexts (toasts, lists).
export function statusLabel(status: string | null | undefined, t: TFunction): string {
  const info = statusInfo(status)
  return info ? t(`manage.wikiAi.status.${info.key}`) : '—'
}
