import type { ReactNode } from 'react'

// Geometric empty state from the editorial system (no stock illustration).
export default function EmptyState({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-5 text-center animate-fade-in">
      <div className="relative w-20 h-20" aria-hidden="true">
        <div className="absolute inset-0 rounded-full bg-primary-50 dark:bg-primary-900" />
        <div className="absolute top-3 left-3 w-8 h-8 rotate-45 bg-accent-100 dark:bg-accent-800" />
        <div className="absolute bottom-3 right-3 w-5 h-5 rounded-full bg-primary-200 dark:bg-primary-700" />
      </div>
      <div className="max-w-md">
        <p className="font-display text-h4 font-bold text-ink-primary dark:text-night-text">{title}</p>
        {body && <p className="font-body text-body text-ink-secondary dark:text-night-muted mt-1">{body}</p>}
      </div>
      {action}
    </div>
  )
}
