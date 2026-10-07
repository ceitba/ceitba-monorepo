import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { castVote, getVotesForArticle } from '../store/voteStore'
import { trackEvent } from '../store/analyticsStore'

export default function VoteButtons({ articleId }) {
  const { t } = useTranslation()
  const [state, setState] = useState({ up: 0, down: 0, myVote: null })
  const [busy, setBusy] = useState(false)
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    let active = true
    getVotesForArticle(articleId).then((s) => { if (active) setState(s) })
    return () => { active = false }
  }, [articleId])

  async function handleVote(type) {
    if (busy) return
    const before = stateRef.current
    setBusy(true)
    // Optimistic myVote flip; castVote returns `before` on failure.
    setState({ ...before, myVote: before.myVote === type ? null : type })
    trackEvent('vote', { articleId })
    const next = await castVote(articleId, type, before)
    setState(next)
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

function VoteButton({ type, active, onVote, label, disabled }) {
  const isUp = type === 'up'
  return (
    <button
      type="button"
      onClick={() => onVote(type)}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      className={[
        'w-10 h-10 flex items-center justify-center rounded-sm border transition-all duration-150 focus-visible:rounded',
        active
          ? isUp
            ? 'bg-primary text-white border-primary'
            : 'bg-red-500 text-white border-red-500'
          : 'bg-white border-border text-ink-secondary hover:border-primary hover:text-primary',
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
