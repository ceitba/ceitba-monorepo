import { useTranslation } from 'react-i18next'

const STYLES = {
  draft:     'bg-accent-50 text-accent-700',
  sending:   'bg-primary-50 text-primary',
  sent:      'bg-emerald-50 text-emerald-700',
  cancelled: 'bg-border text-ink-secondary',
}

export default function DigestStatusBadge({ status }) {
  const { t } = useTranslation()
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm font-mono text-label uppercase tracking-widest ${STYLES[status] ?? STYLES.cancelled}`}>
      {status === 'sending' && <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" aria-hidden="true" />}
      {t(`admin.digests.status.${status}`, { defaultValue: status })}
    </span>
  )
}
