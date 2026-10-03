import { useTranslation } from 'react-i18next'
import type { AcademicYearSource } from '../../api/drive'

// Academic year of a file ("2021"). Years estimated from Drive dates read
// "≈2021" with an explanatory tooltip.
export default function YearBadge({ year, source, variant = 'badge', className = '' }: {
  year: number | null | undefined
  source?: AcademicYearSource | null
  variant?: 'badge' | 'text'
  className?: string
}) {
  const { t } = useTranslation()
  if (year == null) return null
  const estimated = source === 'DRIVE'
  const tip = source ? t(`apuntes.year.source.${source}`) : undefined
  const text = `${estimated ? '≈' : ''}${year}`
  if (variant === 'text') {
    return <span title={tip} className={className}>{text}</span>
  }
  return (
    <span
      title={tip}
      className={`inline-flex items-center px-1.5 rounded-sm border border-border dark:border-night-border font-mono text-label text-ink-secondary dark:text-night-muted ${className}`}
    >
      {estimated && <span className="sr-only">{tip}: </span>}
      {text}
    </span>
  )
}
