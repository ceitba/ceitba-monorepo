import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Button, Field, Modal, inputClass } from '@/components/ui'

interface Props {
  count: number
  max: number
  defaultName?: string
  busy?: boolean
  // Translated message of the last failed save, shown inside the dialog.
  error?: string | null
  onSave: (name: string) => void
  onClose: () => void
}

// Saves the workspace to the account under a name. Shows the X/MAX usage;
// the cap is enforced server-side, this only avoids a request we already
// know will fail. Render it only while open.
export default function SaveScheduleDialog({ count, max, defaultName = '', busy = false, error = null, onSave, onClose }: Props) {
  const { t } = useTranslation()
  const [name, setName] = useState(defaultName)

  const trimmed = name.trim()
  const atLimit = count >= max
  const canSubmit = trimmed.length > 0 && !atLimit

  return (
    <Modal
      title={t('saved.dialogTitle')}
      size="sm"
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{t('ui.cancel')}</Button>
          <Button type="submit" form="save-schedule-form" disabled={!canSubmit} loading={busy}>
            {t('saved.save')}
          </Button>
        </>
      }
    >
      <p className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted -mt-2">
        {t('saved.usage', { count, max })}
      </p>

      {atLimit && <Alert tone="warning">{t('saved.limitReached', { max })}</Alert>}

      <form
        id="save-schedule-form"
        noValidate
        onSubmit={(e) => { e.preventDefault(); if (canSubmit && !busy) onSave(trimmed) }}
      >
        <Field label={t('saved.nameLabel')} hint={atLimit ? undefined : t('saved.nameHint')}>
          {(p) => (
            <input
              {...p}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={atLimit}
              maxLength={120}
              placeholder={t('saved.namePlaceholder')}
              className={inputClass()}
            />
          )}
        </Field>
      </form>

      {error && <Alert tone="error">{error}</Alert>}
    </Modal>
  )
}
