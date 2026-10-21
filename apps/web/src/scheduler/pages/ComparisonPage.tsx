import { useEffect, useMemo, useState } from 'react'
import { Navigate, Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/hooks/useAuth'
import { getSavedSchedule, type SavedSchedule } from '../api/schedules'
import { type Subject } from '../hooks/useSubjects'
import { usePlanCatalogs } from '../hooks/usePlanCatalogs'
import { ScheduleSlot } from '../types/scheduler'
import { parsePayload, type SavedSchedulePayload } from '../services/workspaceSnapshot'
import { knownSelection } from '../services/commissionNames'
import { careerPlanLabel } from '../utils/careerLabel'
import ScheduleGrid from '../components/ScheduleGrid'
import ScheduleGridSkeleton from '../components/ScheduleGridSkeleton'
import { SCHEDULER_BASE, schedulerPath } from '../paths'
import { Alert, Button, EmptyState, ErrorState, LoadingRegion, Skeleton, buttonClass } from '@/components/ui'

// For each subject we render the combination that was on screen when the
// schedule was saved (`shownCombination`). Older saves don't have it: then
// the FIRST chosen commission (alphabetically) is used so the comparison
// is deterministic, or the subject's first commission when the pick was
// 'any', so the cell isn't empty.
const slotsFromSaved = (
  payload: SavedSchedulePayload | null,
  subjectsByCode: Map<string, Subject>,
): ScheduleSlot[] => {
  if (!payload) return []
  const shown = new Map((payload.shownCombination ?? []).map((c) => [c.subject_id, c.commission]))
  const out: ScheduleSlot[] = []
  for (const sc of payload.selectedCourses) {
    const subject = subjectsByCode.get(sc.subject_id)
    if (!subject) continue
    // Names saved before a commission got (or lost) a suffix are resolved
    // like a restored workspace's (see knownSelection).
    const resolve = (name: string | undefined) => {
      if (!name) return undefined
      const known = knownSelection(subject.commissions, [name]).find((n) => n !== 'any')
      return known ? subject.commissions.find((c) => c.name === known) : undefined
    }
    const shownName = shown.get(sc.subject_id)
    const pickName = [...sc.selectedCommissions].sort().find((n) => n !== 'any')
    const commission = resolve(shownName) || resolve(pickName) || subject.commissions[0]
    if (!commission) continue
    for (const slot of commission.schedule ?? []) {
      out.push({
        day: slot.day,
        dateFrom: commission.course_start ?? subject.course_start,
        dateTo: commission.course_end ?? subject.course_end,
        timeFrom: slot.time_from,
        timeTo: slot.time_to,
        subject: subject.name,
        subject_id: subject.subject_id,
        commission: commission.name,
        building: slot.building,
        classroom: slot.classroom,
      })
    }
  }
  return out
}

const COLUMN_SKELETON = (
  <section className="bg-white dark:bg-night-surface rounded-card border border-border dark:border-night-border p-4 flex flex-col gap-3 min-w-0">
    <Skeleton className="h-5 w-1/2" />
    <Skeleton className="h-3 w-1/3" />
    <ScheduleGridSkeleton />
  </section>
)

export default function ComparisonPage() {
  const { t } = useTranslation()
  const { profile, loading: authLoading } = useAuth()
  const [params] = useSearchParams()
  const ids = useMemo(() => {
    const raw = params.get('ids') ?? ''
    return raw.split(',').map((s) => s.trim()).filter(Boolean)
  }, [params])
  const [attempt, setAttempt] = useState(0)

  // Result of the last fetch, tagged with the ids (and attempt) it was
  // for: anything else (ids changed, retrying, still in flight) counts as
  // loading.
  const [fetched, setFetched] = useState<{ key: string; items: SavedSchedule[]; failedCount: number } | null>(null)
  const fetchKey = `${ids.join(',')}#${attempt}`

  useEffect(() => {
    if (!profile || ids.length < 2) return
    // A response for ids the user already navigated away from must not
    // overwrite the current comparison.
    let ignore = false
    // Show whichever saved schedules loaded; report the rest.
    Promise.allSettled(ids.map((id) => getSavedSchedule(id))).then((results) => {
      if (ignore) return
      const ok = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
      const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      failed.forEach((r) => console.error(r.reason))
      setFetched({ key: fetchKey, items: ok, failedCount: failed.length })
    })
    return () => { ignore = true }
  }, [profile, ids, fetchKey])

  const current = fetched?.key === fetchKey ? fetched : null
  const items = useMemo(() => current?.items ?? [], [current])
  const plans = useMemo(() => items.map((i) => i.plan).filter((p): p is string => !!p), [items])
  const { subjectsByPlan, failedPlans } = usePlanCatalogs(plans)
  const retry = () => setAttempt((n) => n + 1)

  if (!authLoading && !profile) return <Navigate to={SCHEDULER_BASE} replace />

  const backLink = (
    <Link to={schedulerPath('/saved')} className={buttonClass({ variant: 'outline' })}>
      {t('compare.back')}
    </Link>
  )

  let content
  if (ids.length < 2) {
    content = (
      <EmptyState
        title={t('compare.needAtLeastTwoTitle')}
        body={t('compare.needAtLeastTwo')}
        action={<Link to={schedulerPath('/saved')} className={buttonClass()}>{t('compare.pickSchedules')}</Link>}
      />
    )
  } else if (authLoading || !current) {
    content = (
      <LoadingRegion className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {COLUMN_SKELETON}
        <div className="hidden lg:block">{COLUMN_SKELETON}</div>
      </LoadingRegion>
    )
  } else if (items.length === 0) {
    content = (
      <ErrorState
        message={t('compare.loadFailed')}
        onRetry={retry}
        backTo={schedulerPath('/saved')}
        backLabel={t('compare.back')}
      />
    )
  } else {
    // One schedule per row on phones, side by side from lg up.
    const columns = items.length >= 3 ? 'lg:grid-cols-3' : items.length === 2 ? 'lg:grid-cols-2' : ''
    content = (
      <>
        {current.failedCount > 0 && (
          <Alert
            tone="error"
            className="mb-4"
            action={<Button size="sm" variant="outline" onClick={retry}>{t('errors.retry')}</Button>}
          >
            {t('compare.someFailed', { count: current.failedCount })}
          </Alert>
        )}
        {failedPlans.length > 0 && (
          <Alert tone="warning" className="mb-4">
            {t('share.catalogLoadFailed', { plans: failedPlans.join(', ') })}
          </Alert>
        )}
        <div className={`grid grid-cols-1 gap-4 ${columns}`}>
          {items.map((s) => {
            const payload = parsePayload(s.payload)
            const subjectsLoaded = !s.plan || subjectsByPlan.has(s.plan)
            const planSubjects = (s.plan && subjectsByPlan.get(s.plan)) || []
            const subjectsByCode = new Map(planSubjects.map((sub) => [sub.subject_id, sub]))
            const slots = subjectsLoaded ? slotsFromSaved(payload, subjectsByCode) : []
            return (
              <section
                key={s.id}
                className="bg-white dark:bg-night-surface rounded-card border border-border dark:border-night-border p-4 flex flex-col gap-3 min-w-0"
              >
                <header>
                  <h2 className="font-display font-bold text-h5 text-ink-primary dark:text-night-text truncate">
                    {s.name}
                  </h2>
                  <p className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
                    {careerPlanLabel(t, s.careerId, s.plan)}
                  </p>
                </header>
                {subjectsLoaded ? (
                  <ScheduleGrid slots={slots} blockedTimes={payload?.blockedTimes ?? []} />
                ) : (
                  <LoadingRegion><ScheduleGridSkeleton /></LoadingRegion>
                )}
              </section>
            )
          })}
        </div>
      </>
    )
  }

  return (
    <div className="flex flex-col bg-surface dark:bg-night-bg">
      <main id="main-content" tabIndex={-1} className="flex-1 container-content py-section-mobile lg:py-section outline-hidden">
        <header className="mb-6 flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-48">
            <p className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
              {t('compare.label')}
            </p>
            <h1 className="font-display font-bold text-h2 text-ink-primary dark:text-night-text">
              {current ? t('compare.heading', { count: items.length }) : t('compare.label')}
            </h1>
          </div>
          {backLink}
        </header>
        {content}
      </main>
    </div>
  )
}
