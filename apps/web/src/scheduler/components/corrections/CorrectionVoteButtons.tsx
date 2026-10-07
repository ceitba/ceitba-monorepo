import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/hooks/useAuth'
import { useCorrections } from '../../context/correctionsContext'
import { removeCorrectionVote, toCommissionCorrection, voteCorrection } from '../../api/corrections'
import { correctionErrorKey, nextVoteAction } from '../../services/corrections'
import type { CommissionCorrection, VoteType } from '../../types/scheduler'
import SignInPrompt from './SignInPrompt'
import { Button } from '@/components/ui'

interface Props {
  subjectId: string
  commissionName: string
  correction: CommissionCorrection
  // Accessible name of the group, e.g. "Vote on the suggestion Tue 08:00–10:00".
  label: string
}

// [Confirmar] [No es así]. The caller's vote shows pressed; pressing it
// again removes it. Anonymous visitors get a sign-in prompt instead.
// The list updates from the correction the API returns (no optimistic
// state to roll back).
export default function CorrectionVoteButtons({ subjectId, commissionName, correction, label }: Props) {
  const { t } = useTranslation()
  const { profile } = useAuth()
  const corrections = useCorrections()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [askSignIn, setAskSignIn] = useState(false)

  async function vote(type: VoteType) {
    if (!profile) { setAskSignIn(true); return }
    const action = nextVoteAction(correction.my_vote, type)
    setBusy(true)
    setError(null)
    try {
      const updated = action === 'remove'
        ? await removeCorrectionVote(correction.id)
        : await voteCorrection(correction.id, action)
      corrections?.onCorrectionChange(subjectId, commissionName, toCommissionCorrection(updated))
    } catch (e) {
      setError(t(`corrections.errors.${correctionErrorKey(e)}`))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-2" role="group" aria-label={label} aria-busy={busy}>
        {(['CONFIRM', 'REJECT'] as const).map((type) => {
          const pressed = correction.my_vote === type
          return (
            <Button
              key={type}
              size="sm"
              variant={pressed ? 'primary' : 'outline'}
              onClick={() => vote(type)}
              disabled={busy}
              aria-pressed={pressed}
            >
              {t(type === 'CONFIRM' ? 'corrections.confirm' : 'corrections.reject')}
            </Button>
          )
        })}
      </div>
      {askSignIn && !profile && <SignInPrompt compact message={t('corrections.signInToVote')} />}
      {error && (
        <p role="alert" className="font-body text-body-sm text-red-700 dark:text-red-300">{error}</p>
      )}
    </div>
  )
}
