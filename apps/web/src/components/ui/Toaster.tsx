import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { CloseIcon } from './Button'
import { buttonClass, iconButtonClass } from './buttonClass'
import { dismiss, subscribeToasts, toastSnapshot, type ToastTone } from './toastStore'

const BORDER: Record<ToastTone, string> = {
  success: 'border-l-emerald-500',
  error: 'border-l-red-500',
  info: 'border-l-primary',
}

export function Toaster() {
  const list = useSyncExternalStore(subscribeToasts, toastSnapshot, toastSnapshot)
  const { t } = useTranslation()
  return (
    <div className="fixed z-[60] bottom-4 inset-x-4 sm:inset-x-auto sm:right-4 sm:w-96 flex flex-col gap-2 pointer-events-none" aria-live="polite">
      {list.map((it) => (
        <div
          key={it.id}
          role={it.tone === 'error' ? 'alert' : 'status'}
          className={`pointer-events-auto flex items-start gap-2 pl-4 pr-1 py-1 rounded-sm border border-border border-l-4 dark:border-night-border bg-white dark:bg-night-surface shadow-card animate-fade-in ${BORDER[it.tone]}`}
        >
          <p className="flex-1 py-2.5 font-body text-body-sm text-ink-primary dark:text-night-text">{it.message}</p>
          {it.action && (
            <button
              type="button"
              onClick={() => { it.action?.onClick(); dismiss(it.id) }}
              className={buttonClass({ variant: 'ghost', size: 'sm', className: '!text-primary dark:!text-primary-300' })}
            >
              {it.action.label}
            </button>
          )}
          <button type="button" onClick={() => dismiss(it.id)} aria-label={t('ui.close')} className={iconButtonClass({ size: 'sm' })}>
            <CloseIcon size={16} />
          </button>
        </div>
      ))}
    </div>
  )
}
