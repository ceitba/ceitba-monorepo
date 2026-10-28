import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Badge, Button, toast } from '@/components/ui'
import { ApiError } from '@/api/client'
import { useAuth } from '@/hooks/useAuth'
import { startGoogleSignIn } from '@/store/authStore'
import { fetchPoll, votePoll, type Poll } from '../../api/engagement'

interface PollBlockProps {
  articleId: string
  pollId: string
  // Editor preview: shows the poll without voting.
  preview?: boolean
}

// A ```poll block of an article body. Options are buttons until the reader
// votes; then (or when the poll closes, depending on the author's choice) each
// option shows its share. The API leaves the counts out while they're hidden.
export default function PollBlock({ articleId, pollId, preview = false }: PollBlockProps) {
  const { t, i18n } = useTranslation()
  const { profile } = useAuth()
  const location = useLocation()
  const [poll, setPoll] = useState<Poll | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>('loading')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    setStatus('loading')
    fetchPoll(articleId, pollId)
      .then((p) => { if (active) { setPoll(p); setStatus('ready') } })
      .catch(() => { if (active) setStatus('missing') })
    return () => { active = false }
  }, [articleId, pollId, profile?.id])

  if (status === 'loading') return <div className="my-8 skeleton rounded-card h-56" aria-hidden="true" />
  if (status === 'missing' || !poll) {
    return (
      <p className="my-8 rounded-card border border-dashed border-border dark:border-night-border px-4 py-3 font-body text-body-sm text-ink-secondary dark:text-night-muted">
        {t('engagement.poll.unavailable')}
      </p>
    )
  }

  const canVote = !preview && !poll.closed && Boolean(profile)

  async function vote(optionId: string) {
    if (!poll || busy) return
    setBusy(true)
    try {
      setPoll(await votePoll(articleId, poll.id, poll.myVote === optionId ? null : optionId))
    } catch (err) {
      if (err instanceof ApiError && err.code === 'PollClosed') {
        toast.error(t('engagement.poll.closedError'))
        setPoll(await fetchPoll(articleId, poll.id).catch(() => poll))
      } else {
        toast.error(t('engagement.poll.voteError'))
      }
    } finally {
      setBusy(false)
    }
  }

  const total = poll.totalVotes ?? 0
  const closesAt = poll.closesAt
    ? new Intl.DateTimeFormat(i18n.language === 'en' ? 'en-US' : 'es-AR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(poll.closesAt))
    : null

  let footer: string
  if (!poll.resultsVisible) footer = poll.resultsVisibility === 'after_close' ? t('engagement.poll.resultsOnClose') : t('engagement.poll.voteToSee')
  else footer = t('engagement.poll.votes', { count: total })
  if (canVote && poll.myVote) footer += ` · ${t('engagement.poll.changeHint')}`

  return (
    <figure className="my-10 rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface shadow-card p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Badge tone="accent">{t('engagement.poll.badge')}</Badge>
        <span className="font-mono text-label text-ink-secondary dark:text-night-muted">
          {poll.closed ? t('engagement.poll.closed') : closesAt ? t('engagement.poll.closesAt', { date: closesAt }) : t('engagement.poll.open')}
        </span>
      </div>
      <figcaption className="font-display text-h4 font-bold text-ink-primary dark:text-night-text leading-snug mb-4">{poll.question}</figcaption>
      <div role="group" aria-label={poll.question} className="flex flex-col gap-2">
        {poll.options.map((o) => {
          const pct = poll.resultsVisible && total > 0 ? Math.round(((o.votes ?? 0) / total) * 100) : 0
          const mine = poll.myVote === o.id
          return (
            <div key={o.id}>
              <button
                type="button"
                disabled={!canVote || busy}
                onClick={() => vote(o.id)}
                aria-pressed={mine}
                className={[
                  'relative w-full min-h-[44px] overflow-hidden rounded-xs border text-left px-3 py-2 font-body text-body-sm transition-colors duration-150 disabled:cursor-default',
                  mine ? 'border-primary dark:border-primary-300' : 'border-border dark:border-night-border',
                  canVote ? 'hover:border-primary dark:hover:border-primary-300' : '',
                ].join(' ')}
              >
                {poll.resultsVisible && (
                  <span
                    aria-hidden="true"
                    className={['absolute inset-y-0 left-0 transition-[width] duration-300', mine ? 'bg-primary-100 dark:bg-primary-900' : 'bg-primary-50 dark:bg-night-raised'].join(' ')}
                    style={{ width: `${pct}%` }}
                  />
                )}
                <span className="relative flex items-center justify-between gap-3">
                  <span className={mine ? 'font-semibold text-primary dark:text-primary-200' : 'text-ink-primary dark:text-night-text'}>
                    {mine && <span className="sr-only">{t('engagement.poll.yourVote')}: </span>}
                    {mine && '✓ '}{o.label}
                  </span>
                  {poll.resultsVisible && <span className="font-mono text-label text-ink-secondary dark:text-night-muted">{pct}%</span>}
                </span>
              </button>
            </div>
          )
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-label text-ink-secondary dark:text-night-muted" aria-live="polite">{footer}</p>
        {!preview && !profile && !poll.closed && (
          <Button size="sm" variant="outline" onClick={() => startGoogleSignIn(location.pathname + location.search)}>
            {t('engagement.signInToVote')}
          </Button>
        )}
      </div>
    </figure>
  )
}
