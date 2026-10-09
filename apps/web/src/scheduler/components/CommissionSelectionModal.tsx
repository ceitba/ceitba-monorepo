import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Button, Modal } from '@/components/ui'
import CorrectionStatus from './corrections/CorrectionStatus'
import SuggestCorrectionModal from './corrections/SuggestCorrectionModal'
import { Subject } from '../hooks/useSubjects'
import { Commission, CommissionSchedule } from '../types/scheduler'

type Turn = 'morning' | 'afternoon' | 'evening'
const ALL_TURNS: Turn[] = ['morning', 'afternoon', 'evening']

// A commission can occupy multiple turns (e.g. a slot at 09:00 + a slot at
// 14:00 belongs to morning AND afternoon). The earliest hour of each slot
// decides which turn that slot lives in.
const turnOf = (hour: number): Turn =>
  hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'

const turnsForCommission = (c: Commission): Set<Turn> => {
  const turns = new Set<Turn>()
  for (const s of c.schedule ?? []) {
    const hour = parseInt(s.time_from.slice(0, 2), 10)
    if (!Number.isNaN(hour)) turns.add(turnOf(hour))
  }
  return turns
}

// "YYYY-MM-DD" → "DD/MM/YYYY" without going through Date (no time zone shift).
const formatDay = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`

// Selection and turn filters start fresh on mount: render it only while
// open and key it by subject so each subject gets a clean modal.
interface CommissionSelectionModalProps {
  onClose: () => void
  subject: Subject
  onAddCommissions: (commissions: string[]) => void
}

const CommissionSelectionModal: React.FC<CommissionSelectionModalProps> = ({
  onClose,
  subject,
  onAddCommissions,
}) => {
  const { t } = useTranslation()
  const [selectedCommissions, setSelectedCommissions] = useState<string[]>([])
  const [activeTurns, setActiveTurns] = useState<Set<Turn>>(new Set(ALL_TURNS))
  // Commission whose schedule the student is correcting; the suggestion
  // form takes this dialog's place until it closes (no stacked modals).
  const [suggestFor, setSuggestFor] = useState<string | null>(null)
  const validCommissions = useMemo(
    () => subject.commissions.filter((comm) => comm.schedule?.length > 0),
    [subject.commissions],
  )
  const visibleCommissions = useMemo(
    () =>
      validCommissions.filter((c) => {
        const turns = turnsForCommission(c)
        for (const t of turns) if (activeTurns.has(t)) return true
        return false
      }),
    [validCommissions, activeTurns],
  )

  const toggleTurn = (turn: Turn) => {
    setActiveTurns((prev) => {
      const next = new Set(prev)
      if (next.has(turn)) {
        // Don't let the user disable the last filter — that would empty the list.
        if (next.size === 1) return prev
        next.delete(turn)
      } else {
        next.add(turn)
      }
      return next
    })
  }

  const handleCommissionToggle = (commissionName: string) => {
    setSelectedCommissions(prev =>
      prev.includes(commissionName)
        ? prev.filter(c => c !== commissionName)
        : [...prev, commissionName]
    )
  }

  const handleSelectAll = () => {
    onAddCommissions(visibleCommissions.map(c => c.name))
    onClose()
  }

  const handleAddCommissions = () => {
    if (selectedCommissions.length > 0) {
      onAddCommissions(selectedCommissions)
      onClose()
    }
  }

  const formatSchedule = (schedule: CommissionSchedule[]) => {
    return schedule.map(s => {
      const location = s.building ? ` | ${s.classroom}` : ` | ${t('commission.virtual')}`
      return `${t(`days.${s.day}`)}. ${s.time_from.slice(0, 5)} - ${s.time_to.slice(0, 5)}${location}`
    }).join('\n')
  }

  const suggestCommission = suggestFor ? subject.commissions.find((c) => c.name === suggestFor) : undefined
  if (suggestCommission) {
    return (
      <SuggestCorrectionModal
        subject={subject}
        commission={suggestCommission}
        onClose={() => setSuggestFor(null)}
      />
    )
  }

  const noneSelected = selectedCommissions.length === 0

  return (
    <Modal
      onClose={onClose}
      title={t('commission.title')}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant="outline" onClick={handleSelectAll} disabled={visibleCommissions.length === 0}>
            {t('commission.addAll')}
          </Button>
          <Button onClick={handleAddCommissions} disabled={noneSelected}>
            {noneSelected ? t('commission.addSelectedNone') : t('commission.addSelected', { count: selectedCommissions.length })}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="font-body text-body-sm text-ink-secondary dark:text-night-muted">
          <div className="font-semibold text-ink-primary dark:text-night-text text-body mb-1">
            <span className="font-mono text-label text-ink-secondary dark:text-night-muted">({subject.subject_id})</span>{' '}
            {subject.name}
          </div>
          <p>{t('commission.selectHint')}</p>
        </div>

        {subject.past_term && (
          <Alert tone="warning" title={t('commission.pastTermTitle')}>
            {t('commission.pastTerm', { from: formatDay(subject.course_start), to: formatDay(subject.course_end) })}
          </Alert>
        )}

        <div className="flex flex-wrap gap-2 items-center" role="group" aria-label={t('commission.turnFilterLabel')}>
          <span className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted mr-1">
            {t('commission.turnFilterLabel')}
          </span>
          {ALL_TURNS.map((turn) => {
            const active = activeTurns.has(turn)
            return (
              <Button
                key={turn}
                size="sm"
                variant={active ? 'primary' : 'outline'}
                onClick={() => toggleTurn(turn)}
                aria-pressed={active}
              >
                {t(`commission.turn_${turn}`)}
              </Button>
            )
          })}
        </div>

        <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-2">
          {visibleCommissions.length === 0 && (
            <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted py-4 text-center">
              {t('commission.noMatchTurns')}
            </p>
          )}
          {visibleCommissions.map((commission) => {
            const selected = selectedCommissions.includes(commission.name)
            return (
              <div
                key={commission.name}
                className={`rounded-card border overflow-hidden transition-colors duration-150 ${
                  selected ? "border-primary" : "border-border dark:border-night-border"
                }`}
              >
                <button
                  type="button"
                  onClick={() => handleCommissionToggle(commission.name)}
                  aria-pressed={selected}
                  className={`w-full px-4 py-3 text-left transition-colors duration-150 flex flex-col ${
                    selected
                      ? "bg-primary text-white"
                      : "bg-surface dark:bg-night-bg hover:bg-primary-50 dark:hover:bg-primary-900"
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="font-body font-semibold text-body-sm">{t('commission.commission')} {commission.name}</span>
                    {selected && (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </div>
                  <div className={`font-mono text-label mt-1 whitespace-pre-line ${
                    selected ? "text-white/80" : "text-ink-secondary dark:text-night-muted"
                  }`}>
                    {formatSchedule(commission.schedule)}
                  </div>
                  {/* Same-named commissions are told apart by their dates. */}
                  {commission.sga_name && commission.course_start && commission.course_end && (
                    <div className={`font-mono text-label mt-1 ${
                      selected ? "text-white/80" : "text-ink-secondary dark:text-night-muted"
                    }`}>
                      {t('commission.dates', { from: formatDay(commission.course_start), to: formatDay(commission.course_end) })}
                    </div>
                  )}
                </button>
                {commission.name_conflict && (
                  <Alert tone="warning" className="m-2">
                    {t('commission.nameConflict', { name: commission.sga_name })}
                  </Alert>
                )}
                <CorrectionStatus
                  className="px-4 py-2.5 bg-white dark:bg-night-surface border-t border-border dark:border-night-border"
                  subject={subject}
                  commission={commission}
                  onSuggest={() => setSuggestFor(commission.name)}
                />
              </div>
            )
          })}
        </div>

      </div>
    </Modal>
  )
}

export default CommissionSelectionModal
