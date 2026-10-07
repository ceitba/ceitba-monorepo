import { useTranslation } from 'react-i18next'
import type { Publication, SourceStatus } from '../../api/drive'
import { Badge, type BadgeTone } from '../ui'

const SOURCE_TONES: Record<SourceStatus, BadgeTone> = {
  PENDING_REVIEW: 'warning',
  ACTIVE:         'success',
  BLOCKED:        'danger',
  REVOKED:        'danger',
  DISCONNECTED:   'neutral',
  ERROR:          'danger',
}

const PUBLICATION_TONES: Record<Publication, BadgeTone> = {
  PRIVATE:          'neutral',
  NEEDS_REVIEW:     'warning',
  PUBLISHED:        'success',
  HIDDEN_REPORTED:  'danger',
  REMOVED_BY_STAFF: 'danger',
  REMOVED:          'neutral',
}

// Unknown enum values (a newer API) fall back to a neutral generic label
// rather than printing the raw value.
export function SourceStatusBadge({ status }: { status: SourceStatus }) {
  const { t } = useTranslation()
  return (
    <Badge tone={SOURCE_TONES[status] ?? 'neutral'}>
      {t(`apuntes.sourceStatus.${status}`, { defaultValue: t('apuntes.sourceStatus.unknown') })}
    </Badge>
  )
}

export function PublicationBadge({ publication }: { publication: Publication }) {
  const { t } = useTranslation()
  return (
    <Badge tone={PUBLICATION_TONES[publication] ?? 'neutral'}>
      {t(`apuntes.publication.${publication}`, { defaultValue: t('apuntes.publication.unknown') })}
    </Badge>
  )
}

// What it means is spelled out once in a legend under the tree
// (apuntes.tree.notMineHint), not in a hover-only title.
export function NotMineBadge() {
  const { t } = useTranslation()
  return <Badge tone="info">{t('apuntes.tree.notMine')}</Badge>
}
