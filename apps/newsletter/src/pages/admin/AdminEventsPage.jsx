import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { fetchAllEvents, deleteEvent } from '../../api/events'
import { isStaff } from '../../store/authStore'
import CategoryBadge from '../../components/CategoryBadge'
import { formatDate, todayISO } from '../../utils/dates'

export default function AdminEventsPage() {
  const { t, i18n } = useTranslation()
  const staff = isStaff()
  const [events, setEvents]     = useState([])
  const [status, setStatus]     = useState('loading')
  const [confirmId, setConfirmId] = useState(null)
  const [deleteError, setDeleteError] = useState('')

  // Every event, all pages: the API caps a page at `limit` (default 50)
  // and the old single request silently dropped everything after it.
  function load() {
    setStatus('loading')
    fetchAllEvents()
      .then((data) => { setEvents(data); setStatus('success') })
      .catch(() => setStatus('error'))
  }

  useEffect(load, [])

  async function handleDelete(id) {
    setDeleteError('')
    try {
      await deleteEvent(id)
      setEvents((prev) => prev.filter((e) => e.id !== id))
    } catch {
      setDeleteError(t('admin.events.deleteError'))
    }
    setConfirmId(null)
  }

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center py-32" aria-busy="true">
        <p className="font-mono text-label text-ink-secondary uppercase tracking-widest">{t('admin.events.loading')}</p>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-4 text-center">
        <p className="font-display text-h5 font-bold text-ink-primary">{t('admin.events.loadError')}</p>
        <button type="button" onClick={load} className="min-h-[44px] px-5 bg-primary text-surface font-body font-semibold rounded-sm hover:bg-primary-600 transition-colors duration-150">
          {t('admin.common.retry')}
        </button>
      </div>
    )
  }

  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date))
  const today  = todayISO()

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-h3 font-bold text-ink-primary">{t('admin.events.title')}</h1>
          <p className="font-body text-body-sm text-ink-secondary mt-0.5">
            {t('admin.events.count', { count: events.length })}
          </p>
        </div>
        <Link
          to="/admin/events/new"
          className="inline-flex items-center gap-2 min-h-[44px] px-4 bg-primary text-surface font-body text-body-sm font-semibold rounded-sm hover:bg-primary-600 transition-colors duration-150 focus-visible:rounded"
        >
          <PlusIcon /> {t('admin.events.new')}
        </Link>
      </div>

      {deleteError && (
        <p role="alert" className="font-body text-body-sm text-red-600 bg-red-50 px-3 py-2 rounded-sm">
          {deleteError}
        </p>
      )}

      {sorted.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="bg-white rounded-card border border-border shadow-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="border-b border-border bg-surface">
                  <Th>{t('admin.events.columns.title')}</Th>
                  <Th>{t('admin.events.columns.dateTime')}</Th>
                  <Th>{t('admin.events.columns.category')}</Th>
                  <Th>{t('admin.events.columns.location')}</Th>
                  <Th>{t('admin.events.columns.organization')}</Th>
                  <Th><span className="sr-only">{t('admin.common.actions')}</span></Th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((event) => {
                  const isPast = event.date < today
                  return (
                    <tr
                      key={event.id}
                      className={['border-b border-border last:border-b-0 transition-colors duration-100', isPast ? 'opacity-50 bg-surface hover:opacity-70' : 'hover:bg-surface'].join(' ')}
                    >
                      <td className="px-4 py-3">
                        <span className="font-body text-body-sm font-semibold text-ink-primary line-clamp-1">{event.title}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-0.5">
                          <time className="font-mono text-label text-ink-primary" dateTime={event.date}>
                            {formatDate(event.date, i18n.language)}
                          </time>
                          <span className="font-mono text-label text-ink-secondary">{t('events.timeRange', { start: event.time, end: event.endTime })}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3"><CategoryBadge category={event.category} /></td>
                      <td className="px-4 py-3">
                        <span className="font-body text-body-sm text-ink-secondary line-clamp-1">{event.location}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-label text-ink-secondary uppercase tracking-widest">{event.organization}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 justify-end">
                          <Link to={`/admin/events/${event.id}/edit`} className="min-h-[36px] px-3 inline-flex items-center font-body text-body-sm text-primary hover:bg-primary-50 rounded-sm transition-colors duration-150">
                            {t('admin.common.edit')}
                          </Link>
                          {/* DELETE /news/events/{id} is STAFF-only on the API. */}
                          {staff && (confirmId === event.id ? (
                            <span className="flex items-center gap-1.5">
                              <button type="button" onClick={() => handleDelete(event.id)} className="min-h-[36px] px-3 font-body text-body-sm text-red-600 hover:bg-red-50 rounded-sm transition-colors duration-150">
                                {t('admin.common.confirm')}
                              </button>
                              <button type="button" onClick={() => setConfirmId(null)} className="min-h-[36px] px-2 font-body text-body-sm text-ink-secondary hover:bg-surface rounded-sm transition-colors duration-150">
                                {t('admin.common.cancel')}
                              </button>
                            </span>
                          ) : (
                            <button type="button" onClick={() => setConfirmId(event.id)} className="min-h-[36px] px-3 font-body text-body-sm text-ink-secondary hover:text-red-600 hover:bg-red-50 rounded-sm transition-colors duration-150">
                              {t('admin.common.delete')}
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function Th({ children }) {
  return <th className="px-4 py-3 text-left font-mono text-label uppercase tracking-widest text-ink-secondary">{children}</th>
}

function EmptyState() {
  const { t } = useTranslation()
  return (
    <div className="bg-white rounded-card border border-border shadow-card flex flex-col items-center justify-center py-20 gap-4 text-center">
      <div className="relative w-16 h-16">
        <div className="absolute inset-0 rounded-full bg-primary-50" />
        <div className="absolute top-3 left-3 w-8 h-8 rotate-45 bg-accent-100" />
      </div>
      <p className="font-display text-h5 font-bold text-ink-primary">{t('admin.events.emptyTitle')}</p>
      <p className="font-body text-body-sm text-ink-secondary">{t('admin.events.emptyMessage')}</p>
      <Link to="/admin/events/new" className="inline-flex items-center gap-2 min-h-[44px] px-5 bg-primary text-surface font-body text-body-sm font-semibold rounded-sm hover:bg-primary-600 transition-colors duration-150">
        <PlusIcon /> {t('admin.events.new')}
      </Link>
    </div>
  )
}

function PlusIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
}
