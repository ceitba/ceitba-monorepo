import { useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from './Modal'

export interface ConfirmDialogProps {
  title: ReactNode
  body: ReactNode
  confirmLabel: string
  cancelLabel?: string
  // Red confirm button for destructive actions (default); primary otherwise.
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

// Reusable confirmation dialog for destructive /manage actions. Cancel gets
// initial focus so Enter/Space never confirms by accident.
export default function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel,
  danger = true,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation()
  const cancelRef = useRef<HTMLButtonElement>(null)

  return (
    <Modal
      title={title}
      onClose={onCancel}
      busy={busy}
      initialFocusRef={cancelRef}
      footer={
        <>
          <button
            ref={cancelRef}
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="px-3 py-1.5 font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted disabled:opacity-50"
          >
            {cancelLabel ?? t('manage.cancel')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`px-3 py-1.5 rounded-sm text-white font-mono text-label uppercase tracking-widest disabled:opacity-50 ${
              danger ? 'bg-red-600 hover:bg-red-700' : 'bg-primary hover:bg-primary-600'
            }`}
          >
            {busy ? '…' : confirmLabel}
          </button>
        </>
      }
    >
      <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{body}</p>
    </Modal>
  )
}
