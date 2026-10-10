import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

// Heading of one admin section, under the layout's page title and tabs:
// optional back link, the section title (h2: the page h1 is the layout's),
// a subtitle and the section's main action. Leave `title` out when it would
// only repeat the active tab's label (one fact, one place).
export default function AdminSectionHeader({
  title,
  subtitle,
  back,
  badge,
  action,
}: {
  title?: ReactNode
  subtitle?: ReactNode
  back?: { to: string; label: string }
  // Shown next to the title (e.g. a status badge).
  badge?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      {back && (
        <Link
          to={back.to}
          className="self-start inline-flex items-center min-h-[44px] font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted hover:text-primary dark:hover:text-primary-300 transition-colors duration-150"
        >
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          {(title || badge) && (
            <div className="flex flex-wrap items-center gap-3">
              {title && <h2 className="font-display text-h3 font-bold text-ink-primary dark:text-night-text">{title}</h2>}
              {badge}
            </div>
          )}
          {subtitle && (
            <div className={`font-body text-body-sm text-ink-secondary dark:text-night-muted max-w-2xl ${title ? 'mt-1' : ''}`}>{subtitle}</div>
          )}
        </div>
        {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
      </div>
    </div>
  )
}
