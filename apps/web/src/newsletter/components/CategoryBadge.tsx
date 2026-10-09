import { Badge } from '@/components/ui'
import { useCategoryLabel } from '../hooks/useCategoryLabel'

// Per-category colors from docs/EDITORIAL_UI_SYSTEM.md ("Category color
// mapping"). Categories aren't statuses, so they bypass the Badge tones.
const CATEGORY_STYLES: Record<string, string> = {
  Académico:      'bg-primary-100 text-primary-700 dark:bg-primary-700 dark:text-primary-200',
  Campus:         'bg-accent-50 text-accent-600 dark:bg-accent-900 dark:text-amber-500',
  Cultura:        'bg-emerald-50 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  Tecnología:     'bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
  Deportes:       'bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
  Organizaciones: 'bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  General:        'bg-border text-ink-secondary dark:bg-night-border',
}

interface CategoryBadgeProps {
  category: string
  className?: string
}

export default function CategoryBadge({ category, className = '' }: CategoryBadgeProps) {
  const label = useCategoryLabel()
  const style = CATEGORY_STYLES[category] ?? CATEGORY_STYLES.General
  return (
    <Badge tone={null} className={`${style} ${className}`}>
      {label(category)}
    </Badge>
  )
}
