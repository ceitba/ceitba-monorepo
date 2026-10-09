import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { CloseIcon } from './Button'
import { iconButtonClass } from './buttonClass'

export type AlertTone = 'error' | 'success' | 'warning' | 'info'

const TONES: Record<AlertTone, string> = {
  error:   'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900',
  success: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900',
  warning: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900',
  info:    'bg-primary-50 text-primary-700 border-primary-100 dark:bg-primary-900/40 dark:text-primary-200 dark:border-primary-800',
}

// Inline banner for errors, confirmations and notices. Errors that can be
// recovered from pass `action` (e.g. a Reintentar button) so the user is
// never left with only a dismiss ×.
export default function Alert({
  tone = 'info',
  title,
  children,
  action,
  onDismiss,
  className = '',
}: {
  tone?: AlertTone
  title?: ReactNode
  children?: ReactNode
  action?: ReactNode
  onDismiss?: () => void
  className?: string
}) {
  const { t } = useTranslation()
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex flex-wrap items-start gap-x-3 gap-y-2 pl-3 pr-1 py-1 rounded-sm border font-body text-body-sm ${TONES[tone]} ${className}`}
    >
      <div className="flex-1 min-w-[12rem] py-1.5">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div>{children}</div>}
      </div>
      {action && <div className="flex items-center gap-2 py-0.5">{action}</div>}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('errors.dismiss')}
          className={iconButtonClass({ size: 'sm', className: '!text-current opacity-70 hover:opacity-100 hover:!bg-transparent' })}
        >
          <CloseIcon size={16} />
        </button>
      )}
    </div>
  )
}
