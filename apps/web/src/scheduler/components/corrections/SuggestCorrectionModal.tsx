import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Button, CloseIcon, IconButton, Modal, inputClass } from '@/components/ui'
import SignInPrompt from './SignInPrompt'
import { useAuth } from '@/hooks/useAuth'
import { useCorrections } from '../../context/correctionsContext'
import type { Subject } from '../../hooks/useSubjects'
import type { Commission, CommissionCorrection } from '../../types/scheduler'
import { suggestCorrection, toCommissionCorrection, voteCorrection } from '../../api/corrections'
import {
  APPLY_THRESHOLD,
  MAX_SLOTS,
  MAX_TIME,
  MIN_TIME,
  SUGGESTION_DAYS,
  correctionErrorKey,
  draftFromSchedule,
  draftToSlots,
  formatSlots,
  sgaScheduleOf,
  validateDraft,
  type DraftSlot,
} from '../../services/corrections'

interface Props {
  subject: Subject
  commission: Commission
  onClose: () => void
}

type Phase =
  | { kind: 'edit' }
  // An identical pending suggestion already existed: offer to confirm it.
  | { kind: 'duplicate'; correction: CommissionCorrection }
  | { kind: 'done'; message: string }

// Day/time controls sit side by side, so they size to their content.
const field = (invalid: boolean) => inputClass({ invalid, className: '!w-auto' })

// Form to suggest a commission's real days/times, prefilled with what the
// app shows now. Rooms are read-only context (v1 only corrects day/time).
export default function SuggestCorrectionModal({ subject, commission, onClose }: Props) {
  const { t } = useTranslation()
  const { profile, loading } = useAuth()
  const corrections = useCorrections()
  const [draft, setDraft] = useState<DraftSlot[]>(() => draftFromSchedule(commission.schedule))
  const [showErrors, setShowErrors] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'edit' })

  const dayLabel = (day: string) => t(`days.${day}`)
  const sga = sgaScheduleOf(commission)
  const validation = validateDraft(draft, commission.schedule, sga)
  const report = (c: CommissionCorrection) =>
    corrections?.onCorrectionChange(subject.subject_id, commission.name, c)

  const update = (i: number, patch: Partial<DraftSlot>) => {
    setShowErrors(true)
    setDraft((d) => d.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  }
  const addSlot = () => {
    setDraft((d) => (d.length >= MAX_SLOTS ? d : [...d, { day: 'MONDAY', from: '', to: '', classroom: '', building: '' }]))
  }
  const removeSlot = (i: number) => {
    setShowErrors(true)
    setDraft((d) => d.filter((_, j) => j !== i))
  }

  async function submit() {
    setShowErrors(true)
    if (!validation.ok || !commission.commission_id) return
    setBusy(true)
    setError(null)
    try {
      const res = await suggestCorrection(commission.commission_id, draftToSlots(draft))
      const c = toCommissionCorrection(res.correction)
      report(c)
      if (res.created) setPhase({ kind: 'done', message: t('corrections.doneCreated', { threshold: APPLY_THRESHOLD }) })
      else if (c.my_vote === 'CONFIRM') setPhase({ kind: 'done', message: t('corrections.doneAlready') })
      else setPhase({ kind: 'duplicate', correction: c })
    } catch (e) {
      setError(t(`corrections.errors.${correctionErrorKey(e)}`))
    } finally {
      setBusy(false)
    }
  }

  async function confirmDuplicate(c: CommissionCorrection) {
    setBusy(true)
    setError(null)
    try {
      const updated = toCommissionCorrection(await voteCorrection(c.id, 'CONFIRM'))
      report(updated)
      setPhase({
        kind: 'done',
        message: updated.status === 'APPLIED'
          ? t('corrections.doneApplied', { threshold: APPLY_THRESHOLD })
          : t('corrections.doneConfirmed', { threshold: APPLY_THRESHOLD }),
      })
    } catch (e) {
      setError(t(`corrections.errors.${correctionErrorKey(e)}`))
    } finally {
      setBusy(false)
    }
  }

  const header = (
    <div className="font-body text-body-sm text-ink-secondary dark:text-night-muted">
      <div className="font-semibold text-ink-primary dark:text-night-text text-body">
        <span className="font-mono text-label">({subject.subject_id})</span> {subject.name}
      </div>
      <div>{t('corrections.detailCommission', { name: commission.name })}</div>
    </div>
  )

  const errorBox = error && <Alert tone="error">{error}</Alert>

  let body
  if (!loading && !profile) {
    body = (
      <div className="space-y-4">
        {header}
        <h4 className="font-body font-semibold text-body text-ink-primary dark:text-night-text">{t('corrections.signInTitle')}</h4>
        <SignInPrompt message={t('corrections.signInBody')} />
      </div>
    )
  } else if (phase.kind === 'done') {
    body = (
      <div className="space-y-4" role="status">
        {header}
        <h4 className="font-body font-semibold text-body text-ink-primary dark:text-night-text">{t('corrections.doneTitle')}</h4>
        <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{phase.message}</p>
        <div className="flex justify-end pt-2">
          <Button onClick={onClose}>{t('corrections.done')}</Button>
        </div>
      </div>
    )
  } else if (phase.kind === 'duplicate') {
    body = (
      <div className="space-y-4">
        {header}
        <p className="font-body text-body text-ink-primary dark:text-night-text">{t('corrections.duplicate')}</p>
        <p className="font-mono text-label text-ink-secondary dark:text-night-muted">
          {formatSlots(phase.correction.schedule, dayLabel)}
        </p>
        {errorBox}
        <div className="flex justify-end gap-2 pt-2 border-t border-border dark:border-night-border">
          <Button variant="ghost" onClick={onClose}>{t('corrections.cancel')}</Button>
          <Button onClick={() => confirmDuplicate(phase.correction)} loading={busy} loadingLabel={t('corrections.sending')}>
            {t('corrections.confirmDuplicate')}
          </Button>
        </div>
      </div>
    )
  } else {
    body = (
      <form
        className="space-y-4"
        noValidate
        onSubmit={(e) => { e.preventDefault(); submit() }}
      >
        {header}
        <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">
          {t('corrections.suggestIntro', { threshold: APPLY_THRESHOLD })}
        </p>
        <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">
          <span className="font-mono text-label uppercase tracking-widest">{t('corrections.sgaLabel')}:</span>{' '}
          {formatSlots(sga, dayLabel)}
        </p>

        <ol className="space-y-3">
          {draft.map((slot, i) => {
            const n = i + 1
            const slotError = showErrors ? validation.slotErrors[i] : null
            return (
              <li key={i} className="flex flex-col gap-1">
                <span className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
                  {t('corrections.slotLabel', { n })}
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={slot.day}
                    onChange={(e) => update(i, { day: e.target.value })}
                    aria-label={t('corrections.dayAria', { n })}
                    aria-invalid={!!slotError}
                    className={field(!!slotError)}
                  >
                    {SUGGESTION_DAYS.map((d) => (
                      <option key={d} value={d}>{t(`daysFull.${d}`)}</option>
                    ))}
                  </select>
                  <input
                    type="time"
                    value={slot.from}
                    min={MIN_TIME}
                    max={MAX_TIME}
                    step={300}
                    onChange={(e) => update(i, { from: e.target.value })}
                    aria-label={t('corrections.fromAria', { n })}
                    aria-invalid={!!slotError}
                    className={field(!!slotError)}
                  />
                  <span aria-hidden="true" className="text-ink-secondary dark:text-night-muted">–</span>
                  <input
                    type="time"
                    value={slot.to}
                    min={MIN_TIME}
                    max={MAX_TIME}
                    step={300}
                    onChange={(e) => update(i, { to: e.target.value })}
                    aria-label={t('corrections.toAria', { n })}
                    aria-invalid={!!slotError}
                    className={field(!!slotError)}
                  />
                  <IconButton
                    size="sm"
                    onClick={() => removeSlot(i)}
                    aria-label={t('corrections.removeSlot', { n })}
                  >
                    <CloseIcon size={16} />
                  </IconButton>
                </div>
                <span className="font-mono text-label text-ink-secondary dark:text-night-muted">
                  {slot.classroom ? t('corrections.classroom', { classroom: slot.classroom }) : t('corrections.noClassroom')}
                </span>
                {slotError && (
                  <span className="font-body text-body-sm text-red-700 dark:text-red-300">
                    {t(`corrections.slotErrors.${slotError}`, { min: MIN_TIME, max: MAX_TIME })}
                  </span>
                )}
              </li>
            )
          })}
        </ol>

        <div className="flex flex-wrap items-center gap-x-3">
          <Button variant="outline" size="sm" onClick={addSlot} disabled={draft.length >= MAX_SLOTS}>
            + {t('corrections.addSlot')}
          </Button>
          {draft.length >= MAX_SLOTS && (
            <span className="font-body text-label text-ink-secondary dark:text-night-muted">
              {t('corrections.formErrors.tooMany', { max: MAX_SLOTS })}
            </span>
          )}
        </div>

        {showErrors && validation.formError && (
          <p role="alert" className="font-body text-body-sm text-red-700 dark:text-red-300">
            {t(`corrections.formErrors.${validation.formError}`, { max: MAX_SLOTS })}
          </p>
        )}
        {errorBox}

        <div className="flex justify-end gap-2 pt-4 border-t border-border dark:border-night-border">
          <Button variant="ghost" onClick={onClose}>{t('corrections.cancel')}</Button>
          <Button type="submit" loading={busy} loadingLabel={t('corrections.sending')}>
            {t('corrections.submit')}
          </Button>
        </div>
      </form>
    )
  }

  return (
    <Modal onClose={onClose} busy={busy} title={t('corrections.suggestTitle')}>
      {body}
    </Modal>
  )
}
