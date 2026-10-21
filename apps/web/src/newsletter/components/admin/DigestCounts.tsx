import { useTranslation } from 'react-i18next'
import type { DigestCounts as DigestCountsData } from '../../types'

interface DigestCountsProps {
  counts: DigestCountsData | null | undefined
}

// Sent / failed / pending recipients of a digest issue.
export default function DigestCounts({ counts }: DigestCountsProps) {
  const { t } = useTranslation()
  const c: Partial<DigestCountsData> = counts ?? {}
  const items: [string, number, string][] = [
    ['sent', c.sent ?? 0, 'text-emerald-700 dark:text-emerald-300'],
    ['failed', c.failed ?? 0, (c.failed ?? 0) > 0 ? 'text-red-600 dark:text-red-400' : 'text-ink-primary dark:text-night-text'],
    ['pending', c.pending ?? 0, 'text-ink-primary dark:text-night-text'],
  ]
  return (
    <dl className="flex gap-5 sm:gap-6 shrink-0">
      {items.map(([key, value, color]) => (
        <div key={key} className="flex flex-col">
          <dt className="font-mono text-label text-ink-secondary dark:text-night-muted uppercase tracking-widest">{t(`admin.digests.counts.${key}`)}</dt>
          <dd className={`font-display text-h5 font-bold ${color}`}>{value}</dd>
        </div>
      ))}
    </dl>
  )
}
