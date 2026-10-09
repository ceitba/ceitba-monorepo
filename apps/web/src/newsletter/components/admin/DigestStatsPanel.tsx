import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, ErrorState, LoadingRegion, Skeleton } from '@/components/ui'
import { fetchDigestStats } from '../../api/digests'
import { formatArtDateTime, formatRate, hourlySeries } from '../../utils/digest'
import type { DigestStats } from '../../types'

interface DigestStatsPanelProps {
  id: string
  // Any change re-fetches.
  refreshKey?: number | string
}

type LoadState = 'loading' | 'refreshing' | 'ready' | 'error'

// Aggregate opens/clicks of a sent or sending issue: KPIs, clicks per link
// and first opens per hour. Never per person.
export default function DigestStatsPanel({ id, refreshKey = 0 }: DigestStatsPanelProps) {
  const { t, i18n } = useTranslation()
  const [stats, setStats] = useState<DigestStats | null>(null)
  const [state, setState] = useState<LoadState>('loading')

  // Only the latest request's response is applied (a slow earlier one must
  // not overwrite newer numbers).
  const reqRef = useRef(0)

  const load = useCallback(() => {
    const req = ++reqRef.current
    setState((s) => (s === 'ready' || s === 'refreshing' ? 'refreshing' : 'loading'))
    fetchDigestStats(id)
      .then((s) => { if (req === reqRef.current) { setStats(s); setState('ready') } })
      .catch((err: unknown) => {
        console.error('newsletter admin: digest stats', err)
        if (req === reqRef.current) setState((s) => (s === 'refreshing' ? 'ready' : 'error'))
      })
  }, [id])

  useEffect(() => { load() }, [load, refreshKey])

  const th = 'py-2 font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted'

  return (
    <section className="bg-white dark:bg-night-surface rounded-card border border-border dark:border-night-border shadow-card min-w-0">
      <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-2 border-b border-border dark:border-night-border flex-wrap">
        <h3 className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">{t('admin.digests.stats.title')}</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={load}
          loading={state === 'refreshing'}
          loadingLabel={t('admin.digests.stats.refreshing')}
          disabled={state === 'loading'}
        >
          {t('admin.digests.stats.refresh')}
        </Button>
      </div>

      {state === 'loading' && (
        <LoadingRegion className="flex flex-col gap-4 px-4 sm:px-6 py-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
          </div>
          <Skeleton className="h-24 w-full" />
        </LoadingRegion>
      )}
      {state === 'error' && (
        <div className="px-4 sm:px-6 py-5">
          <ErrorState compact title={t('admin.digests.stats.error')} onRetry={load} />
        </div>
      )}

      {stats && (state === 'ready' || state === 'refreshing') && (
        <div className="flex flex-col gap-6 px-4 sm:px-6 py-5">
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Kpi label={t('admin.digests.stats.delivered')} value={stats.delivered} />
            <Kpi
              label={t('admin.digests.stats.uniqueOpens')}
              value={stats.uniqueOpens}
              sub={t('admin.digests.stats.rate', { rate: formatRate(stats.openRate, i18n.language) })}
            />
            <Kpi
              label={t('admin.digests.stats.uniqueClicks')}
              value={stats.uniqueClicks}
              sub={t('admin.digests.stats.rate', { rate: formatRate(stats.clickRate, i18n.language) })}
            />
          </dl>

          <div className="flex flex-col gap-2 min-w-0">
            <h4 className="font-body text-body-sm font-semibold text-ink-primary dark:text-night-text">{t('admin.digests.stats.byLink')}</h4>
            {stats.clicksByLink?.length ? (
              <div className="overflow-x-auto -mx-4 sm:mx-0">
                <table className="w-full min-w-[420px] text-left">
                  <thead>
                    <tr className="border-b border-border dark:border-night-border">
                      <th scope="col" className={`px-4 sm:px-0 ${th}`}>{t('admin.digests.stats.link')}</th>
                      <th scope="col" className={`px-3 text-right ${th}`}>{t('admin.digests.stats.unique')}</th>
                      <th scope="col" className={`px-4 sm:px-0 text-right ${th}`}>{t('admin.digests.stats.total')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border dark:divide-night-border">
                    {stats.clicksByLink.map((l) => (
                      <tr key={l.url}>
                        <td className="px-4 sm:px-0 py-2 align-top min-w-0">
                          <span className="block font-body text-body-sm font-semibold text-ink-primary dark:text-night-text break-words">{l.label}</span>
                          <span className="block font-mono text-label text-ink-secondary dark:text-night-muted break-all">{l.url}</span>
                        </td>
                        <td className="px-3 py-2 align-top text-right font-display font-bold text-ink-primary dark:text-night-text">{l.uniqueClicks}</td>
                        <td className="px-4 sm:px-0 py-2 align-top text-right font-body text-body-sm text-ink-secondary dark:text-night-muted">{l.totalClicks}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('admin.digests.stats.noClicks')}</p>
            )}
          </div>

          <OpensByHour opensByHour={stats.opensByHour} />

          <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('admin.digests.stats.note')}</p>
        </div>
      )}
    </section>
  )
}

interface KpiProps {
  label: ReactNode
  value: number | null | undefined
  sub?: ReactNode
}

function Kpi({ label, value, sub }: KpiProps) {
  return (
    <div className="flex flex-col bg-page-bg dark:bg-night-raised rounded-sm border border-border dark:border-night-border px-4 py-3">
      <dt className="font-mono text-label text-ink-secondary dark:text-night-muted uppercase tracking-widest">{label}</dt>
      <dd className="font-display text-h4 font-bold text-ink-primary dark:text-night-text">{value ?? 0}</dd>
      {sub && <dd className="font-body text-body-sm text-primary dark:text-primary-300 font-semibold">{sub}</dd>}
    </div>
  )
}

// Simple bars, one per hour, from the first to the last hour with opens.
// The bars are decorative: the peak is written out, and a screen-reader
// table carries every hour's count.
function OpensByHour({ opensByHour }: { opensByHour: DigestStats['opensByHour'] | null | undefined }) {
  const { t, i18n } = useTranslation()
  const series = hourlySeries(opensByHour)
  const max = Math.max(1, ...series.map((h) => h.count))
  const hourLabel = (h: (typeof series)[number]) =>
    h.folded ? t('admin.digests.stats.laterFrom', { when: formatArtDateTime(h.hour, i18n.language) }) : formatArtDateTime(h.hour, i18n.language)
  const peak = series.reduce<(typeof series)[number] | null>((best, h) => (!best || h.count > best.count ? h : best), null)
  return (
    <div className="flex flex-col gap-2 min-w-0">
      <h4 className="font-body text-body-sm font-semibold text-ink-primary dark:text-night-text">{t('admin.digests.stats.byHour')}</h4>
      {series.length === 0 || !peak ? (
        <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('admin.digests.stats.noOpens')}</p>
      ) : (
        <>
          <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">
            {t('admin.digests.stats.peak', { count: peak.count, when: hourLabel(peak) })}
          </p>
          <div className="flex items-end gap-px h-24 border-b border-border dark:border-night-border" aria-hidden="true">
            {series.map((h) => (
              <div
                key={h.hour}
                className="flex-1 min-w-[2px] bg-primary/80 dark:bg-primary-400 rounded-t-[1px]"
                style={{ height: `${h.count === 0 ? 0 : Math.max(4, Math.round((h.count / max) * 100))}%` }}
              />
            ))}
          </div>
          <div className="flex justify-between gap-3 font-mono text-label text-ink-secondary dark:text-night-muted" aria-hidden="true">
            <span>{formatArtDateTime(series[0].hour, i18n.language)}</span>
            {series.length > 1 && (
              <span>
                {series[series.length - 1].folded
                  ? t('admin.digests.stats.laterBucket')
                  : formatArtDateTime(series[series.length - 1].hour, i18n.language)}
              </span>
            )}
          </div>
          <table className="sr-only">
            <caption>{t('admin.digests.stats.byHour')}</caption>
            <tbody>
              {series.filter((h) => h.count > 0).map((h) => (
                <tr key={h.hour}>
                  <th scope="row">{hourLabel(h)}</th>
                  <td>{t('admin.digests.stats.opensCount', { count: h.count })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}
