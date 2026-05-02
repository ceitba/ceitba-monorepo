import { useState, useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import Calendar from '../components/Calendar'
import EventCard from '../components/EventCard'
import { fetchEvents } from '../api/events'

export default function EventsPage() {
  const { t, i18n } = useTranslation()
  const [selectedDate, setSelectedDate] = useState(null)
  const [allEvents, setAllEvents]       = useState([])
  const [status, setStatus]             = useState('loading')

  useEffect(() => {
    fetchEvents()
      .then(({ data }) => { setAllEvents(data); setStatus('success') })
      .catch(() => setStatus('error'))
  }, [])

  const today = new Date().toISOString().slice(0, 10)

  const upcomingEvents = useMemo(
    () => allEvents.filter((e) => e.date >= today),
    [allEvents, today]
  )

  const sidebarEvents = selectedDate
    ? allEvents.filter((e) => e.date === selectedDate)
    : upcomingEvents

  const selectedLabel = selectedDate
    ? new Date(selectedDate).toLocaleDateString(
        i18n.language === 'en' ? 'en-US' : 'es-AR',
        { weekday: 'long', month: 'long', day: 'numeric' }
      )
    : null

  return (
    <div className="py-section-mobile lg:py-section">
      <div className="container-content">
        <header className="mb-8 lg:mb-12">
          <h1 className="font-display text-h1 lg:text-display font-bold text-ink-primary leading-tight">
            {t('events.pageTitle')}
          </h1>
          <p className="font-body text-body-lg text-ink-secondary mt-2">
            {t('events.pageSubtitle')}
          </p>
        </header>

        {status === 'loading' && <LoadingState />}

        {status === 'error' && (
          <p role="alert" className="font-body text-body text-ink-secondary">
            {t('articles.error.message')}
          </p>
        )}

        {status === 'success' && (
          <>
            <div className="flex flex-col lg:flex-row gap-8 lg:gap-10 lg:items-start">
              {/* Calendar */}
              <div className="lg:flex-1 lg:max-w-[580px]">
                <Calendar
                  events={allEvents}
                  selectedDate={selectedDate}
                  onSelectDate={setSelectedDate}
                />
                {selectedDate && (
                  <button
                    type="button"
                    onClick={() => setSelectedDate(null)}
                    className="mt-3 font-mono text-label text-ink-secondary hover:text-primary transition-colors duration-150 underline underline-offset-2"
                  >
                    {t('events.clearSelection')}
                  </button>
                )}
              </div>

              {/* Sidebar */}
              <aside className="lg:w-80 xl:w-96 flex-shrink-0" aria-label={t('events.upcoming')}>
                <div className="bg-white rounded-card border border-border shadow-card">
                  <div className="px-5 py-4 border-b border-border">
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
                <p className="font-body text-body text-ink-secondary">{t('events.noEvents')}</p>
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

function EmptyDayState({ selectedDate, t }) {
  return (
    <div className="py-10 flex flex-col items-center gap-3 text-center animate-fade-in">
      <div className="relative w-12 h-12">
        <div className="absolute inset-0 rounded-full bg-border" />
        <div className="absolute top-2 left-2 w-4 h-4 rotate-45 bg-accent-100" />
      </div>
      <p className="font-body text-body-sm text-ink-secondary">
        {selectedDate ? t('events.noEventsOnDay') : t('events.noUpcoming')}
      </p>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <div className="flex flex-col lg:flex-row gap-8 lg:gap-10">
        <div className="lg:flex-1 lg:max-w-[580px] skeleton rounded-card h-72" />
        <div className="lg:w-80 xl:w-96 skeleton rounded-card h-64" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">
        {[1,2,3].map((i) => (
          <div key={i} className="rounded-card border border-border p-5 flex flex-col gap-3">
            <div className="skeleton h-14 w-14 rounded-sm" />
            <div className="skeleton h-5 w-3/4 rounded" />
            <div className="skeleton h-4 w-1/2 rounded" />
          </div>
        ))}
      </div>
    </div>
  )
}
