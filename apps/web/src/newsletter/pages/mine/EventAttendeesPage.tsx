import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ApiError } from '@/api/client'
import { Button, EmptyState, ErrorState, LoadingRegion, Skeleton } from '@/components/ui'
import { fetchAttendees, fetchEventById } from '../../api/events'
import AdminSectionHeader from '../../components/admin/AdminSectionHeader'
import { localeFor } from '../../utils/dates'
import { newsletterPath } from '@/newsletter/paths'
import type { Attendee, NewsEvent } from '../../types'

// Quotes a CSV field when needed (RFC 4180). Names come from users' Google
// profiles: one starting with = + - @ (or a tab/CR) would run as a formula
// in Excel/Sheets, so it is prefixed with ' to stay text.
function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

// Who RSVP'd to an event, for the admins of its organization and, unless the
// admins turned that off, its plain members (the API answers 403 to anyone
// else), with a CSV export for the door list.
export default function EventAttendeesPage() {
  const { id = '' } = useParams()
  const { t, i18n } = useTranslation()
  const [event, setEvent] = useState<NewsEvent | null>(null)
  const [attendees, setAttendees] = useState<Attendee[] | null>(null)
  const [error, setError] = useState<'' | 'forbidden' | 'error'>('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setError('')
    setAttendees(null)
    Promise.all([fetchEventById(id), fetchAttendees(id)])
      .then(([e, a]) => { if (!cancelled) { setEvent(e); setAttendees(a) } })
      .catch((err: unknown) => {
        console.error('newsletter: attendees', err)
        if (!cancelled) setError(err instanceof ApiError && err.status === 403 ? 'forbidden' : 'error')
      })
    return () => { cancelled = true }
  }, [id, reloadKey])

  const back = { to: newsletterPath('/mine/events'), label: t('admin.eventForm.back') }

  if (error) {
    return (
      <ErrorState
        title={error === 'forbidden' ? t('admin.attendees.forbidden') : t('admin.attendees.loadError')}
        onRetry={error === 'forbidden' ? undefined : () => setReloadKey((k) => k + 1)}
        backTo={back.to}
        backLabel={back.label}
      />
    )
  }

  function exportCsv() {
    if (!attendees || !event) return
    const rows = [
      ['name', 'email', 'rsvp_at'],
      ...attendees.map((a) => [a.name ?? '', a.email ?? '', a.createdAt]),
    ]
    const csv = rows.map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n'
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${event.id}-anotados.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  const count = attendees?.length ?? 0

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <AdminSectionHeader
        title={t('admin.attendees.title')}
        subtitle={event
          ? (event.capacity != null
            ? t('admin.events.rsvpsOf', { count, capacity: event.capacity })
            : t('admin.events.rsvps', { count })) + ` · ${event.title}`
          : undefined}
        back={back}
        action={attendees && attendees.length > 0
          ? <Button variant="outline" onClick={exportCsv}>{t('admin.attendees.export')}</Button>
          : undefined}
      />

      {!attendees ? (
        <LoadingRegion className="flex flex-col gap-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
        </LoadingRegion>
      ) : attendees.length === 0 ? (
        <EmptyState title={t('admin.attendees.emptyTitle')} body={t('admin.attendees.empty')} />
      ) : (
        <ol className="flex flex-col list-none m-0 p-0 border border-border dark:border-night-border rounded-card bg-white dark:bg-night-surface divide-y divide-border dark:divide-night-border">
          {attendees.map((a, i) => (
            <li key={a.userId} className="flex items-center gap-3 p-3">
              <span className="w-8 font-mono text-label text-ink-secondary dark:text-night-muted tabular-nums">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="font-display text-body font-bold text-ink-primary dark:text-night-text truncate">{a.name || a.email}</p>
                {a.name && <p className="font-mono text-label text-ink-secondary dark:text-night-muted truncate">{a.email}</p>}
              </div>
              <time dateTime={a.createdAt} className="font-mono text-label text-ink-secondary dark:text-night-muted whitespace-nowrap">
                {new Date(a.createdAt).toLocaleDateString(localeFor(i18n.language), { day: '2-digit', month: 'short' })}
              </time>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
