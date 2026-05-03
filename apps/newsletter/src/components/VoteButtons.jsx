import { useState, useEffect } from 'react'
import { castVote, getVotesForArticle } from '../store/voteStore'
import { trackEvent } from '../store/analyticsStore'

export default function VoteButtons({ articleId }) {
  const [state, setState] = useState({ up: 0, down: 0, myVote: null })

  useEffect(() => {
    getVotesForArticle(articleId).then(setState)
  }, [articleId])

  async function handleVote(type) {
    // Optimistic myVote flip
    setState((prev) => ({
      ...prev,
      myVote: prev.myVote === type ? null : type,
    }))
    trackEvent('vote', { articleId, voteType: type })
    const next = await castVote(articleId, type)
    setState(next)
  }

  return (
    <div className="flex items-center gap-1" aria-label="¿Te resultó útil este artículo?">
      <span className="font-body text-body-sm text-ink-secondary mr-2">
        ¿Te resultó útil?
      </span>

      <VoteButton type="up"   active={state.myVote === 'up'}   onVote={handleVote} label="Sí, me resultó útil" />
      <VoteButton type="down" active={state.myVote === 'down'} onVote={handleVote} label="No me resultó útil" />
    </div>
  )
}

function VoteButton({ type, active, onVote, label }) {
  const isUp = type === 'up'
  return (
    <button
      type="button"
      onClick={() => onVote(type)}
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
