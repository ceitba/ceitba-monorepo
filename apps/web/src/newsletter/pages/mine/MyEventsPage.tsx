import { useState, useEffect, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { fetchAllEvents, deleteEvent } from '../../api/events'
import { isStaff } from '../../store/authStore'
import { useAuthSession } from '../../hooks/useAuthSession'
import CategoryBadge from '../../components/CategoryBadge'
import AdminSectionHeader from '../../components/admin/AdminSectionHeader'
import { TableCard, Th, rowClass, theadRowClass } from '../../components/admin/AdminTable'
import { useAdminContext } from '../../admin/adminContext'
import { formatDate, todayISO } from '../../utils/dates'
import { newsletterPath } from '@/newsletter/paths'
import { Button, ConfirmDialog, EmptyState, ErrorState, SkeletonTable, buttonClass } from '@/components/ui'
import type { NewsEvent } from '../../types'

const COLS = 6

export default function MyEventsPage() {
  const { t, i18n } = useTranslation()
  const { profile } = useAuthSession()
  const { orgName } = useAdminContext()
  const staff = isStaff(profile)
  const [events, setEvents]     = useState<NewsEvent[]>([])
  const [status, setStatus]     = useState<'loading' | 'success' | 'error'>('loading')
  const [toDelete, setToDelete] = useState<NewsEvent | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  // Every event, all pages: the API caps a page at `limit` (default 50)
  // and the old single request silently dropped everything after it.
  function load() {
    setStatus('loading')
    fetchAllEvents()
      .then((data) => { setEvents(data); setStatus('success') })
      .catch((err: unknown) => { console.error('newsletter admin: events', err); setStatus('error') })
  }

  useEffect(load, [])

  async function handleDelete() {
    if (!toDelete) return
    setDeleting(true)
    setDeleteError('')
    try {
      await deleteEvent(toDelete.id)
      setEvents((prev) => prev.filter((e) => e.id !== toDelete.id))
      setToDelete(null)
    } catch (err) {
      console.error('newsletter admin: delete event', err)
      setDeleteError(t('admin.events.deleteError'))
    } finally {
      setDeleting(false)
    }
  }

  // Upcoming first (soonest on top), then past events, most recent first.
  const today = todayISO()
  const byDateTime = (a: NewsEvent, b: NewsEvent) => `${a.date} ${a.time ?? ''}`.localeCompare(`${b.date} ${b.time ?? ''}`)
  const upcoming = events.filter((e) => e.date >= today).sort(byDateTime)
  const past = events.filter((e) => e.date < today).sort((a, b) => byDateTime(b, a))

  function renderRow(event: NewsEvent, isPast: boolean): ReactNode {
    const text = isPast ? 'text-ink-secondary dark:text-night-muted' : 'text-ink-primary dark:text-night-text'
    return (
      <tr key={event.id} className={rowClass}>
        <td className="px-4 py-3">
          <span className={`font-body text-body-sm font-semibold line-clamp-2 ${text}`}>{event.title}</span>
        </td>
        <td className="px-4 py-3">
          <div className="flex flex-col gap-0.5 whitespace-nowrap">
            <time className={`font-mono text-label ${text}`} dateTime={event.date}>
              {formatDate(event.date, i18n.language)}
            </time>
            <span className="font-mono text-label text-ink-secondary dark:text-night-muted">
              {t('events.timeRange', { start: (event.time ?? '').slice(0, 5), end: (event.endTime ?? '').slice(0, 5) })}
            </span>
          </div>
        </td>
        <td className="px-4 py-3"><CategoryBadge category={event.category} /></td>
        <td className="px-4 py-3">
          <span className="font-body text-body-sm text-ink-secondary dark:text-night-muted line-clamp-2">{event.location}</span>
        </td>
        <td className="px-4 py-3">
          <span className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{orgName(event.organization)}</span>
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-1 justify-end">
            <Link
              to={newsletterPath(`/mine/events/${event.id}/edit`)}
              className={buttonClass({ variant: 'ghost', size: 'sm' })}
              aria-label={t('admin.events.editAria', { title: event.title })}
            >
              {t('admin.common.edit')}
            </Link>
            {/* DELETE /news/events/{id} is STAFF-only on the API. */}
            {staff && (
              <Button
                variant="dangerGhost"
                size="sm"
                onClick={() => { setDeleteError(''); setToDelete(event) }}
                aria-label={t('admin.events.deleteAria', { title: event.title })}
              >
                {t('admin.common.delete')}
              </Button>
            )}
          </div>
        </td>
      </tr>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <AdminSectionHeader
        subtitle={status === 'success' ? t('admin.events.count', { count: events.length }) : undefined}
        action={
          <Link to={newsletterPath('/mine/events/new')} className={buttonClass()}>
            <PlusIcon /> {t('admin.events.new')}
          </Link>
        }
      />

      {status === 'loading' && <SkeletonTable rows={6} cols={COLS} />}

      {status === 'error' && <ErrorState title={t('admin.events.loadError')} onRetry={load} />}

      {status === 'success' && events.length === 0 && (
        <EmptyState title={t('admin.events.emptyTitle')} body={t('admin.events.emptyMessage')} />
      )}

      {status === 'success' && events.length > 0 && (
        <>
          {!staff && (
            <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('admin.events.deleteStaffOnly')}</p>
          )}
          <TableCard>
            <thead>
              <tr className={theadRowClass}>
                <Th>{t('admin.events.columns.title')}</Th>
                <Th>{t('admin.events.columns.dateTime')}</Th>
                <Th>{t('admin.events.columns.category')}</Th>
                <Th>{t('admin.events.columns.location')}</Th>
                <Th>{t('admin.events.columns.organization')}</Th>
                <Th><span className="sr-only">{t('admin.common.actions')}</span></Th>
              </tr>
            </thead>
            <tbody>
              {upcoming.length === 0 && (
                <tr className="border-b border-border dark:border-night-border">
                  <td colSpan={COLS} className="px-4 py-4 font-body text-body-sm text-ink-secondary dark:text-night-muted">
                    {t('admin.events.noUpcoming')}
                  </td>
                </tr>
              )}
              {upcoming.map((e) => renderRow(e, false))}
              {past.length > 0 && (
                <tr className="border-b border-border dark:border-night-border bg-page-bg dark:bg-night-raised">
                  <th scope="rowgroup" colSpan={COLS} className="px-4 py-2 text-left font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
                    {t('admin.events.past')}
                  </th>
                </tr>
              )}
              {past.map((e) => renderRow(e, true))}
            </tbody>
          </TableCard>
        </>
      )}

      {toDelete && (
        <ConfirmDialog
          title={t('admin.events.deleteDialog.title')}
          body={t('admin.events.deleteDialog.body', { title: toDelete.title })}
          confirmLabel={t('admin.events.deleteDialog.confirm')}
          busy={deleting}
          error={deleteError || undefined}
          onConfirm={handleDelete}
          onCancel={() => setToDelete(null)}
        />
      )}
    </div>
  )
}

function PlusIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
}
