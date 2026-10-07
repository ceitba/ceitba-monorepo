import { useTranslation } from 'react-i18next'

// Sent / failed / pending recipients of a digest issue.
export default function DigestCounts({ counts }) {
  const { t } = useTranslation()
  const c = counts ?? {}
  const items = [
    ['sent', c.sent ?? 0, 'text-emerald-700'],
    ['failed', c.failed ?? 0, (c.failed ?? 0) > 0 ? 'text-red-600' : 'text-ink-primary'],
    ['pending', c.pending ?? 0, 'text-ink-primary'],
  ]
  return (
    <dl className="flex gap-5 sm:gap-6 flex-shrink-0">
      {items.map(([key, value, color]) => (
        <div key={key} className="flex flex-col">
          <dt className="font-mono text-label text-ink-secondary uppercase tracking-widest">{t(`admin.digests.counts.${key}`)}</dt>
          <dd className={`font-display text-h5 font-bold ${color}`}>{value}</dd>
        </div>
      ))}
    </dl>
  )
}
