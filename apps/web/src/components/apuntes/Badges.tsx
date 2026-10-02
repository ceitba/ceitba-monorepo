import { useTranslation } from 'react-i18next'
import type { Publication, SourceStatus } from '../../api/drive'

const BASE = 'inline-flex items-center whitespace-nowrap px-2 py-0.5 rounded-sm font-mono text-label uppercase tracking-widest'

const SOURCE_STYLES: Record<SourceStatus, string> = {
  PENDING_REVIEW: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  ACTIVE:         'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  BLOCKED:        'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  REVOKED:        'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  DISCONNECTED:   'bg-border text-ink-secondary dark:bg-night-border dark:text-night-muted',
  ERROR:          'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
}

const PUBLICATION_STYLES: Record<Publication, string> = {
  PRIVATE:          'bg-border text-ink-secondary dark:bg-night-border dark:text-night-muted',
  NEEDS_REVIEW:     'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  PUBLISHED:        'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  HIDDEN_REPORTED:  'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  REMOVED_BY_STAFF: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  REMOVED:          'bg-border text-ink-secondary dark:bg-night-border dark:text-night-muted',
}

export function SourceStatusBadge({ status }: { status: SourceStatus }) {
  const { t } = useTranslation()
  return (
    <span className={`${BASE} ${SOURCE_STYLES[status] ?? SOURCE_STYLES.DISCONNECTED}`}>
      {t(`apuntes.sourceStatus.${status}`, { defaultValue: status })}
    </span>
  )
}

export function PublicationBadge({ publication }: { publication: Publication }) {
  const { t } = useTranslation()
  return (
    <span className={`${BASE} ${PUBLICATION_STYLES[publication] ?? PUBLICATION_STYLES.PRIVATE}`}>
      {t(`apuntes.publication.${publication}`, { defaultValue: publication })}
    </span>
  )
}

export function NotMineBadge() {
  const { t } = useTranslation()
  return (
    <span
      title={t('apuntes.tree.notMineHint')}
      className={`${BASE} bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300`}
    >
      {t('apuntes.tree.notMine')}
    </span>
  )
}
