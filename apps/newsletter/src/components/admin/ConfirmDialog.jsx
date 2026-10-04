import { useRef } from 'react'
import { useDialogFocus } from '../../hooks/useDialogFocus'

// In-app confirmation modal (instead of window.confirm). `tone="danger"`
// paints the confirm button red for destructive actions.
export default function ConfirmDialog({
  title, children, confirmLabel, cancelLabel, busy = false, tone = 'primary', onConfirm, onClose,
}) {
  const cancelRef = useRef(null)
  useDialogFocus(cancelRef, () => { if (!busy) onClose() })

  const confirmClass = tone === 'danger'
    ? 'bg-red-600 hover:bg-red-700 text-white'
    : 'bg-primary hover:bg-primary-600 text-surface'

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="w-full max-w-md bg-white rounded-card shadow-card-hover p-6 flex flex-col gap-4 animate-fade-in"
      >
        <h2 id="confirm-dialog-title" className="font-display text-h4 font-bold text-ink-primary">{title}</h2>
        <div className="font-body text-body text-ink-secondary leading-relaxed">{children}</div>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            disabled={busy}
            className="min-h-[44px] px-5 bg-white border border-border text-ink-secondary font-body font-semibold rounded-sm hover:border-primary hover:text-primary transition-colors duration-150 disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`min-h-[44px] px-5 font-body font-semibold rounded-sm transition-colors duration-150 disabled:opacity-60 ${confirmClass}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
