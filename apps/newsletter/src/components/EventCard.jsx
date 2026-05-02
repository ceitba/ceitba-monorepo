import CategoryBadge from './CategoryBadge'

function formatEventDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

export default function EventCard({ event, compact = false }) {
  const { title, date, time, endTime, location, category, description } = event

  if (compact) {
    return (
      <article className="group flex gap-4 py-4 border-b border-border last:border-b-0 animate-fade-in">
        {/* Date block */}
        <div className="flex-shrink-0 w-12 flex flex-col items-center justify-start pt-0.5">
          <span className="font-mono text-label text-ink-secondary uppercase">
            {new Date(date).toLocaleDateString('en-US', { month: 'short' })}
          </span>
          <span className="font-display text-h3 font-bold text-primary leading-none tabular-nums">
            {new Date(date).getDate()}
          </span>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2 flex-wrap">
            <h3 className="font-display text-body-lg font-bold text-ink-primary leading-snug group-hover:text-primary transition-colors duration-150 flex-1 min-w-0">
              {title}
            </h3>
            <CategoryBadge category={category} className="flex-shrink-0" />
          </div>

          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <time className="font-mono text-label text-ink-secondary" dateTime={`${date}T${time}`}>
              {time}–{endTime}
            </time>
            <span className="text-border" aria-hidden="true">·</span>
            <span className="font-body text-body-sm text-ink-secondary truncate">
              {location}
            </span>
          </div>
        </div>
      </article>
    )
  }

  return (
    <article className="group rounded-card border border-border bg-white p-5 shadow-card hover:shadow-card-hover transition-shadow duration-200 flex flex-col gap-3 animate-fade-in">
      <div className="flex items-start gap-3">
        {/* Date stamp */}
        <div className="flex-shrink-0 w-14 h-14 rounded-sm bg-primary-50 flex flex-col items-center justify-center border border-primary-100">
          <span className="font-mono text-label text-primary-500 uppercase">
            {new Date(date).toLocaleDateString('en-US', { month: 'short' })}
          </span>
          <span className="font-display text-h4 font-bold text-primary leading-none tabular-nums">
            {new Date(date).getDate()}
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <CategoryBadge category={category} />
          <h3 className="font-display text-h5 font-bold text-ink-primary mt-1 leading-snug group-hover:text-primary transition-colors duration-150">
            {title}
          </h3>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <time className="font-mono text-label text-ink-secondary" dateTime={`${date}T${time}`}>
          {formatEventDate(date)} · {time}–{endTime}
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
