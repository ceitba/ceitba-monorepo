import { useTranslation } from 'react-i18next'
import { communityLabel } from '../../utils/apuntes'

// Marks material from a community archive ("Comunidad · archivo 2019").
// A label, not a person: small mono caps, no link, never a profile.
export default function CommunityBadge({ year, className = '' }: {
  year?: number | null
  className?: string
}) {
  const { t } = useTranslation()
  return (
    <span
      title={t('apuntes.community.hint')}
      className={`inline-flex items-center whitespace-nowrap px-1.5 rounded-sm border border-border dark:border-night-border bg-page-bg dark:bg-night-bg font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted ${className}`}
    >
      {communityLabel(year, t)}
    </span>
  )
}
