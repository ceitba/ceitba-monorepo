import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import CategoryBadge from './CategoryBadge'
import { formatDate, parseLocalDate } from '../utils/dates'
import type { IsoDate, IsoTime } from '../types'

// The fields shown; fits both API events (NewsEvent) and the mock's
// StoredEvent.
interface EventCardEvent {
  title: string
  date: IsoDate
  time?: IsoTime | null
  endTime?: IsoTime | null
  location?: string | null
  category: string
  description?: string | null
}

interface EventCardProps {
  event: EventCardEvent
  compact?: boolean
  // Detail page; the whole card becomes the link (stretched over the title).
  to?: string
  // Organization name, shown above the title.
  orgName?: string | null
  // Signed-in user's RSVP.
  going?: boolean
}

// The title, as a link stretched over the card when `to` is set.
function Title({ to, className, children }: { to?: string; className: string; children: string }) {
  if (!to) return <h3 className={className}>{children}</h3>
  return (
    <h3 className={className}>
      <Link to={to} className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:rounded-card focus-visible:after:ring-2 focus-visible:after:ring-primary">
        {children}
      </Link>
    </h3>
  )
}

export default function EventCard({ event, compact = false, to, orgName, going = false }: EventCardProps) {
  const { t, i18n } = useTranslation()
  const { title, date, time, endTime, location, category, description } = event
  const day = parseLocalDate(date)
  const monthShort = formatDate(date, i18n.language, { month: 'short' })
  const timeRange = t('events.timeRange', { start: (time ?? '').slice(0, 5), end: (endTime ?? '').slice(0, 5) })

  if (compact) {
    return (
      <article className="group relative flex gap-4 py-4 border-b border-border dark:border-night-border last:border-b-0">
        {/* Date block */}
        <div className="flex-shrink-0 w-12 flex flex-col items-center justify-start pt-0.5">
          <span className="font-mono text-label text-ink-secondary uppercase">
            {monthShort}
          </span>
          <span className="font-display text-h3 font-bold text-primary leading-none tabular-nums">
            {day?.getDate()}
          </span>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2 flex-wrap">
            <Title to={to} className="font-display text-body-lg font-bold text-ink-primary leading-snug group-hover:text-primary transition-colors duration-150 flex-1 min-w-0">
              {title}
            </Title>
            <CategoryBadge category={category} className="flex-shrink-0" />
          </div>

          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <time className="font-mono text-label text-ink-secondary" dateTime={`${date}T${time}`}>
              {timeRange}
            </time>
            <span className="text-border dark:text-night-muted" aria-hidden="true">·</span>
            <span className="font-body text-body-sm text-ink-secondary truncate">
              {location}
            </span>
          </div>
        </div>
      </article>
    )
  }

  return (
    <article className="group relative rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface p-5 shadow-card hover:shadow-card-hover transition-shadow duration-200 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        {/* Date stamp */}
        <div className="flex-shrink-0 w-14 h-14 rounded-sm bg-primary-50 dark:bg-primary-800 flex flex-col items-center justify-center border border-primary-100 dark:border-primary-800">
          <span className="font-mono text-label text-primary-500 dark:text-primary-300 uppercase">
            {monthShort}
          </span>
          <span className="font-display text-h4 font-bold text-primary leading-none tabular-nums">
            {day?.getDate()}
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <CategoryBadge category={category} />
            {going && (
              <span className="font-mono text-label uppercase tracking-widest text-emerald-700 dark:text-emerald-300">{t('events.going')}</span>
            )}
          </div>
          {orgName && (
            <p className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted mt-1 truncate">{orgName}</p>
          )}
          <Title to={to} className="font-display text-h5 font-bold text-ink-primary mt-1 leading-snug group-hover:text-primary transition-colors duration-150">
            {title}
          </Title>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <time className="font-mono text-label text-ink-secondary" dateTime={`${date}T${time}`}>
          {formatDate(date, i18n.language, { weekday: 'short', month: 'short', day: 'numeric' })} · {timeRange}
        </time>
      </div>

      <div className="flex items-center gap-1.5 text-ink-secondary">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
        <span className="font-body text-body-sm">{location}</span>
      </div>

      {description && (
        <p className="font-body text-body-sm text-ink-secondary leading-relaxed line-clamp-2">
          {description}
        </p>
      )}
    </article>
  )
}
