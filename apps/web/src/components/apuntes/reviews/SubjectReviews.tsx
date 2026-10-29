import '../../../i18nApuntes'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  REVIEW_REPORT_REASONS,
  deleteReview,
  fetchSubjectReviews,
  reportReview,
  setReviewHelpful,
  type Review,
  type ReviewReportReason,
  type SubjectReviews as SubjectReviewsData,
} from '../../../api/reviews'
import { CloseIcon, Button, ConfirmDialog, EmptyState, ErrorState, LoadingRegion, Skeleton, selectClass, toast } from '../../ui'
import ReportDialog from '../ReportDialog'
import { apuntesErrorCopy } from '../errorCopy'
import ReviewCard from './ReviewCard'
import ReviewForm from './ReviewForm'
import { currentTerm, normCommission, parseTermKey, sameTerm, stats, termKey, uniqueCommissions, uniqueTerms, type Stats } from './logic'

const NONE = '__none__'
const LABEL = 'font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted'

interface Filters { commission: string; term: string }
const NO_FILTERS: Filters = { commission: '', term: '' }

// The Opiniones tab of /apuntes/:subjectId, "professors first": one row per
// professor the (filtered) reviews name, plus "Sin profesor indicado";
// picking one shows their reviews. A review with several professors counts
// in each of their rows, and the page says so. Every number follows the
// commission/term filters.
export default function SubjectReviews({ subjectId }: { subjectId: string }) {
  const { t, i18n } = useTranslation()
  const professorsId = useId()
  const activeId = useId()
  const [data, setData] = useState<SubjectReviewsData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const reqRef = useRef(0)

  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [selected, setSelected] = useState<string | null>(null)
  // undefined = closed; null = a new review; a Review = editing it.
  const [form, setForm] = useState<Review | null | undefined>(undefined)
  const [deleting, setDeleting] = useState<Review | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [reporting, setReporting] = useState<Review | null>(null)
  const [helpfulBusy, setHelpfulBusy] = useState<string | null>(null)

  useEffect(() => {
    const id = ++reqRef.current
    setError(null)
    fetchSubjectReviews(subjectId)
      .then((res) => { if (reqRef.current === id) setData(res) })
      .catch((e) => { if (reqRef.current === id) { setData(null); setError(apuntesErrorCopy(e, t)) } })
  }, [subjectId, tick, t])

  useEffect(() => { setFilters(NO_FILTERS); setSelected(null) }, [subjectId])

  const all = useMemo(() => data?.reviews ?? [], [data])
  const names = useMemo(() => new Map((data?.professors ?? []).map((p) => [p.id, p.name])), [data])
  const professorName = (id: string) => names.get(id) ?? null

  const reviews = useMemo(() => all.filter((r) =>
    (!filters.commission || normCommission(r.commission) === filters.commission) &&
    (!filters.term || sameTerm(r, parseTermKey(filters.term)))), [all, filters])
  const filtered = !!(filters.commission || filters.term)

  const rows = useMemo(() => {
    const ids = [...new Set(reviews.flatMap((r) => r.professorIds))]
    return [
      ...ids.map((id) => ({ key: id, name: names.get(id) ?? '', none: false, list: reviews.filter((r) => r.professorIds.includes(id)) })),
      { key: NONE, name: t('apuntes.reviews.noProfessor'), none: true, list: reviews.filter((r) => r.professorIds.length === 0) },
    ]
      .filter((r) => r.list.length > 0 && (r.none || r.name))
      .sort((a, b) => b.list.length - a.list.length || Number(a.none) - Number(b.none) || a.name.localeCompare(b.name, i18n.language))
  }, [reviews, names, t, i18n.language])
  const active = rows.find((r) => r.key === selected) ?? rows[0]

  const now = currentTerm()
  const mineNow = all.find((r) => r.mine && sameTerm(r, now)) ?? null

  function statsPhrase(s: Stats): string {
    if (s.n === 0 || s.difficulty == null) return t('apuntes.reviews.noStats')
    return t('apuntes.reviews.stats', {
      count: s.recommends,
      total: s.n,
      difficulty: t(`apuntes.reviews.difficultyWord.${s.difficulty}`),
    })
  }
  const termLabel = (r: { year: number; period: number }) => t('apuntes.reviews.term', { period: r.period, year: r.year })

  async function toggleHelpful(r: Review) {
    const next = !r.helpful
    const patch = (helpful: boolean, delta: number) => setData((d) => d && {
      ...d,
      reviews: d.reviews.map((x) => (x.id === r.id ? { ...x, helpful, helpfulCount: Math.max(0, x.helpfulCount + delta) } : x)),
    })
    patch(next, next ? 1 : -1)
    setHelpfulBusy(r.id)
    try {
      await setReviewHelpful(r.id, next)
    } catch (e) {
      patch(!next, next ? -1 : 1)
      toast.error(apuntesErrorCopy(e, t))
    } finally {
      setHelpfulBusy(null)
    }
  }

  async function confirmDelete() {
    if (!deleting) return
    setDeleteBusy(true); setDeleteError(null)
    try {
      await deleteReview(deleting.id)
      setDeleting(null)
      toast.success(t('apuntes.reviews.deleted'))
      setTick((n) => n + 1)
    } catch (e) {
      setDeleteError(apuntesErrorCopy(e, t))
    } finally {
      setDeleteBusy(false)
    }
  }

  if (error) return <ErrorState message={error} onRetry={() => setTick((n) => n + 1)} />
  if (!data) return <ReviewsSkeleton />

  const writeButton = (
    <Button onClick={() => setForm(mineNow)}>
      {t(mineNow ? 'apuntes.reviews.editMine' : 'apuntes.reviews.write')}
    </Button>
  )

  const pills = [
    filters.commission && { key: 'commission', text: t('apuntes.reviews.commission', { commission: filters.commission }), clear: { ...filters, commission: '' } },
    filters.term && { key: 'term', text: termLabel(parseTermKey(filters.term)), clear: { ...filters, term: '' } },
  ].filter((p): p is { key: string; text: string; clear: Filters } => !!p)

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div className="flex flex-wrap items-end gap-4 pb-6 border-b border-border dark:border-night-border">
        <div className="flex-1 min-w-56 flex flex-col gap-1">
          <span className={LABEL}>
            {filtered
              ? t('apuntes.reviews.filteredCount', { shown: reviews.length, count: all.length })
              : t('apuntes.reviews.count', { count: all.length })}
          </span>
          <span className="font-body text-body text-ink-primary dark:text-night-text">
            {filtered && reviews.length === 0 ? t('apuntes.reviews.noMatches') : statsPhrase(stats(reviews))}
          </span>
        </div>
        {/* With no reviews yet the empty state carries the action. */}
        {all.length > 0 && writeButton}
      </div>

      {all.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <select
              value={filters.commission}
              onChange={(e) => { setFilters({ ...filters, commission: e.target.value }); setSelected(null) }}
              aria-label={t('apuntes.reviews.filters.commissionAria')}
              className={selectClass({ className: 'w-auto!' })}
            >
              <option value="">{t('apuntes.reviews.filters.commissionAll')}</option>
              {uniqueCommissions(all).map((c) => (
                <option key={c} value={c}>{t('apuntes.reviews.commission', { commission: c })}</option>
              ))}
            </select>
            <select
              value={filters.term}
              onChange={(e) => { setFilters({ ...filters, term: e.target.value }); setSelected(null) }}
              aria-label={t('apuntes.reviews.filters.termAria')}
              className={selectClass({ className: 'w-auto!' })}
            >
              <option value="">{t('apuntes.reviews.filters.termAll')}</option>
              {uniqueTerms(all).map((x) => <option key={termKey(x)} value={termKey(x)}>{termLabel(x)}</option>)}
            </select>
          </div>
          {pills.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {pills.map((p) => (
                <Button
                  key={p.key}
                  size="sm"
                  variant="outline"
                  onClick={() => setFilters(p.clear)}
                  aria-label={t('apuntes.reviews.filters.remove', { name: p.text })}
                >
                  {p.text} <CloseIcon size={14} />
                </Button>
              ))}
              <Button size="sm" variant="ghost" onClick={() => setFilters(NO_FILTERS)}>{t('apuntes.reviews.filters.clear')}</Button>
            </div>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        filtered ? (
          <EmptyState
            title={t('apuntes.reviews.noMatches')}
            body={t('apuntes.reviews.noMatchesBody')}
            action={<Button variant="outline" onClick={() => setFilters(NO_FILTERS)}>{t('apuntes.reviews.clearFilters')}</Button>}
          />
        ) : (
          <EmptyState title={t('apuntes.reviews.emptyTitle')} body={t('apuntes.reviews.emptyBody')} action={writeButton} />
        )
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-8">
          <section aria-labelledby={professorsId} className="flex flex-col gap-2">
            <h2 id={professorsId} className="font-display text-h5 font-bold text-ink-primary dark:text-night-text mb-1">
              {t('apuntes.reviews.professorsTitle')}
            </h2>
            {reviews.some((r) => r.professorIds.length > 1) && (
              <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted mb-1">{t('apuntes.reviews.multiNote')}</p>
            )}
            <div role="group" aria-label={t('apuntes.reviews.professorsAria')} className="flex flex-col gap-2">
            {rows.map((r) => {
              const on = r.key === active?.key
              const commissions = uniqueCommissions(r.list)
              return (
                <button
                  key={r.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setSelected(r.key)}
                  className={`text-left rounded-card border p-4 flex flex-col gap-1 transition-colors duration-150 ${on
                    ? 'border-primary bg-primary-50 dark:border-primary-300 dark:bg-night-raised'
                    : 'border-border dark:border-night-border bg-white dark:bg-night-surface hover:border-primary dark:hover:border-primary-300'}`}
                >
                  <span className={`font-body text-body font-semibold ${r.none ? 'text-ink-secondary dark:text-night-muted' : 'text-ink-primary dark:text-night-text'}`}>
                    {r.name}
                  </span>
                  <span className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{statsPhrase(stats(r.list))}</span>
                  <span className="font-mono text-label text-ink-secondary dark:text-night-muted">
                    {t('apuntes.reviews.commissions', { list: commissions.join(', ') })}
                    {' · '}
                    {uniqueTerms(r.list).map(termLabel).join(', ')}
                  </span>
                </button>
              )
            })}
            </div>
          </section>

          <section aria-labelledby={activeId} className="flex flex-col gap-3 min-w-0">
            {active && (
              <>
                <h2 id={activeId} className="font-display text-h4 font-bold text-ink-primary dark:text-night-text">{active.name}</h2>
                {[...active.list]
                  .sort((a, b) => Number(!!b.comment?.trim()) - Number(!!a.comment?.trim()) || b.helpfulCount - a.helpfulCount)
                  .map((r) => (
                    <ReviewCard
                      key={r.id}
                      review={r}
                      professorName={professorName}
                      busy={helpfulBusy === r.id}
                      onHelpful={() => void toggleHelpful(r)}
                      onReport={() => setReporting(r)}
                      onEdit={() => setForm(r)}
                      onDelete={() => { setDeleteError(null); setDeleting(r) }}
                    />
                  ))}
              </>
            )}
          </section>
        </div>
      )}

      {form !== undefined && (
        <ReviewForm
          subjectId={subjectId}
          subjectName={data.subjectName}
          reviews={all}
          professors={data.professors}
          existing={form}
          onClose={() => setForm(undefined)}
          onSaved={() => { setForm(undefined); setTick((n) => n + 1) }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={t('apuntes.reviews.deleteTitle')}
          body={t('apuntes.reviews.deleteBody', { term: termLabel(deleting) })}
          confirmLabel={t('apuntes.reviews.deleteConfirm')}
          busy={deleteBusy}
          error={deleteError}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setDeleting(null)}
        />
      )}

      {reporting && (
        <ReportDialog<ReviewReportReason>
          fileName={data.subjectName}
          title={t('apuntes.reviews.reportTitle')}
          intro={t('apuntes.reviews.reportIntro')}
          reasons={REVIEW_REPORT_REASONS}
          onSubmit={(reason, comment) => reportReview(reporting.id, reason, comment)}
          onClose={() => setReporting(null)}
          onReported={() => {
            const id = reporting.id
            setReporting(null)
            setData((d) => d && { ...d, reviews: d.reviews.map((x) => (x.id === id ? { ...x, reported: true } : x)) })
            toast.success(t('apuntes.report.thanks'))
          }}
        />
      )}
    </div>
  )
}

function ReviewsSkeleton() {
  return (
    <LoadingRegion className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 pb-6 border-b border-border dark:border-night-border">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-5 w-72" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-8">
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-card!" />)}
        </div>
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-card!" />)}
        </div>
      </div>
    </LoadingRegion>
  )
}
