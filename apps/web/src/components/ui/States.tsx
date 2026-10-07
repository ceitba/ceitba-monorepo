import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import Button from './Button'
import { buttonClass } from './buttonClass'

// Geometric empty state from the editorial system (no stock illustration).
// Always say what will appear here and, when there is one, offer the first
// step as `action`.
export function EmptyState({
  title,
  body,
  action,
  compact = false,
}: {
  title: ReactNode
  body?: ReactNode
  action?: ReactNode
  // Smaller variant for table bodies and side panels.
  compact?: boolean
}) {
  return (
    <div className={`flex flex-col items-center justify-center text-center animate-fade-in ${compact ? 'py-8 gap-3' : 'py-16 gap-5'}`}>
      {!compact && (
        <div className="relative w-20 h-20" aria-hidden="true">
          <div className="absolute inset-0 rounded-full bg-primary-50 dark:bg-primary-900" />
          <div className="absolute top-3 left-3 w-8 h-8 rotate-45 bg-accent-100 dark:bg-accent-800" />
          <div className="absolute bottom-3 right-3 w-5 h-5 rounded-full bg-primary-200 dark:bg-primary-700" />
        </div>
      )}
      <div className="max-w-md">
        <p className={`font-display font-bold text-ink-primary dark:text-night-text ${compact ? 'text-h5' : 'text-h4'}`}>{title}</p>
        {body && <div className="font-body text-body-sm text-ink-secondary dark:text-night-muted mt-1">{body}</div>}
      </div>
      {action}
    </div>
  )
}

// Something failed to load. Says so (never pretends there is no content),
// and always offers a way forward: retry, go back, or both.
export function ErrorState({
  title,
  message,
  onRetry,
  backTo,
  backLabel,
  compact = false,
}: {
  title?: ReactNode
  // Human copy only; never pass raw server messages here.
  message?: ReactNode
  onRetry?: () => void
  backTo?: string
  backLabel?: string
  compact?: boolean
}) {
  const { t } = useTranslation()
  return (
    <div
      role="alert"
      className={`flex flex-col items-center gap-3 px-6 rounded-card border border-dashed border-border dark:border-night-border text-center ${compact ? 'py-6' : 'py-12'}`}
    >
      <div className="w-10 h-10 rounded-full bg-red-50 dark:bg-red-950/40 flex items-center justify-center text-red-600 dark:text-red-300" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" strokeWidth="2.5" />
        </svg>
      </div>
      <div className="max-w-md">
        <p className="font-display font-bold text-h5 text-ink-primary dark:text-night-text">{title ?? t('errors.somethingWrong')}</p>
        {message && <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted mt-1">{message}</p>}
      </div>
      {(onRetry || backTo) && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {onRetry && <Button variant="outline" onClick={onRetry}>{t('errors.retry')}</Button>}
          {backTo && <Link to={backTo} className={buttonClass({ variant: 'ghost' })}>{backLabel ?? t('ui.back')}</Link>}
        </div>
      )}
    </div>
  )
}
