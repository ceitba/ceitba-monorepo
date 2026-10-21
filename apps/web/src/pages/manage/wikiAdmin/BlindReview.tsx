import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchNextReview, fetchReviewProgress, submitReview, type ReviewProgress, type ModelConfig, type ReviewPage, type ReviewPair, type ReviewResult, type ReviewScores } from '../../../api/kbAdmin'
import type { KbPage } from '../../../api/kb'
import { Alert, Button, EmptyState, ErrorState, Field, LoadingRegion, Skeleton, textareaClass } from '@/components/ui'
import { apuntesAdminErrorMessage } from '../adminErrors'
import { CitationContext } from '../../../components/apuntes/wiki/citationContext'
import { citationOrder } from '../../../components/apuntes/wiki/wikilinks'
import { isUnavailable } from './useLoad'
import ReviewProgressHeader, { ReviewSummaryLine } from './ReviewProgressView'

const WikiMarkdown = lazy(() => import('../../../components/apuntes/wiki/WikiMarkdown'))

type Winner = 'A' | 'B' | 'tie'
const DIMENSIONS = ['accuracy', 'clarity', 'usefulness'] as const
const NEUTRAL: ReviewScores = { accuracy: 3, clarity: 3, usefulness: 3 }

// Blind A/B review of one eval: the same page from two configurations,
// model names hidden until the rating is submitted.
export default function BlindReview({ evalId, onDone, onLeaderboard }: { evalId: string; onDone: () => void; onLeaderboard?: () => void }) {
  const { t } = useTranslation()
  const [pair, setPair] = useState<ReviewPair | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [winner, setWinner] = useState<Winner | null>(null)
  // Scores per side, 1–5 each (ADMIN doc §6).
  const [scoresA, setScoresA] = useState<ReviewScores>(NEUTRAL)
  const [scoresB, setScoresB] = useState<ReviewScores>(NEUTRAL)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [revealed, setRevealed] = useState<ReviewResult['revealed'] | null>(null)

  // Review progress (GET …/review/progress); null when not available yet.
  const [rp, setRp] = useState<ReviewProgress | null>(null)
  const loadProgress = useCallback(() => {
    fetchReviewProgress(evalId).then(setRp).catch(() => setRp(null))
  }, [evalId])
  useEffect(() => { loadProgress() }, [loadProgress])

  const next = useCallback(() => {
    setPair(undefined); setError(null); setWinner(null); setRevealed(null); setComment('')
    setScoresA(NEUTRAL); setScoresB(NEUTRAL)
    fetchNextReview(evalId)
      .then((p) => setPair(p))
      .catch((e) => { if (isUnavailable(e)) setUnavailable(true); else setError(apuntesAdminErrorMessage(e, t)) })
  }, [evalId, t])

  useEffect(() => { next() }, [next])

  async function submit() {
    if (!pair || !winner) return
    setBusy(true); setError(null)
    try {
      const r = await submitReview(evalId, { subjectId: pair.subjectId, slug: pair.slug, winner, scoresA, scoresB, comment: comment.trim() })
      setRevealed(r?.revealed ?? {})
      loadProgress()
    } catch (e) {
      setError(apuntesAdminErrorMessage(e, t))
    } finally {
      setBusy(false)
    }
  }

  if (unavailable) return <EmptyState compact title={t('manage.wikiAi.unavailableTitle')} body={t('manage.wikiAi.unavailable')} />
  if (pair === undefined && error) return <ErrorState title={t('manage.errors.loadFailed')} message={error} onRetry={next} />
  if (pair === undefined) return <LoadingRegion><Skeleton className="h-96 rounded-card" /></LoadingRegion>
  if (pair === null || (rp?.remainingForMe === 0 && !revealed)) {
    return (
      <div className="flex flex-col gap-4">
        <ReviewProgressHeader progress={rp} />
        <div className="py-10 flex flex-col items-center gap-3 text-center font-body text-body-sm text-ink-secondary dark:text-night-muted">
          {/* "All done" only when we know there were pairs and none is left for me. */}
          <p className="font-display font-bold text-h4 text-ink-primary dark:text-night-text">
            {(rp?.totalPairs ?? 0) > 0 && rp?.remainingForMe === 0 ? t('manage.wikiAi.reviewProgress.allDone') : t('manage.wikiAi.review.noMore')}
          </p>
          <ReviewSummaryLine summary={rp} />
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="outline" size="sm" onClick={onDone}>{t('manage.wikiAi.review.back')}</Button>
            {onLeaderboard && <Button size="sm" onClick={onLeaderboard}>{t('manage.wikiAi.reviewProgress.toLeaderboard')}</Button>}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <ReviewProgressHeader progress={rp} fallback={pair ? { reviewedByMe: pair.reviewedByMe, totalPairs: pair.totalPairs, remaining: pair.remaining } : null} />
      {error && <Alert tone="error" onDismiss={() => setError(null)}>{error}</Alert>}
      {pair && (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">
              <span className="font-mono text-label mr-1.5">{pair.subjectId}</span>{pair.subjectName}
            </p>

          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {[pair.a, pair.b].map((p, i) => (
              <div key={i} className="flex flex-col gap-3 min-w-0">
                <ReviewColumn label={i === 0 ? 'A' : 'B'} page={p} subjectId={pair.subjectId} slug={pair.slug} reveal={revealed ? (i === 0 ? revealed.A : revealed.B) : undefined} />
                <ScoreSliders
                  label={i === 0 ? 'A' : 'B'}
                  value={i === 0 ? scoresA : scoresB}
                  onChange={i === 0 ? setScoresA : setScoresB}
                  disabled={!!revealed}
                />
              </div>
            ))}
          </div>

          {revealed ? (
            <div className="flex flex-wrap items-center gap-3 p-4 rounded-card border border-border dark:border-night-border bg-page-bg dark:bg-night-bg">
              <p className="flex-1 font-body text-body-sm">{t('manage.wikiAi.review.saved')}</p>
              <Button variant="outline" size="sm" onClick={onDone}>{t('manage.wikiAi.review.back')}</Button>
              <Button size="sm" onClick={next}>{t('manage.wikiAi.review.next')}</Button>
            </div>
          ) : (
            <div className="flex flex-col gap-4 p-4 rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface">
              <div role="radiogroup" aria-label={t('manage.wikiAi.review.winner')} className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted mr-2">{t('manage.wikiAi.review.winner')}</span>
                {(['A', 'B', 'tie'] as Winner[]).map((w) => (
                  <button
                    key={w}
                    type="button"
                    role="radio"
                    aria-checked={winner === w}
                    onClick={() => setWinner(w)}
                    className={`min-w-20 min-h-[44px] px-4 rounded-xs border font-mono text-label uppercase tracking-widest transition-colors duration-150 ${winner === w ? 'bg-primary text-white border-primary' : 'border-border dark:border-night-border text-ink-primary dark:text-night-text hover:border-primary'}`}
                  >
                    {w === 'tie' ? t('manage.wikiAi.review.tie') : w}
                  </button>
                ))}
              </div>
              <p className="font-body text-label text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.review.scoresHint')}</p>
              <Field label={t('manage.wikiAi.review.comment')}>
                {(p) => <textarea {...p} value={comment} onChange={(e) => setComment(e.target.value)} rows={2} maxLength={1000} className={textareaClass()} />}
              </Field>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {!winner && <span className="mr-auto font-body text-label text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.review.pickWinner')}</span>}
                <Button variant="ghost" size="sm" onClick={next} disabled={busy}>{t('manage.wikiAi.review.skip')}</Button>
                <Button size="sm" onClick={submit} disabled={!winner} loading={busy}>{t('manage.wikiAi.review.submit')}</Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ReviewColumn({ label, page, subjectId, slug, reveal }: {
  label: string
  page: ReviewPage
  subjectId: string
  slug: string
  reveal?: (ModelConfig & { configKey?: string }) | undefined
}) {
  const { t } = useTranslation()
  const kbPage: KbPage = useMemo(() => ({
    id: `${label}-${slug}`,
    slug,
    title: page.title,
    type: 'concept',
    summary: page.summary ?? '',
    aliases: [],
    subjectId,
    subjectName: '',
    markdown: page.markdown ?? '',
    sources: (page.sources ?? []).map((s) => ({ id: s.id, name: s.name, kind: (s.kind ?? 'OTHER') as KbPage['sources'][number]['kind'], author: s.author ?? { name: null, anonymous: true } })),
    links: (page.links ?? []).map((l) => ({ ...l, resolved: l.resolved ?? !!l.slug, title: l.title ?? null, anchor: l.anchor ?? null })),
    backlinks: [],
    generator: '',
    generatedAt: '',
    revision: 0,
    reportedByMe: false,
  }), [page, label, slug, subjectId])
  const order = useMemo(() => citationOrder(kbPage.markdown, kbPage.sources), [kbPage])
  const ctx = useMemo(() => ({ order, reportPart: () => {} }), [order])

  return (
    <article className="min-w-0 rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface">
      <header className="sticky top-16 z-10 flex items-center justify-between gap-2 px-4 py-2 border-b border-border dark:border-night-border bg-white/95 dark:bg-night-surface/95 rounded-t-card">
        <span className="font-display font-bold text-h4">{label}</span>
        {reveal ? (
          <span className="font-mono text-label text-emerald-700 dark:text-emerald-300 break-all text-right">
            {t('manage.wikiAi.stages.PLAN')}: {reveal.plan} · {t('manage.wikiAi.stages.WRITE')}: {reveal.write}
          </span>
        ) : (
          <span className="font-mono text-label text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.review.hidden')}</span>
        )}
      </header>
      <div className="px-4 py-5 max-h-[75vh] overflow-y-auto">
        <h2 className="font-display font-bold text-h4 text-ink-primary dark:text-night-text mb-1">{page.title}</h2>
        {page.summary && <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted mb-4">{page.summary}</p>}
        <CitationContext.Provider value={ctx}>
          <Suspense fallback={<LoadingRegion><Skeleton className="h-64" /></LoadingRegion>}>
            <WikiMarkdown page={kbPage} />
          </Suspense>
        </CitationContext.Provider>
      </div>
    </article>
  )
}

function ScoreSliders({ label, value, onChange, disabled }: {
  label: string
  value: ReviewScores
  onChange: (v: ReviewScores) => void
  disabled: boolean
}) {
  const { t } = useTranslation()
  return (
    <fieldset disabled={disabled} className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface disabled:opacity-60">
      <legend className="px-1 font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.review.scoresFor', { label })}</legend>
      {DIMENSIONS.map((k) => (
        <label key={k} className="flex flex-col gap-1">
          <span className="flex justify-between font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
            {t(`manage.wikiAi.review.scores.${k}`)} <span className="text-ink-primary dark:text-night-text">{value[k]}</span>
          </span>
          <input
            type="range"
            min={1}
            max={5}
            step={1}
            value={value[k]}
            aria-label={t('manage.wikiAi.review.scoreAria', { label, dimension: t(`manage.wikiAi.review.scores.${k}`) })}
            onChange={(e) => onChange({ ...value, [k]: Number(e.target.value) })}
            className="min-h-[44px] accent-primary"
          />
        </label>
      ))}
    </fieldset>
  )
}
