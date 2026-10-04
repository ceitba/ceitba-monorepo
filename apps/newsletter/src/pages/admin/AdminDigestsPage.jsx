import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { createDigest, fetchDigests } from '../../api/digests'
import { isStaff } from '../../store/authStore'
import DigestStatusBadge from '../../components/admin/DigestStatusBadge'
import DigestCounts from '../../components/admin/DigestCounts'
import { addDaysISO, todayISO } from '../../utils/dates'
import {
  SENDING_POLL_MS, digestErrorMessage, formatArtDateTime, formatWeekRange, mondayOf,
} from '../../utils/digest'

// STAFF-only list of weekly digest issues ("La semana en ITBA").
export default function AdminDigestsPage() {
  const { t, i18n } = useTranslation()
  const staff = isStaff()
  const [digests, setDigests] = useState([])
  const [status, setStatus] = useState('loading')

  const load = useCallback(({ quiet = false } = {}) => {
    if (!quiet) setStatus('loading')
    return fetchDigests()
      .then((data) => { setDigests(data ?? []); setStatus('success') })
      .catch(() => { if (!quiet) setStatus('error') })
  }, [])

  useEffect(() => { if (staff) load() }, [staff, load])

  // Keep the counts moving while an issue is going out.
  const anySending = digests.some((d) => d.status === 'sending')
  useEffect(() => {
    if (!anySending) return
    const id = setInterval(() => load({ quiet: true }), SENDING_POLL_MS)
    return () => clearInterval(id)
  }, [anySending, load])

  if (!staff) return <Navigate to="/admin/articles" replace />

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center py-32" aria-busy="true">
        <p className="font-mono text-label text-ink-secondary uppercase tracking-widest">{t('admin.digests.loading')}</p>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-4 text-center">
        <p className="font-display text-h5 font-bold text-ink-primary">{t('admin.digests.loadError')}</p>
        <button type="button" onClick={() => load()} className="min-h-[44px] px-5 bg-primary text-surface font-body font-semibold rounded-sm hover:bg-primary-600 transition-colors duration-150">
          {t('admin.common.retry')}
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-h3 font-bold text-ink-primary">{t('admin.digests.title')}</h1>
        <p className="font-body text-body-sm text-ink-secondary mt-0.5 max-w-2xl">{t('admin.digests.subtitle')}</p>
      </div>

      <NewDigestForm digests={digests} />

      {digests.length === 0 ? (
        <div className="bg-white rounded-card border border-border shadow-card flex flex-col items-center justify-center py-16 gap-3 text-center px-4">
          <div className="relative w-16 h-16" aria-hidden="true">
            <div className="absolute inset-0 rounded-full bg-primary-50" />
            <div className="absolute top-3 left-3 w-8 h-8 rotate-45 bg-accent-100" />
          </div>
          <p className="font-display text-h5 font-bold text-ink-primary">{t('admin.digests.emptyTitle')}</p>
          <p className="font-body text-body-sm text-ink-secondary max-w-sm">{t('admin.digests.emptyMessage')}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3 list-none m-0 p-0">
          {digests.map((d) => (
            <li key={d.id}>
              <Link
                to={`/admin/digests/${d.id}`}
                className="group block bg-white rounded-card border border-border shadow-card hover:shadow-card-hover transition-shadow duration-150 p-4 sm:p-5"
              >
                <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-6">
                  <div className="flex-1 min-w-0 flex flex-col gap-1">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="font-mono text-label text-ink-secondary uppercase tracking-widest">
                        {formatWeekRange(d.weekStart, d.weekEnd, i18n.language)}
                      </span>
                      <DigestStatusBadge status={d.status} />
                    </div>
                    <p className="font-display text-h5 font-bold text-ink-primary group-hover:text-primary transition-colors duration-150 line-clamp-2">
                      {d.subject || t('admin.digests.noSubject')}
                    </p>
                    <p className="font-body text-body-sm text-ink-secondary">
                      {d.status === 'sent' && d.sentAt
                        ? t('admin.digests.sentAt', { when: formatArtDateTime(d.sentAt, i18n.language) })
                        : d.status === 'draft'
                          ? d.autoSendAt
                            ? t('admin.digests.autoSendAt', { when: formatArtDateTime(d.autoSendAt, i18n.language) })
                            : t('admin.digests.autoSendOff')
                          : null}
                    </p>
                  </div>
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

// "Nuevo resumen": pick any day, the issue covers that day's Monday–Sunday.
function NewDigestForm({ digests }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  // Default to last week — the usual reason to create one by hand is that
  // the Monday job didn't (or the draft was cancelled).
  const [day, setDay] = useState(() => addDaysISO(mondayOf(todayISO()), -7))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const weekStart = mondayOf(day)
  const existing = weekStart ? digests.find((d) => d.weekStart === weekStart) : null

  async function handleSubmit(e) {
    e.preventDefault()
    if (!weekStart) return
    setBusy(true)
    setError(null)
    try {
      const created = await createDigest(weekStart)
      navigate(`/admin/digests/${created.id}`)
    } catch (err) {
      setError(digestErrorMessage(err, t))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-card border border-border shadow-card p-4 sm:p-5 flex flex-col gap-3">
      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <label className="flex flex-col gap-1.5 flex-1 sm:max-w-xs">
          <span className="font-body text-body-sm font-semibold text-ink-primary">{t('admin.digests.new.weekLabel')}</span>
          <input
            type="date"
            value={day}
            onChange={(e) => { setDay(e.target.value); setError(null) }}
            className="w-full min-h-[44px] px-3 py-2 border border-border rounded-sm font-body text-body text-ink-primary bg-white focus:outline-none focus:ring-1 focus:border-primary focus:ring-primary/30"
          />
        </label>
        <button
          type="submit"
          disabled={busy || !weekStart || Boolean(existing)}
          className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 bg-primary text-surface font-body text-body-sm font-semibold rounded-sm hover:bg-primary-600 transition-colors duration-150 disabled:opacity-60"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          {busy ? t('admin.digests.new.creating') : t('admin.digests.new.submit')}
        </button>
      </div>
      {weekStart && (
        <p className="font-body text-body-sm text-ink-secondary">
          {t('admin.digests.new.covers', { range: formatWeekRange(weekStart, addDaysISO(weekStart, 6), i18n.language) })}
          {existing && (
            <>
              {' · '}
              <Link to={`/admin/digests/${existing.id}`} className="text-primary underline underline-offset-2">
                {t('admin.digests.new.alreadyExists')}
              </Link>
            </>
          )}
        </p>
      )}
      {error && (
        <p role="alert" className="font-body text-body-sm text-red-600 bg-red-50 px-3 py-2 rounded-sm">{error}</p>
      )}
    </form>
  )
}
