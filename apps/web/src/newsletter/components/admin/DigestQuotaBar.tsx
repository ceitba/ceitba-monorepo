import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchDigestQuota } from '../../api/digests'
import type { DigestQuota, IsoDateTime } from '../../types'
import { formatArtDateTime } from '../../utils/digest'
import { Alert, Button, LoadingRegion, Skeleton } from '@/components/ui'

interface DigestQuotaBarProps {
  refreshKey?: number
}

// "Hoy: used / limit usados" — the rolling 24h sending quota of the account
// the digest goes out from (test sends count too), plus any active pause.
// `refreshKey` re-fetches (e.g. while an issue is sending).
export default function DigestQuotaBar({ refreshKey = 0 }: DigestQuotaBarProps) {
  const { t, i18n } = useTranslation()
  const [quota, setQuota] = useState<DigestQuota | null>(null)
  const [failed, setFailed] = useState(false)

  // Ignore responses of requests that a newer one has superseded.
  const reqRef = useRef(0)

  const load = useCallback(() => {
    const req = ++reqRef.current
    fetchDigestQuota()
      .then((q) => { if (req === reqRef.current) { setQuota(q); setFailed(false) } })
      .catch((err: unknown) => {
        console.error('newsletter admin: digest quota', err)
        if (req === reqRef.current) setFailed(true)
      })
  }, [])

  useEffect(() => { load() }, [load, refreshKey])

  if (failed && !quota) {
    return (
      <Alert tone="error" action={<Button variant="outline" size="sm" onClick={load}>{t('admin.common.retry')}</Button>}>
        {t('admin.digests.quota.loadError')}
      </Alert>
    )
  }
  if (!quota) {
    return (
      <LoadingRegion>
        <Skeleton className="h-24 w-full rounded-card" />
      </LoadingRegion>
    )
  }

  const limit = quota.limit ?? 0
  const used = quota.usedLast24h ?? 0
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100
  const full = (quota.remaining ?? 0) <= 0
  const barColor = full ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-primary dark:bg-primary-400'
  const when = (iso: IsoDateTime) => formatArtDateTime(iso, i18n.language)

  return (
    <section className="bg-white dark:bg-night-surface rounded-card border border-border dark:border-night-border shadow-card p-4 sm:p-5 flex flex-col gap-2" aria-label={t('admin.digests.quota.title')}>
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <p className="font-body text-body-sm font-semibold text-ink-primary dark:text-night-text">
          {t('admin.digests.quota.label', { used, limit })}
        </p>
        <p className="font-mono text-label text-ink-secondary dark:text-night-muted">{quota.account}</p>
      </div>
      <div
        className="h-2 w-full bg-page-bg dark:bg-night-raised border border-border dark:border-night-border rounded-full overflow-hidden"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={used}
        aria-label={t('admin.digests.quota.label', { used, limit })}
      >
        <div className={`h-full ${barColor} transition-[width] duration-300`} style={{ width: `${pct}%` }} />
      </div>
      <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('admin.digests.quota.hint')}</p>
      {quota.pausedUntil && (
        <Alert tone="warning">
          {quota.pauseReason === 'quota'
            ? t('admin.digests.quota.pausedQuota', { when: when(quota.pausedUntil) })
            : t('admin.digests.quota.pausedTransport', { when: when(quota.pausedUntil) })}
        </Alert>
      )}
      {!quota.pausedUntil && full && quota.nextCapacityAt && (
        <Alert tone="warning">{t('admin.digests.quota.full', { when: when(quota.nextCapacityAt) })}</Alert>
      )}
    </section>
  )
}
