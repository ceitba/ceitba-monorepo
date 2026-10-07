import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

// Green success counterpart of ErrorBanner (same shape as the inline notice
// in ManageCorrectionsSection).
export default function Notice({
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
      role="status"
      className={`flex items-start gap-3 px-3 py-2 rounded-sm border font-body text-body-sm bg-green-50 text-green-800 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-900 ${className}`}
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
