import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchDigestStats } from '../../api/digests'
import { formatArtDateTime, formatRate, hourlySeries } from '../../utils/digest'

// Aggregate opens/clicks of a sent or sending issue: KPIs, clicks per link
// and first opens per hour. Never per person.
export default function DigestStatsPanel({ id, refreshKey = 0 }) {
  const { t, i18n } = useTranslation()
  const [stats, setStats] = useState(null)
  const [state, setState] = useState('loading')

  // Only the latest request's response is applied (a slow earlier one must
  // not overwrite newer numbers).
  const reqRef = useRef(0)

  const load = useCallback(() => {
    const req = ++reqRef.current
    setState((s) => (s === 'ready' || s === 'refreshing' ? 'refreshing' : 'loading'))
    fetchDigestStats(id)
      .then((s) => { if (req === reqRef.current) { setStats(s); setState('ready') } })
      .catch(() => { if (req === reqRef.current) setState((s) => (s === 'refreshing' ? 'ready' : 'error')) })
  }, [id])

  useEffect(() => { load() }, [load, refreshKey])

  return (
    <section className="bg-white rounded-card border border-border shadow-card min-w-0">
      <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 border-b border-border flex-wrap">
        <h2 className="font-mono text-label uppercase tracking-widest text-ink-secondary">{t('admin.digests.stats.title')}</h2>
        <button
          type="button"
          onClick={load}
          disabled={state === 'loading' || state === 'refreshing'}
          className="font-mono text-label text-ink-secondary hover:text-primary underline underline-offset-2 disabled:opacity-50"
        >
          {state === 'refreshing' ? t('admin.digests.stats.refreshing') : t('admin.digests.stats.refresh')}
        </button>
      </div>

      {state === 'loading' && (
        <p className="px-4 sm:px-6 py-6 font-mono text-label text-ink-secondary uppercase tracking-widest" aria-busy="true">
          {t('admin.digests.stats.loading')}
        </p>
      )}
      {state === 'error' && (
        <div className="px-4 sm:px-6 py-6 flex flex-col items-start gap-3">
          <p className="font-body text-body-sm text-ink-secondary">{t('admin.digests.stats.error')}</p>
          <button type="button" onClick={load} className="min-h-[44px] px-5 bg-white border border-border text-ink-primary font-body text-body-sm font-semibold rounded-sm hover:border-primary hover:text-primary transition-colors duration-150">
            {t('admin.common.retry')}
          </button>
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
            <h3 className="font-body text-body-sm font-semibold text-ink-primary">{t('admin.digests.stats.byLink')}</h3>
            {stats.clicksByLink?.length ? (
              <div className="overflow-x-auto -mx-4 sm:mx-0">
                <table className="w-full min-w-[420px] text-left">
                  <thead>
                    <tr className="border-b border-border">
                      <th scope="col" className="px-4 sm:px-0 py-2 font-mono text-label uppercase tracking-widest text-ink-secondary">{t('admin.digests.stats.link')}</th>
                      <th scope="col" className="px-3 py-2 font-mono text-label uppercase tracking-widest text-ink-secondary text-right">{t('admin.digests.stats.unique')}</th>
                      <th scope="col" className="px-4 sm:px-0 py-2 font-mono text-label uppercase tracking-widest text-ink-secondary text-right">{t('admin.digests.stats.total')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {stats.clicksByLink.map((l) => (
                      <tr key={l.url}>
                        <td className="px-4 sm:px-0 py-2 align-top min-w-0">
                          <span className="block font-body text-body-sm font-semibold text-ink-primary break-words">{l.label}</span>
                          <span className="block font-mono text-label text-ink-secondary break-all">{l.url}</span>
                        </td>
                        <td className="px-3 py-2 align-top text-right font-display font-bold text-ink-primary">{l.uniqueClicks}</td>
                        <td className="px-4 sm:px-0 py-2 align-top text-right font-body text-body-sm text-ink-secondary">{l.totalClicks}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="font-body text-body-sm text-ink-secondary">{t('admin.digests.stats.noClicks')}</p>
            )}
          </div>

          <OpensByHour opensByHour={stats.opensByHour} />

          <p className="font-body text-body-sm text-ink-secondary">{t('admin.digests.stats.note')}</p>
        </div>
      )}
    </section>
  )
}

function Kpi({ label, value, sub }) {
  return (
    <div className="flex flex-col bg-surface rounded-sm border border-border px-4 py-3">
      <dt className="font-mono text-label text-ink-secondary uppercase tracking-widest">{label}</dt>
      <dd className="font-display text-h4 font-bold text-ink-primary">{value ?? 0}</dd>
      {sub && <dd className="font-body text-body-sm text-primary font-semibold">{sub}</dd>}
    </div>
  )
}

// Simple bars, one per hour, from the first to the last hour with opens.
function OpensByHour({ opensByHour }) {
  const { t, i18n } = useTranslation()
  const series = hourlySeries(opensByHour)
  const max = Math.max(1, ...series.map((h) => h.count))
  return (
    <div className="flex flex-col gap-2 min-w-0">
      <h3 className="font-body text-body-sm font-semibold text-ink-primary">{t('admin.digests.stats.byHour')}</h3>
      {series.length === 0 ? (
        <p className="font-body text-body-sm text-ink-secondary">{t('admin.digests.stats.noOpens')}</p>
      ) : (
        <>
          <div className="flex items-end gap-px h-24 border-b border-border" role="img" aria-label={t('admin.digests.stats.byHourAria', { hours: series.length, max })}>
            {series.map((h) => (
              <div
                key={h.hour}
                className="flex-1 min-w-[2px] bg-primary/80 hover:bg-accent rounded-t-[1px]"
                style={{ height: `${h.count === 0 ? 0 : Math.max(4, Math.round((h.count / max) * 100))}%` }}
                title={`${h.folded ? t('admin.digests.stats.laterFrom', { when: formatArtDateTime(h.hour, i18n.language) }) : formatArtDateTime(h.hour, i18n.language)} · ${t('admin.digests.stats.opensCount', { count: h.count })}`}
              />
            ))}
          </div>
          <div className="flex justify-between gap-3 font-mono text-label text-ink-secondary">
            <span>{formatArtDateTime(series[0].hour, i18n.language)}</span>
            {series.length > 1 && (
              <span>
                {series[series.length - 1].folded
                  ? t('admin.digests.stats.laterBucket')
                  : formatArtDateTime(series[series.length - 1].hour, i18n.language)}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
