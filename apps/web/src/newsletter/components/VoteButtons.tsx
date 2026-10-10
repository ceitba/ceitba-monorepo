import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { castVote, getVotesForArticle, type VoteState } from '../store/voteStore'
import type { VoteType } from '../types'
import { trackEvent } from '../store/analyticsStore'

interface VoteButtonsProps {
  articleId: string
}

export default function VoteButtons({ articleId }: VoteButtonsProps) {
  const { t } = useTranslation()
  const [state, setState] = useState<VoteState>({ up: 0, down: 0, myVote: null })
  const [busy, setBusy] = useState(false)
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    let active = true
    getVotesForArticle(articleId).then((s) => { if (active) setState(s) })
    return () => { active = false }
  }, [articleId])

  async function handleVote(type: VoteType) {
    if (busy) return
    const before = stateRef.current
    setBusy(true)
    // Optimistic myVote flip; castVote returns `before` on failure.
    setState({ ...before, myVote: before.myVote === type ? null : type })
    trackEvent('vote', { articleId })
    const next = await castVote(articleId, type, before)
    // castVote only returns null/undefined when given no state; `before` is always set.
    setState(next ?? before)
    setBusy(false)
  }

  return (
    <div className="flex items-center gap-1" role="group" aria-label={t('votes.groupLabel')}>
      <span className="font-body text-body-sm text-ink-secondary mr-2">
        {t('votes.prompt')}
      </span>

      <VoteButton type="up"   active={state.myVote === 'up'}   onVote={handleVote} disabled={busy} label={t('votes.up')} />
      <VoteButton type="down" active={state.myVote === 'down'} onVote={handleVote} disabled={busy} label={t('votes.down')} />
    </div>
  )
}

interface VoteButtonProps {
  type: VoteType
  active: boolean
  onVote: (type: VoteType) => void
  label: string
  disabled: boolean
}

function VoteButton({ type, active, onVote, label, disabled }: VoteButtonProps) {
  const isUp = type === 'up'
  return (
    <button
      type="button"
      onClick={() => onVote(type)}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      className={[
        'w-11 h-11 flex items-center justify-center rounded-sm border transition-colors duration-150 disabled:opacity-60',
        active
          ? isUp
            ? 'bg-primary text-white border-primary'
            : 'bg-ink-primary text-white border-ink-primary dark:bg-night-text dark:text-night-bg dark:border-night-text'
          : 'bg-white dark:bg-night-surface border-border dark:border-night-border text-ink-secondary hover:border-primary hover:text-primary',
      ].join(' ')}
    >
      {isUp ? <ThumbUp /> : <ThumbDown />}
    </button>
  )
}

function ThumbUp() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/>
      <path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>
    </svg>
  )
}

function ThumbDown() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z"/>
      <path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/>
    </svg>
  )
}
