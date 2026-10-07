import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

interface SectionHeaderProps {
  // Section name, e.g. "ITBA News"; links to `to`.
  title: string
  to: string
  // Second line under the title (tagline, current career, ...).
  subtitle?: string
  // Right-hand side: the section's own links and controls.
  children?: ReactNode
}

// The bar under the app Navbar that names the current section (scheduler,
// newsletter) and holds its navigation. Not sticky: only the Navbar is.
export default function SectionHeader({ title, to, subtitle, children }: SectionHeaderProps) {
  return (
    <div className="border-b border-border dark:border-night-border bg-white/60 dark:bg-night-raised">
      <div className="container-content min-h-[3.5rem] py-2 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <Link to={to} className="flex flex-col justify-center hover:opacity-80 transition-opacity duration-150">
          <span className="font-display text-body-lg font-bold text-ink-primary dark:text-night-text leading-tight">{title}</span>
          {subtitle && (
            <span className="font-mono text-label text-ink-secondary dark:text-night-muted uppercase tracking-widest leading-tight">
              {subtitle}
            </span>
          )}
        </Link>
        {children && <div className="flex flex-wrap items-center gap-x-6 gap-y-2">{children}</div>}
      </div>
    </div>
  )
}

