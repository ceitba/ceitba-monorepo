import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '../Modal'
import ErrorBanner from '../ErrorBanner'
import { REPORT_REASONS, reportFile, type ReportReason } from '../../api/drive'
import { apuntesErrorMessage } from '../../utils/apuntes'
import { BTN_PRIMARY, INPUT } from './buttons'

const MAX_COMMENT = 1000

export default function ReportDialog({
  fileId,
  fileName,
  onClose,
  onReported,
}: {
  fileId: string
  fileName: string
  onClose: () => void
  onReported: () => void
}) {
  const { t } = useTranslation()
  const [reason, setReason] = useState<ReportReason | null>(null)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!reason) return
    setBusy(true); setError(null)
    try {
      await reportFile(fileId, { reason, comment: comment.trim() })
      onReported()
    } catch (err) {
      setError(apuntesErrorMessage(err, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={t('apuntes.report.title')} onClose={onClose} busy={busy} size="lg">
      <form onSubmit={submit} className="flex flex-col gap-4 font-body text-body-sm text-ink-primary dark:text-night-text">
        <p className="text-ink-secondary dark:text-night-muted">
          {t('apuntes.report.intro', { name: fileName })}
        </p>
        {error && <ErrorBanner onDismiss={() => setError(null)}>{error}</ErrorBanner>}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
            {t('apuntes.report.reason')}
          </legend>
          {REPORT_REASONS.map((r) => (
            <label key={r} className="flex items-start gap-3 cursor-pointer">
              <input
                type="radio"
                name="report-reason"
                value={r}
                checked={reason === r}
                onChange={() => setReason(r)}
                className="mt-1 h-4 w-4 accent-primary"
              />
              <span>{t(`apuntes.report.reasons.${r}`)}</span>
            </label>
          ))}
        </fieldset>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
            {t('apuntes.report.comment')}
          </span>
          <textarea
            value={comment}
            maxLength={MAX_COMMENT}
            onChange={(e) => setComment(e.target.value)}
            rows={4}
            placeholder={t('apuntes.report.commentPlaceholder')}
            className={INPUT}
          />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="px-3 py-1.5 font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted disabled:opacity-50"
          >
            {t('manage.cancel')}
          </button>
          <button type="submit" disabled={busy || !reason} className={BTN_PRIMARY}>
            {busy ? '…' : t('apuntes.report.submit')}
          </button>
        </div>
      </form>
    </Modal>
  )
}
