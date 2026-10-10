import { useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from './Modal'
import Button from './ui/Button'

export interface ConfirmDialogProps {
  title: ReactNode
  body: ReactNode
  // Name the consequence: "Sí, eliminar", "Enviar a 1.240 personas".
  confirmLabel: string
  cancelLabel?: string
  // Red confirm button for destructive actions (default); primary otherwise.
  danger?: boolean
  busy?: boolean
  // Shown inside the dialog when the action failed, so the user can retry
  // without starting over.
  error?: ReactNode
  onConfirm: () => void
  onCancel: () => void
}

// The site's single confirmation pattern. Only for actions that can't be
// undone (deleting, sending, revoking): reversible changes don't ask.
// Cancel gets initial focus so Enter/Space never confirms by accident.
export default function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel,
  danger = true,
  busy = false,
  error,
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
          <Button ref={cancelRef} variant="ghost" disabled={busy} onClick={onCancel}>
            {cancelLabel ?? t('ui.cancel')}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{body}</div>
      {error && (
        <p role="alert" className="font-body text-body-sm text-red-700 dark:text-red-300">{error}</p>
      )}
    </Modal>
  )
}
