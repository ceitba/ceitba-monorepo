import { useTranslation } from 'react-i18next'
import { effectivePrices, type ExecutionMode, type KbModel } from '../../../api/kbAdmin'
import { Badge } from '@/components/ui'
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
    <span className={`inline-flex flex-wrap items-center gap-1.5 font-mono text-label text-ink-secondary dark:text-night-muted ${className}`}>
      <span className="text-ink-primary dark:text-night-text">US$ {n(prices.inputPerM)} / {n(prices.outputPerM)}</span>
      {batched && <s className="opacity-70">US$ {n(list.inputPerM)} / {n(list.outputPerM)}</s>}
      <span className="opacity-80">{t('manage.wikiAi.prices.per1M')}</span>
      {batched ? (
        <Badge tone="success" className="normal-case tracking-normal">
          {isEstimate ? t('manage.wikiAi.prices.batchEstimate', { pct }) : t('manage.wikiAi.prices.batchVerified', { pct })}
        </Badge>
      ) : (
        <Badge className="normal-case tracking-normal">{t('manage.wikiAi.models.syncBadge')}</Badge>
      )}
    </span>
  )
}
