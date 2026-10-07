import type { BadgeTone } from '@/components/ui'

// One status → tone map for every newsletter admin badge (articles list,
// article editor, digests). Labels are translated at the call site.
const STATUS_TONE: Record<string, BadgeTone> = {
  draft:             'neutral',
  pending_review:    'warning',
  published:         'success',
  sent:              'success',
  changes_requested: 'info',
  scheduled:         'info',
  sending:           'info',
  rejected:          'danger',
  cancelled:         'danger',
}

export function statusTone(status: string | null | undefined): BadgeTone {
  return STATUS_TONE[status ?? ''] ?? 'neutral'
}
