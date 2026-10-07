import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { createDigest, fetchDigests } from '../../api/digests'
import { Alert, Button, EmptyState, ErrorState, Field, LoadingRegion, Skeleton, inputClass } from '@/components/ui'
import AdminSectionHeader from '../../components/admin/AdminSectionHeader'
import DigestStatusBadge from '../../components/admin/DigestStatusBadge'
import DigestCounts from '../../components/admin/DigestCounts'
import DigestQuotaBar from '../../components/admin/DigestQuotaBar'
import DigestSenderCard from '../../components/admin/DigestSenderCard'
import DigestRates from '../../components/admin/DigestRates'
import { addDaysISO, todayISO } from '../../utils/dates'
import {
  SENDING_POLL_MS, digestErrorMessage, formatArtDateTime, formatWeekRange, isPastInstant, mondayOf,
} from '../../utils/digest'
import { digestPath } from '@/newsletter/paths'
import type { DigestSummary } from '../../types'

// Outcome of the Google consent round-trip (?mail=connected | ?mail=error&reason=<code>).
interface MailResult {
  ok: boolean
  reason: string | null
}

// STAFF-only list of weekly digest issues ("La semana en ITBA").
export default function AdminDigestsPage() {
  const { t, i18n } = useTranslation()
  const [digests, setDigests] = useState<DigestSummary[]>([])
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [quotaKey, setQuotaKey] = useState(0)
  const [mailResult, setMailResult] = useState<MailResult | null>(null) // { ok, reason }
  const navigate = useNavigate()
  const location = useLocation()

  // Back from Google: ?mail=connected | ?mail=error&reason=<code>. Show the
  // result, strip the params (a reload must not repeat it) and refresh the
  // sender and quota.
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const mail = params.get('mail')
    if (mail !== 'connected' && mail !== 'error') return
    setMailResult({ ok: mail === 'connected', reason: params.get('reason') })
    params.delete('mail')
    params.delete('reason')
    const rest = params.toString()
    navigate({ pathname: location.pathname, search: rest ? `?${rest}` : '' }, { replace: true })
    setQuotaKey((k) => k + 1)
  }, [location.pathname, location.search, navigate])

  // Only the response of the latest request is applied, so a slow poll can't
  // overwrite newer data.
  const reqRef = useRef(0)
  const load = useCallback(({ quiet = false }: { quiet?: boolean } = {}) => {
    const req = ++reqRef.current
    if (!quiet) setStatus('loading')
    return fetchDigests()
      .then((data) => { if (req === reqRef.current) { setDigests(data ?? []); setStatus('success') } })
      .catch(() => { if (!quiet && req === reqRef.current) setStatus('error') })
  }, [])

  useEffect(() => { load() }, [load])

  // Keep the counts moving while an issue is going out.
  const anySending = digests.some((d) => d.status === 'sending')
  useEffect(() => {
    if (!anySending) return
    const id = setInterval(() => {
      load({ quiet: true })
      setQuotaKey((k) => k + 1)
    }, SENDING_POLL_MS)
    return () => clearInterval(id)
  }, [anySending, load])

  const header = <AdminSectionHeader title={t('admin.digests.title')} subtitle={t('admin.digests.subtitle')} />

  if (status === 'loading') {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <LoadingRegion className="flex flex-col gap-3">
          <Skeleton className="h-28 w-full rounded-card" />
          <Skeleton className="h-20 w-full rounded-card" />
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-card" />)}
        </LoadingRegion>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <ErrorState title={t('admin.digests.loadError')} onRetry={() => load()} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {header}

      {mailResult && <MailResultBanner result={mailResult} onDismiss={() => setMailResult(null)} />}

      <DigestSenderCard refreshKey={quotaKey} onChanged={() => setQuotaKey((k) => k + 1)} />

      <DigestQuotaBar refreshKey={quotaKey} />

      <NewDigestForm digests={digests} />

      {digests.length === 0 ? (
        <EmptyState title={t('admin.digests.emptyTitle')} body={t('admin.digests.emptyMessage')} />
      ) : (
        <ul className="flex flex-col gap-3 list-none m-0 p-0">
          {digests.map((d) => (
            <li key={d.id}>
              <Link
                to={digestPath(d.id)}
                className="group block bg-white dark:bg-night-surface rounded-card border border-border dark:border-night-border shadow-card hover:shadow-card-hover transition-shadow duration-150 p-4 sm:p-5"
              >
                <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-6">
                  <div className="flex-1 min-w-0 flex flex-col gap-1">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="font-mono text-label text-ink-secondary dark:text-night-muted uppercase tracking-widest">
                        {formatWeekRange(d.weekStart, d.weekEnd, i18n.language)}
                      </span>
                      <DigestStatusBadge status={d.status} />
                    </div>
                    <p className="font-display text-h5 font-bold text-ink-primary dark:text-night-text group-hover:text-primary dark:group-hover:text-primary-300 transition-colors duration-150 line-clamp-2">
                      {d.subject || t('admin.digests.noSubject')}
                    </p>
                    <p className={`font-body text-body-sm ${d.status === 'draft' && d.autoSendAt && isPastInstant(d.autoSendAt) ? 'text-amber-800 dark:text-amber-300' : 'text-ink-secondary dark:text-night-muted'}`}>
                      {d.status === 'sent' && d.sentAt
                        ? t('admin.digests.sentAt', { when: formatArtDateTime(d.sentAt, i18n.language) })
                        : d.status === 'draft'
                          ? d.autoSendAt && isPastInstant(d.autoSendAt)
                            ? t('admin.digests.autoSendPast')
                            : d.autoSendAt
                            ? t('admin.digests.autoSendAt', { when: formatArtDateTime(d.autoSendAt, i18n.language) })
                            : t('admin.digests.autoSendOff')
                          : null}
                    </p>
                    {d.status === 'sending' && d.resumeAt && (
                      <p className="font-body text-body-sm text-amber-800 dark:text-amber-300">
                        {t('admin.digests.resumesAt', { when: formatArtDateTime(d.resumeAt, i18n.language) })}
                      </p>
                    )}
                    {d.status === 'sending' && d.estimatedFinishAt && (
                      <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">
                        {t('admin.digests.finishesAt', { when: formatArtDateTime(d.estimatedFinishAt, i18n.language) })}
                      </p>
                    )}
                  </div>
                  {(d.status === 'sent' || d.status === 'sending') && (
                    <DigestRates openRate={d.openRate} clickRate={d.clickRate} />
                  )}
                  <DigestCounts counts={d.counts} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// Typed to accept the nullable `reason` lookup below.
const MAIL_REASONS = new Set<string | null>([
  'access_denied', 'invalid_state', 'not_staff', 'wrong_account', 'missing_scope', 'no_refresh_token', 'exchange_failed',
])

// Outcome of the Google consent round-trip. Stays until dismissed: the error
// reasons tell the person what to do differently.
interface MailResultBannerProps {
  result: MailResult
  onDismiss: () => void
}

function MailResultBanner({ result, onDismiss }: MailResultBannerProps) {
  const { t } = useTranslation()
  const message = result.ok
    ? t('admin.digests.sender.result.connected')
    : t(`admin.digests.sender.result.${MAIL_REASONS.has(result.reason) ? result.reason : 'unknown'}`)
  return (
    <Alert tone={result.ok ? 'success' : 'error'} onDismiss={onDismiss}>
      {message}
    </Alert>
  )
}

// "Nuevo resumen": pick any day, the issue covers that day's Monday–Sunday.
interface NewDigestFormProps {
  digests: DigestSummary[]
}

function NewDigestForm({ digests }: NewDigestFormProps) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  // Default to last week — the usual reason to create one by hand is that
  // the Monday job didn't (or the draft was cancelled).
  // todayISO() is always a valid date, so mondayOf() can't return null here.
  const [day, setDay] = useState(() => addDaysISO(mondayOf(todayISO()) as string, -7))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const weekStart = mondayOf(day)
  const existing = weekStart ? digests.find((d) => d.weekStart === weekStart) : null

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!weekStart) return
    setBusy(true)
    setError(null)
    try {
      const created = await createDigest(weekStart)
      navigate(digestPath(created.id))
    } catch (err) {
      setError(digestErrorMessage(err, t))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white dark:bg-night-surface rounded-card border border-border dark:border-night-border shadow-card p-4 sm:p-5 flex flex-col gap-3">
      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <Field label={t('admin.digests.new.weekLabel')} className="flex-1 sm:max-w-xs">
          {(p) => (
            <input
              {...p}
              type="date"
              value={day}
              onChange={(e) => { setDay(e.target.value); setError(null) }}
              className={inputClass()}
            />
          )}
        </Field>
        <Button type="submit" loading={busy} loadingLabel={t('admin.digests.new.creating')} disabled={!weekStart || Boolean(existing)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          {t('admin.digests.new.submit')}
        </Button>
      </div>
      {weekStart && (
        <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">
          {t('admin.digests.new.covers', { range: formatWeekRange(weekStart, addDaysISO(weekStart, 6), i18n.language) })}
        </p>
      )}
      {existing && (
        <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">
          {t('admin.digests.new.existsReason')}{' '}
          <Link to={digestPath(existing.id)} className="text-primary dark:text-primary-300 font-semibold underline underline-offset-2">
            {t('admin.digests.new.alreadyExists')}
          </Link>
        </p>
      )}
      {error && <Alert tone="error">{error}</Alert>}
    </form>
  )
}
