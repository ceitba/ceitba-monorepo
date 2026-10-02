import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

// Inline error banner shared by /manage, /profile and the auth-error notice.
// Optional dismiss button; colours have dark-mode variants.
export default function ErrorBanner({
  children,
  onDismiss,
  className = '',
}: {
  children: ReactNode
  onDismiss?: () => void
  className?: string
}) {
  const { t } = useTranslation()
  return (
    <div
      role="alert"
      className={`flex items-start gap-3 px-3 py-2 rounded-sm border font-body text-body-sm bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900 ${className}`}
    >
      <p className="flex-1">{children}</p>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('errors.dismiss')}
          className="flex-shrink-0 leading-none text-h5 opacity-70 hover:opacity-100"
        >
          ×
        </button>
      )}
    </div>
  )
}
