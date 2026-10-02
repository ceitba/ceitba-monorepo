import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

const CATEGORY_STYLES = {
  Académico:      'bg-primary-100 text-primary-700',
  Campus:         'bg-accent-50 text-accent-600',
  Cultura:        'bg-emerald-50 text-emerald-700',
  Tecnología:     'bg-violet-50 text-violet-700',
  Deportes:       'bg-orange-50 text-orange-700',
  Organizaciones: 'bg-sky-50 text-sky-700',
  General:        'bg-ink-secondary/10 text-ink-secondary',
}

export function useCategoryLabel() {
  const { t } = useTranslation()
  return useCallback((category) => {
    // Unknown values (not in CATEGORIES) render as-is.
    return t(`categories.${category}`, { defaultValue: category ?? '' })
  }, [t])
}

export default function CategoryBadge({ category, className = '' }) {
  const label = useCategoryLabel()
  const style = CATEGORY_STYLES[category] ?? 'bg-border text-ink-secondary'

  return (
    <span
      className={[
        'font-mono text-label uppercase tracking-widest px-2 py-0.5 rounded-sm',
        style,
        className,
      ].join(' ')}
    >
      {label(category)}
    </span>
  )
}
