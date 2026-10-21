import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '../Modal'
import { Alert, Button, Field, textareaClass } from '../ui'
import { REPORT_REASONS, reportFile } from '../../api/drive'
import { apuntesErrorCopy } from './errorCopy'

const MAX_COMMENT = 1000

// Report dialog shared by files (default reasons + reportFile) and wiki
// pages (pass `reasons`, `onSubmit`, `title`, `intro`). Reason labels come
// from apuntes.report.reasons.<REASON>.
export default function ReportDialog<R extends string = string>({
  fileId,
  fileName,
  onClose,
  onReported,
  reasons,
  onSubmit,
  title,
  intro,
  initialReason,
  initialComment,
}: {
  fileId?: string
  fileName: string
  onClose: () => void
  onReported: () => void
  reasons?: readonly R[]
  onSubmit?: (reason: R, comment: string) => Promise<void>
  title?: string
  intro?: string
  initialReason?: R
  initialComment?: string
}) {
  const { t } = useTranslation()
  const reasonList = (reasons ?? REPORT_REASONS) as readonly R[]
  const [reason, setReason] = useState<R | null>(initialReason ?? null)
  const [comment, setComment] = useState(initialComment ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!reason) return
    setBusy(true); setError(null)
    try {
      if (onSubmit) await onSubmit(reason, comment.trim())
      else if (fileId) await reportFile(fileId, { reason: reason as never, comment: comment.trim() })
      onReported()
    } catch (err) {
      setError(apuntesErrorCopy(err, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={title ?? t('apuntes.report.title')} onClose={onClose} busy={busy} size="lg">
      <form onSubmit={submit} className="flex flex-col gap-4 font-body text-body-sm text-ink-primary dark:text-night-text">
        <p className="text-ink-secondary dark:text-night-muted">
          {intro ?? t('apuntes.report.intro', { name: fileName })}
        </p>
        {error && <Alert tone="error" onDismiss={() => setError(null)}>{error}</Alert>}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
            {t('apuntes.report.reason')}
          </legend>
          {reasonList.map((r) => (
            <label key={r} className="flex items-center gap-3 min-h-[44px] cursor-pointer">
              <input
                type="radio"
                name="report-reason"
                value={r}
                checked={reason === r}
                onChange={() => setReason(r)}
                className="h-4 w-4 accent-primary shrink-0"
              />
              <span>{t(`apuntes.report.reasons.${r}`)}</span>
            </label>
          ))}
        </fieldset>
        <Field label={t('apuntes.report.comment')}>
          {(p) => (
            <textarea
              {...p}
              value={comment}
              maxLength={MAX_COMMENT}
              onChange={(e) => setComment(e.target.value)}
              rows={4}
              placeholder={t('apuntes.report.commentPlaceholder')}
              className={textareaClass()}
            />
          )}
        </Field>
        <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
          {!reason && (
            <p className="mr-auto font-body text-label text-ink-secondary dark:text-night-muted">{t('apuntes.report.needReason')}</p>
          )}
          <Button variant="ghost" disabled={busy} onClick={onClose}>{t('ui.cancel')}</Button>
          <Button type="submit" disabled={!reason} loading={busy}>{t('apuntes.report.submit')}</Button>
        </div>
      </form>
    </Modal>
  )
}
