import { useTranslation } from 'react-i18next'
import { effectivePrices, type ExecutionMode, type KbModel } from '../../../api/kbAdmin'
import { priceNum as n } from './prices'

// Effective price of a model (ADMIN doc §7): when the stage would run in
// batch, the batch price with the list price struck through and a
// "batch −N%" badge ("hasta −N% (estimado)" until calibrated); otherwise
// the list price with a "sync" badge.
export default function PriceTag({ m, mode, estimate, className = '' }: {
  m: KbModel
  mode?: ExecutionMode
  // Global flag from the forecast; the model's own calibration wins.
  estimate?: boolean
  className?: string
}) {
  const { t } = useTranslation()
  const { prices, list, batched } = effectivePrices(m, mode)
  const pct = Math.round((m.batchDiscount ?? 0.5) * 100)
  const isEstimate = m.batchDiscountVerified === true ? false : m.batchDiscountVerified === false || !!estimate
  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 font-mono text-[0.7rem] text-ink-secondary dark:text-night-muted ${className}`}>
      <span className="text-ink-primary dark:text-night-text">US$ {n(prices.inputPerM)} / {n(prices.outputPerM)}</span>
      {batched && <s className="opacity-70">US$ {n(list.inputPerM)} / {n(list.outputPerM)}</s>}
      <span className="opacity-80">{t('manage.wikiAi.prices.per1M')}</span>
      {batched ? (
        <span
          className="px-1 rounded-sm bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
          title={isEstimate ? t('manage.wikiAi.prices.upTo', { pct }) : t('manage.wikiAi.prices.verified', { pct })}
        >
          batch −{pct}%{isEstimate ? '*' : ''}
        </span>
      ) : (
        <span className="px-1 rounded-sm bg-border dark:bg-night-border">{t('manage.wikiAi.models.syncBadge')}</span>
      )}
    </span>
  )
}
