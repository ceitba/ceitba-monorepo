import { useTranslation } from 'react-i18next'
import { formatRate } from '../../utils/digest'

interface DigestRatesProps {
  openRate: number | null
  clickRate: number | null
}

// Open / click rates of a sent (or sending) issue.
export default function DigestRates({ openRate, clickRate }: DigestRatesProps) {
  const { t, i18n } = useTranslation()
  if (openRate == null && clickRate == null) return null
  return (
    <dl className="flex gap-5 sm:gap-6 shrink-0">
      {([['opens', openRate], ['clicks', clickRate]] as const).map(([key, value]) => (
        <div key={key} className="flex flex-col">
          <dt className="font-mono text-label text-ink-secondary dark:text-night-muted uppercase tracking-widest">{t(`admin.digests.rates.${key}`)}</dt>
          <dd className="font-display text-h5 font-bold text-primary dark:text-primary-300">{formatRate(value, i18n.language)}</dd>
        </div>
      ))}
    </dl>
  )
}
