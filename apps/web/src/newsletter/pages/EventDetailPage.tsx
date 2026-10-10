import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Alert, Button, ErrorState, LoadingRegion, Skeleton, buttonClass } from '@/components/ui'
import { ApiError } from '@/api/client'
import { startGoogleSignIn } from '@/store/authStore'
import { useAuth } from '@/hooks/useAuth'
import { buildSingleEventIcs, downloadIcs, googleCalendarEventUrl, type SingleEvent } from '@/utils/ics'
import CategoryBadge from '../components/CategoryBadge'
import { cancelRsvp, fetchEventById, fetchMyRsvps, rsvpEvent } from '../api/events'
import { fetchOrganizationBySlug } from '../api/organizations'
import { trackEvent } from '../store/analyticsStore'
import { formatDate, todayISO } from '../utils/dates'
import { eventPath, newsletterPath } from '@/newsletter/paths'
import type { NewsEvent, Organization } from '../types'

// Public page of one event: when and where, the organizing org, how to sign
// up (external form or the built-in RSVP) and add-to-calendar.
export default function EventDetailPage() {
  const { id = '' } = useParams()
  const { t, i18n } = useTranslation()
  const { profile } = useAuth()
  const location = useLocation()
  const [event, setEvent] = useState<NewsEvent | null>(null)
  const [org, setOrg] = useState<Organization | null>(null)
  const [status, setStatus] = useState<'loading' | 'success' | 'notFound' | 'error'>('loading')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setOrg(null)
    fetchEventById(id)
      .then((e) => {
        if (cancelled) return
        setEvent(e)
        setStatus('success')
        trackEvent('event_view', { eventId: e.id, category: e.category })
        if (e.organization) {
          fetchOrganizationBySlug(e.organization)
            .then((o) => { if (!cancelled) setOrg(o) })
            .catch((err: unknown) => console.error('newsletter: event org', err))
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setStatus(err instanceof ApiError && err.status === 404 ? 'notFound' : 'error')
      })
    return () => { cancelled = true }
  }, [id, reloadKey])

  if (status === 'loading') {
    return (
      <LoadingRegion className="container-content py-section-mobile lg:py-section flex flex-col gap-4 max-w-2xl">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-10 w-3/4" />
        <Skeleton className="h-24 w-full" />
      </LoadingRegion>
    )
  }
  if (status !== 'success' || !event) {
    const notFound = status === 'notFound'
    return (
      <div className="container-content py-section-mobile lg:py-section">
        <ErrorState
          title={notFound ? t('events.detail.notFoundTitle') : t('events.detail.errorTitle')}
          message={notFound ? t('events.detail.notFound') : undefined}
          onRetry={notFound ? undefined : () => setReloadKey((k) => k + 1)}
          backTo={newsletterPath('/events')}
          backLabel={t('events.detail.back')}
        />
      </div>
    )
  }

  const past = event.date < todayISO()
  const start = (event.startTime ?? '').slice(0, 5)
  const end = (event.endTime ?? '').slice(0, 5)
  const calendarEvent: SingleEvent = {
    uid: `${event.id}@newsletter.ceitba.org.ar`,
    title: event.title,
    date: event.date,
    startTime: event.startTime ?? '00:00',
    endTime: event.endTime ?? event.startTime ?? '00:00',
    location: event.location ?? undefined,
    description: event.description ?? undefined,
    url: `${window.location.origin}${eventPath(event.id)}`,
  }
  const googleUrl = googleCalendarEventUrl(calendarEvent)

  function downloadCalendar() {
    const ics = buildSingleEventIcs(calendarEvent, '-//CEITBA//ITBA News//ES')
    if (ics) downloadIcs(ics, `${event?.id ?? 'evento'}.ics`)
  }

  return (
    <article className="py-section-mobile lg:py-section">
      <div className="container-content">
        <Link
          to={newsletterPath('/events')}
          className="inline-flex items-center min-h-[44px] font-mono text-label text-ink-secondary hover:text-primary transition-colors duration-150 mb-6 focus-visible:rounded"
        >
          {t('events.detail.back')}
        </Link>

        {event.coverImage && (
          <div className="rounded-card overflow-hidden mb-10 h-56 lg:h-80">
            <img src={event.coverImage} alt="" className="w-full h-full object-cover" />
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-10">
          <div className="min-w-0">
            <CategoryBadge category={event.category} />
            <h1 className="font-display text-h2 lg:text-display font-bold text-ink-primary dark:text-night-text leading-tight mt-2 [overflow-wrap:anywhere]">
              {event.title}
            </h1>
            {event.organization && (
              <Link
                to={newsletterPath(`/organizations/${encodeURIComponent(event.organization)}`)}
                className="inline-flex items-center gap-2 min-h-[44px] mt-3 font-mono text-label uppercase tracking-widest text-primary dark:text-primary-300 hover:underline underline-offset-4"
              >
                {org?.logoUrl && <img src={org.logoUrl} alt="" className="w-6 h-6 rounded-sm object-cover" />}
                {org?.name ?? event.organization}
              </Link>
            )}

            <dl className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4 pb-6 border-b border-border dark:border-night-border">
              <div>
                <dt className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">{t('events.detail.when')}</dt>
                <dd className="font-body text-body text-ink-primary dark:text-night-text mt-1">
                  {formatDate(event.date, i18n.language, { weekday: 'long', month: 'long', day: 'numeric' })}
                  <br />
                  <time dateTime={`${event.date}T${start}`}>{t('events.timeRange', { start, end })}</time>
                </dd>
              </div>
              <div>
                <dt className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">{t('events.detail.where')}</dt>
                <dd className="font-body text-body text-ink-primary dark:text-night-text mt-1 [overflow-wrap:anywhere]">
                  {event.location}
                  {event.onlineUrl && (
                    <>
                      <br />
                      <a href={event.onlineUrl} target="_blank" rel="noopener noreferrer" className="text-primary dark:text-primary-300 underline underline-offset-2">
                        {t('events.detail.joinOnline')}
                      </a>
                    </>
                  )}
                </dd>
              </div>
            </dl>

            {event.description && (
              <p className="mt-6 font-body text-body-lg text-ink-primary dark:text-night-text leading-relaxed whitespace-pre-line [overflow-wrap:anywhere]">
                {event.description}
              </p>
            )}
          </div>

          <aside className="lg:sticky lg:top-24 self-start flex flex-col gap-4 rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface p-5">
            <SignupBlock
              event={event}
              past={past}
              signedIn={Boolean(profile)}
              onSignIn={() => startGoogleSignIn(location.pathname)}
              onChange={(rsvpCount) => setEvent((e) => e && { ...e, rsvpCount })}
            />
            {!past && (
              <div className="flex flex-col gap-2 pt-4 border-t border-border dark:border-night-border">
                <p className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">{t('events.detail.calendar')}</p>
                {googleUrl && (
                  <a href={googleUrl} target="_blank" rel="noopener noreferrer" className={buttonClass({ variant: 'outline', block: true })}>
                    {t('events.detail.googleCalendar')}
                  </a>
                )}
                <Button variant="ghost" block onClick={downloadCalendar}>{t('events.detail.downloadIcs')}</Button>
              </div>
            )}
          </aside>
        </div>
      </div>
    </article>
  )
}

function SignupBlock({ event, past, signedIn, onSignIn, onChange }: {
  event: NewsEvent
  past: boolean
  signedIn: boolean
  onSignIn: () => void
  onChange: (rsvpCount: number) => void
}) {
  const { t } = useTranslation()
  const [going, setGoing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!signedIn || event.signupMode !== 'rsvp') return
    let cancelled = false
    fetchMyRsvps()
      .then((ids) => { if (!cancelled) setGoing(ids.includes(event.id)) })
      .catch((err: unknown) => console.error('newsletter: my rsvps', err))
    return () => { cancelled = true }
  }, [signedIn, event.id, event.signupMode])

  if (past) {
    return <p className="font-body text-body text-ink-secondary dark:text-night-muted">{t('events.detail.past')}</p>
  }

  if (event.signupMode === 'external' && event.signupUrl) {
    return (
      <>
        <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('events.detail.externalHint')}</p>
        <a href={event.signupUrl} target="_blank" rel="noopener noreferrer" className={buttonClass({ block: true })}>
          {t('events.detail.signUp')}
        </a>
      </>
    )
  }

  if (event.signupMode !== 'rsvp') {
    return <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('events.detail.noSignup')}</p>
  }

  const full = event.capacity != null && event.rsvpCount >= event.capacity && !going

  async function toggle() {
    setBusy(true)
    setError('')
    try {
      const res = going ? await cancelRsvp(event.id) : await rsvpEvent(event.id)
      setGoing(res.going)
      onChange(res.rsvpCount)
    } catch (err) {
      const code = err instanceof ApiError ? err.code : undefined
      setError(
        code === 'EventFull' ? t('events.detail.errors.full')
          : code === 'EventEnded' ? t('events.detail.past')
          : t('events.detail.errors.rsvp'),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <p className="font-display text-h4 font-bold text-ink-primary dark:text-night-text tabular-nums">
        {event.capacity != null
          ? t('events.detail.goingOf', { count: event.rsvpCount, capacity: event.capacity })
          : t('events.detail.goingCount', { count: event.rsvpCount })}
      </p>
      {!signedIn ? (
        <Button block onClick={onSignIn}>{t('events.detail.signInToRsvp')}</Button>
      ) : going ? (
        <>
          <p className="font-body text-body-sm text-emerald-700 dark:text-emerald-300">{t('events.detail.youreGoing')}</p>
          <Button variant="outline" block loading={busy} onClick={toggle}>{t('events.detail.cancelRsvp')}</Button>
        </>
      ) : (
        <Button block loading={busy} disabled={full} onClick={toggle}>
          {full ? t('events.detail.full') : t('events.detail.rsvp')}
        </Button>
      )}
      {signedIn && !going && !full && (
        <p className="font-body text-label text-ink-secondary dark:text-night-muted">{t('events.detail.reminderHint')}</p>
      )}
      {error && <Alert tone="error">{error}</Alert>}
    </>
  )
}
