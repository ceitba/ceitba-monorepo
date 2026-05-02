import { useTranslation } from 'react-i18next'

const CATEGORY_STYLES = {
  Académico:   'bg-primary-100 text-primary-700',
  Academic:    'bg-primary-100 text-primary-700',
  Campus:      'bg-accent-50 text-accent-600',
  Cultura:     'bg-emerald-50 text-emerald-700',
  Culture:     'bg-emerald-50 text-emerald-700',
  Tecnología:  'bg-violet-50 text-violet-700',
  Tech:        'bg-violet-50 text-violet-700',
  Deportes:    'bg-orange-50 text-orange-700',
  Sports:      'bg-orange-50 text-orange-700',
  General:     'bg-ink-secondary/10 text-ink-secondary',
}

export default function CategoryBadge({ category, className = '' }) {
  const { t } = useTranslation()
  const style = CATEGORY_STYLES[category] ?? 'bg-border text-ink-secondary'
  const label = t(`categories.${category}`, { defaultValue: category })

  return (
    <span
      className={[
        'font-mono text-label uppercase tracking-widest px-2 py-0.5 rounded-sm',
        style,
        className,
      ].join(' ')}
    >
      {label}
    </span>
  )
}
