import { useTranslation } from 'react-i18next'
import { formatRate } from '../../utils/digest'

// Open / click rates of a sent (or sending) issue.
export default function DigestRates({ openRate, clickRate }) {
  const { t, i18n } = useTranslation()
  if (openRate == null && clickRate == null) return null
  return (
    <dl className="flex gap-5 sm:gap-6 flex-shrink-0">
      {[['opens', openRate], ['clicks', clickRate]].map(([key, value]) => (
        <div key={key} className="flex flex-col">
          <dt className="font-mono text-label text-ink-secondary uppercase tracking-widest">{t(`admin.digests.rates.${key}`)}</dt>
          <dd className="font-display text-h5 font-bold text-primary">{formatRate(value, i18n.language)}</dd>
        </div>
      ))}
    </dl>
  )
}
