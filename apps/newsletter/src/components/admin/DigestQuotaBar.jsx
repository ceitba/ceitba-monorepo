import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchDigestQuota } from '../../api/digests'
import { formatArtDateTime } from '../../utils/digest'

// "Hoy: used / limit usados" — the rolling 24h sending quota of the account
// the digest goes out from (test sends count too), plus any active pause.
// `refreshKey` re-fetches (e.g. while an issue is sending).
export default function DigestQuotaBar({ refreshKey = 0 }) {
  const { t, i18n } = useTranslation()
  const [quota, setQuota] = useState(null)
  const [failed, setFailed] = useState(false)

  // Ignore responses of requests that a newer one has superseded.
  const reqRef = useRef(0)

  const load = useCallback(() => {
    const req = ++reqRef.current
    fetchDigestQuota()
      .then((q) => { if (req === reqRef.current) { setQuota(q); setFailed(false) } })
      .catch(() => { if (req === reqRef.current) setFailed(true) })
  }, [])

  useEffect(() => { load() }, [load, refreshKey])

  if (failed && !quota) {
    return <p className="font-body text-body-sm text-ink-secondary">{t('admin.digests.quota.loadError')}</p>
  }
  if (!quota) return null

  const limit = quota.limit ?? 0
  const used = quota.usedLast24h ?? 0
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100
  const full = (quota.remaining ?? 0) <= 0
  const barColor = full ? 'bg-red-500' : pct >= 80 ? 'bg-accent' : 'bg-primary'
  const when = (iso) => formatArtDateTime(iso, i18n.language)

  return (
    <section className="bg-white rounded-card border border-border shadow-card p-4 sm:p-5 flex flex-col gap-2" aria-label={t('admin.digests.quota.title')}>
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <p className="font-body text-body-sm font-semibold text-ink-primary">
          {t('admin.digests.quota.label', { used, limit })}
        </p>
        <p className="font-mono text-label text-ink-secondary">{quota.account}</p>
      </div>
      <div
        className="h-2 w-full bg-surface border border-border rounded-full overflow-hidden"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={used}
        aria-label={t('admin.digests.quota.label', { used, limit })}
      >
        <div className={`h-full ${barColor} transition-[width] duration-300`} style={{ width: `${pct}%` }} />
      </div>
      <p className="font-body text-body-sm text-ink-secondary">{t('admin.digests.quota.hint')}</p>
      {quota.pausedUntil && (
        <p role="status" className="font-body text-body-sm text-accent-700 bg-accent-50 px-3 py-2 rounded-sm">
          {quota.pauseReason === 'quota'
            ? t('admin.digests.quota.pausedQuota', { when: when(quota.pausedUntil) })
            : t('admin.digests.quota.pausedTransport', { when: when(quota.pausedUntil) })}
        </p>
      )}
      {!quota.pausedUntil && full && quota.nextCapacityAt && (
        <p role="status" className="font-body text-body-sm text-accent-700 bg-accent-50 px-3 py-2 rounded-sm">
          {t('admin.digests.quota.full', { when: when(quota.nextCapacityAt) })}
        </p>
      )}
    </section>
  )
}
