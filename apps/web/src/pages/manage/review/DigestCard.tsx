import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ApiError } from '../../../api/client'
import { fetchDigest, fetchDigests } from '../../../newsletter/api/digests'
import type { DigestDetail } from '../../../newsletter/types'
import { DIGESTS_PATH, digestPath } from '../../../newsletter/paths'
import { Alert, Badge, Button, LoadingRegion, Skeleton, buttonClass } from '../../../components/ui'

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; digest: DigestDetail | null }
  | { kind: 'error' }
  | { kind: 'unavailable' }

// The weekly digest being prepared, beside the queue: when it goes out, how
// many articles it carries, and a way into its editor.
export default function DigestCard() {
  const { t, i18n } = useTranslation()
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    fetchDigests()
      .then(async (list) => {
        // The one in preparation: the newest draft (or one being sent).
        const next = [...list]
          .filter((d) => d.status === 'draft' || d.status === 'sending')
          .sort((a, b) => b.weekStart.localeCompare(a.weekStart))[0]
        const digest = next ? await fetchDigest(next.id) : null
        if (active) setState({ kind: 'ready', digest })
      })
      .catch((e) => {
        if (!active) return
        if (e instanceof ApiError && [403, 404].includes(e.status)) setState({ kind: 'unavailable' })
        else { console.error('review: digest card', e); setState({ kind: 'error' }) }
      })
    return () => { active = false }
  }, [attempt])

  if (state.kind === 'unavailable') return null

  const fmtDate = (iso: string) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString(i18n.language, { day: 'numeric', month: 'long' })
  const fmtWhen = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface p-5 flex flex-col gap-2.5">
      <p className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">{t('manage.review.digest.title')}</p>
      {state.kind === 'loading' && (
        <LoadingRegion className="flex flex-col gap-2">
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </LoadingRegion>
      )}
      {state.kind === 'error' && (
        <Alert tone="error" action={<Button size="sm" variant="outline" onClick={() => { setState({ kind: 'loading' }); setAttempt((n) => n + 1) }}>{t('errors.retry')}</Button>}>
          {t('manage.review.digest.loadError')}
        </Alert>
      )}
      {state.kind === 'ready' && state.digest && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-display font-bold text-h5 text-ink-primary dark:text-night-text leading-tight">
              {t('manage.review.digest.week', { date: fmtDate(state.digest.weekStart) })}
            </p>
            <Badge tone={state.digest.status === 'sending' ? 'info' : 'neutral'}>{t(`manage.review.digest.status.${state.digest.status}`)}</Badge>
          </div>
          <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">
            {state.digest.autoSendAt
              ? t('manage.review.digest.sendsAt', { when: fmtWhen(state.digest.autoSendAt) })
              : t('manage.review.digest.notScheduled')}
            {' · '}
            {t('manage.review.digest.articles', { count: state.digest.articles.length })}
          </p>
          <Link to={digestPath(state.digest.id)} className={buttonClass({ variant: 'outline', size: 'sm', className: 'self-start' })}>
            {t('manage.review.digest.edit')}
          </Link>
        </>
      )}
      {state.kind === 'ready' && !state.digest && (
        <>
          <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('manage.review.digest.none')}</p>
          <Link to={DIGESTS_PATH} className={buttonClass({ variant: 'outline', size: 'sm', className: 'self-start' })}>
            {t('manage.review.digest.open')}
          </Link>
        </>
      )}
    </div>
  )
}
