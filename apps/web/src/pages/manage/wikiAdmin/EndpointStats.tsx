import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchEndpointStats, type EndpointStats as Stats } from '../../../api/kbAdmin'
import { apuntesErrorMessage } from '../../../utils/apuntes'
import { ms, rate } from './format'
import { FIELD } from './styles'

const WINDOWS = [15, 60, 240] as const
const REFRESH_MS = 10_000

// "Prueba de carga": request/error counts, latency percentiles, output
// tok/s and in-flight for one endpoint. Polls every 10 s only while the
// tab is visible.
export default function EndpointStats({ id }: { id: string }) {
  const { t } = useTranslation()
  const [minutes, setMinutes] = useState<number>(60)
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | null = null

    function load() {
      fetchEndpointStats(id, minutes)
        .then((s) => { if (!cancelled) { setStats(s); setError(null) } })
        .catch((e) => { if (!cancelled) setError(apuntesErrorMessage(e, t)) })
    }
    function start() {
      if (timer) return
      load()
      timer = setInterval(load, REFRESH_MS)
    }
    function stop() {
      if (timer) { clearInterval(timer); timer = null }
    }
    function onVisibility() {
      if (document.visibilityState === 'visible') start()
      else stop()
    }

    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [id, minutes, t])

  const cells: { label: string; value: string }[] = [
    { label: t('manage.wikiAi.endpoints.stats.requests'), value: stats ? String(stats.requests) : '—' },
    { label: t('manage.wikiAi.endpoints.stats.errors'), value: stats ? String(stats.errors) : '—' },
    { label: t('manage.wikiAi.endpoints.stats.p50'), value: ms(stats?.p50Ms) },
    { label: t('manage.wikiAi.endpoints.stats.p95'), value: ms(stats?.p95Ms) },
    { label: t('manage.wikiAi.endpoints.stats.tokPerSec'), value: rate(stats?.outputTokensPerSec) },
    { label: t('manage.wikiAi.endpoints.stats.inFlight'), value: stats ? String(stats.inFlight) : '—' },
  ]

  return (
    <div className="flex flex-col gap-2 pt-3 border-t border-border dark:border-night-border">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.endpoints.stats.title')}</p>
        <label className="inline-flex items-center gap-2 font-body text-body-sm">
          <span className="text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.endpoints.stats.window')}</span>
          <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className={`${FIELD} py-1`}>
            {WINDOWS.map((w) => <option key={w} value={w}>{t('manage.wikiAi.endpoints.stats.minutes', { n: w })}</option>)}
          </select>
        </label>
      </div>
      <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {cells.map((c) => (
          <div key={c.label} className="px-3 py-2 rounded-sm bg-page-bg dark:bg-night-bg">
            <dt className="font-body text-[0.72rem] text-ink-secondary dark:text-night-muted">{c.label}</dt>
            <dd className="font-mono text-body tabular-nums text-ink-primary dark:text-night-text">{c.value}</dd>
          </div>
        ))}
      </dl>
      {error && <p role="alert" className="font-body text-[0.78rem] text-red-600 dark:text-red-400">{error}</p>}
      <p className="font-body text-[0.72rem] text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.endpoints.stats.pausedHint')}</p>
    </div>
  )
}
