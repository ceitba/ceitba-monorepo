import { useState, useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { EmptyState, ErrorState, LoadingRegion, toast } from '@/components/ui'
import Calendar from '../components/Calendar'
import EventCard from '../components/EventCard'
import { fetchAllEvents } from '../api/events'
import { formatDate, monthStartISO, todayISO } from '../utils/dates'
import type { TFunction } from 'i18next'
import type { NewsEvent } from '../types'
import NewsletterPageHeader from '../components/NewsletterPageHeader'

interface ViewMonth {
  year: number
  month: number
}

export default function EventsPage() {
  const { t, i18n } = useTranslation()
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [allEvents, setAllEvents]       = useState<NewsEvent[]>([])
  const [status, setStatus]             = useState<'loading' | 'success' | 'error'>('loading')
  // Month shown by the calendar; months before the current one are fetched
  // on demand (the main list only covers this month onwards).
  const [viewMonth, setViewMonth]       = useState<ViewMonth | null>(null)
  const [pastMonthEvents, setPastMonthEvents] = useState<NewsEvent[]>([])
  const [reloadKey, setReloadKey] = useState(0)

  const now = new Date()
  const currentMonthStart = monthStartISO(now.getFullYear(), now.getMonth())

  // The API sorts by date ascending, so without `from` the page filled up
  // with the oldest events and upcoming ones never loaded. Load everything
  // from the start of the current month on (every page).
  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    fetchAllEvents({ from: currentMonthStart })
      .then((data) => { if (!cancelled) { setAllEvents(data); setStatus('success') } })
      .catch(() => { if (!cancelled) setStatus('error') })
    return () => { cancelled = true }
  }, [currentMonthStart, reloadKey])

  const viewedMonthStart = viewMonth ? monthStartISO(viewMonth.year, viewMonth.month) : currentMonthStart
  const viewingPastMonth = viewedMonthStart < currentMonthStart

  useEffect(() => {
    // viewingPastMonth implies viewMonth is set.
    if (!viewingPastMonth || !viewMonth) return
    let cancelled = false
    const next = new Date(viewMonth.year, viewMonth.month + 1, 1)
    const to = monthStartISO(next.getFullYear(), next.getMonth())
    fetchAllEvents({ from: viewedMonthStart, to })
      .then((data) => { if (!cancelled) setPastMonthEvents(data) })
      .catch((err: unknown) => {
        if (cancelled) return
        console.error(err)
        setPastMonthEvents([])
        toast.error(t('events.monthError'))
      })
    return () => { cancelled = true }
  }, [viewingPastMonth, viewedMonthStart, viewMonth, t])

  const calendarEvents = viewingPastMonth ? pastMonthEvents : allEvents

  const today = todayISO()

  const upcomingEvents = useMemo(
    () => allEvents.filter((e) => e.date >= today),
    [allEvents, today]
  )

  const sidebarEvents = selectedDate
    ? calendarEvents.filter((e) => e.date === selectedDate)
    : upcomingEvents

  const selectedLabel = selectedDate
    ? formatDate(selectedDate, i18n.language, { weekday: 'long', month: 'long', day: 'numeric' })
    : null

  return (
    <div className="py-section-mobile lg:py-section">
      <div className="container-content">
        <NewsletterPageHeader current="events" title={t('events.pageTitle')} subtitle={t('events.pageSubtitle')} />

        {status === 'loading' && <LoadingState />}

        {status === 'error' && (
          <ErrorState message={t('events.error')} onRetry={() => setReloadKey((k) => k + 1)} />
        )}

        {status === 'success' && (
          <>
            <div className="flex flex-col lg:flex-row gap-8 lg:gap-10 lg:items-start">
              {/* Calendar */}
              <div className="lg:flex-1 lg:max-w-[580px]">
                <Calendar
                  events={calendarEvents}
                  selectedDate={selectedDate}
                  onSelectDate={setSelectedDate}
                  onMonthChange={(year: number, month: number) => setViewMonth({ year, month })}
                />
                {selectedDate && (
                  <button
                    type="button"
                    onClick={() => setSelectedDate(null)}
                    className="mt-1 min-h-[44px] font-mono text-label text-ink-secondary hover:text-primary transition-colors duration-150 underline underline-offset-2"
                  >
                    {t('events.clearSelection')}
                  </button>
                )}
              </div>

              {/* Sidebar */}
              <aside className="lg:w-80 xl:w-96 flex-shrink-0" aria-label={t('events.upcoming')}>
                <div className="bg-white dark:bg-night-surface rounded-card border border-border dark:border-night-border shadow-card">
                  <div className="px-5 py-4 border-b border-border dark:border-night-border">
                    <h2 className="font-display text-h5 font-bold text-ink-primary">
                      {selectedLabel
                        ? t('events.eventsOn', { date: selectedLabel })
                        : t('events.upcoming')}
                    </h2>
                  </div>
                  <div className="px-5">
                    {sidebarEvents.length === 0 ? (
                      <EmptyDayState selectedDate={selectedDate} t={t} />
                    ) : (
                      sidebarEvents.map((event) => (
                        <EventCard key={event.id} event={event} compact />
                      ))
                    )}
                  </div>
                </div>
              </aside>
            </div>

            {/* All events grid */}
            <section className="mt-14" aria-labelledby="all-events-heading">
              <h2
                id="all-events-heading"
                className="font-display text-h3 font-bold text-ink-primary mb-6"
              >
                {t('events.allEvents')}
              </h2>
              {allEvents.length === 0 ? (
                <EmptyState compact title={t('events.noEvents')} body={t('events.noEventsHint')} />
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {allEvents.map((event) => (
                    <EventCard key={event.id} event={event} />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}

interface EmptyDayStateProps {
  selectedDate: string | null
  t: TFunction
}

function EmptyDayState({ selectedDate, t }: EmptyDayStateProps) {
  return (
    <div className="py-10 flex flex-col items-center gap-3 text-center">
      <div className="relative w-12 h-12">
        <div className="absolute inset-0 rounded-full bg-border dark:bg-night-border" />
        <div className="absolute top-2 left-2 w-4 h-4 rotate-45 bg-accent-100 dark:bg-accent-900" />
      </div>
      <p className="font-body text-body-sm text-ink-secondary">
        {selectedDate ? t('events.noEventsOnDay') : t('events.noUpcoming')}
      </p>
    </div>
  )
}

function LoadingState() {
  return (
    <LoadingRegion className="flex flex-col gap-6">
      <div className="flex flex-col lg:flex-row gap-8 lg:gap-10">
        <div className="lg:flex-1 lg:max-w-[580px] skeleton rounded-card h-72" />
        <div className="lg:w-80 xl:w-96 skeleton rounded-card h-64" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">
        {[1,2,3].map((i) => (
          <div key={i} className="rounded-card border border-border dark:border-night-border p-5 flex flex-col gap-3">
            <div className="skeleton h-14 w-14 rounded-sm" />
            <div className="skeleton h-5 w-3/4 rounded-sm" />
            <div className="skeleton h-4 w-1/2 rounded-sm" />
          </div>
        ))}
      </div>
    </LoadingRegion>
  )
}
