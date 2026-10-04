import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { QuotaMeter } from '../../../api/kbAdmin'
import { ProgressBar } from './ProgressPanel'
import { ago, tokens } from './format'
import { count, meterLow, meterPercent } from './quota'
import { useQuota } from './useQuota'

function Meter({ label, m, fmt, strong = false }: { label: string; m: QuotaMeter | null; fmt: (n: number) => string; strong?: boolean }) {
  const low = meterLow(m)
  const value = m ? `${fmt(m.remaining)}/${fmt(m.limit)}` : '—'
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="flex items-baseline justify-between gap-2 font-body text-body-sm">
        <span className="text-ink-secondary dark:text-night-muted truncate">{label}</span>
        <span className={`tabular-nums whitespace-nowrap ${strong ? 'font-display font-bold' : ''} ${low ? 'text-red-600 dark:text-red-400' : 'text-ink-primary dark:text-night-text'}`}>{value}</span>
      </div>
      <ProgressBar percent={meterPercent(m) ?? 0} tone={low ? 'danger' : 'primary'} />
    </div>
  )
}

// Compact DigitalOcean quota card: batch limits and sync token budget.
// Hides itself when the API has no quota endpoint.
export default function QuotaCard({ className = '' }: { className?: string }) {
  const { t } = useTranslation()
  const { data, unavailable, refreshing, refresh } = useQuota()
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  if (unavailable) return null
  const b = data?.batch
  const s = data?.sync

  return (
    <section aria-label={t('manage.wikiAi.quota.title')} className={`rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface p-3 flex flex-col gap-3 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.quota.title')}</h3>
        <div className="flex items-center gap-2 font-mono text-[0.72rem] text-ink-secondary dark:text-night-muted">
          {data?.stale && <span title={t('manage.wikiAi.quota.staleHint')}>{t('manage.wikiAi.quota.approx')}</span>}
          <span>{data?.observedAt ? t('manage.wikiAi.quota.updated', { ago: ago(data.observedAt, now, t) }) : data ? t('manage.wikiAi.quota.never') : '…'}</span>
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            aria-label={t('manage.wikiAi.quota.refresh')}
            className="px-2 py-1 rounded-sm border border-border dark:border-night-border uppercase tracking-widest hover:text-primary hover:border-primary disabled:opacity-50"
          >
            {refreshing ? '…' : '↻'}
          </button>
        </div>
      </div>
      {!data ? (
        <div aria-hidden="true" className="h-16 rounded-sm skeleton" />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
          <div className="flex flex-col gap-2 min-w-0">
            <Meter strong label={t('manage.wikiAi.quota.batchesHour')} m={b?.creationsPerHour ?? null} fmt={count} />
            <Meter label={t('manage.wikiAi.quota.batchRequestsDay')} m={b?.requestsPerDay ?? null} fmt={count} />
          </div>
          <div className="flex flex-col gap-2 min-w-0">
            <Meter strong label={t('manage.wikiAi.quota.tokensDay')} m={s?.tokensPerDay ?? null} fmt={tokens} />
            <Meter label={t('manage.wikiAi.quota.tokensMinute')} m={s?.tokensPerMinute ?? null} fmt={tokens} />
          </div>
        </div>
      )}
    </section>
  )
}
