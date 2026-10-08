import '../../i18nApuntes'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { fetchApunteSubjects, fetchMyPlanSubjects, type ApunteSubject } from '../../api/drive'
import { useDebounced } from '../../hooks/useDebounced'
import { groupPlanSubjects, semesterLabel } from '../../utils/planGroups'
import { formatDate } from '../../utils/apuntes'
import { CloseIcon, EmptyState, ErrorState, IconButton, SkeletonCards, buttonClass, inputClass } from '../../components/ui'
import { apuntesErrorCopy } from '../../components/apuntes/errorCopy'
import PinButton, { PinIcon } from '../../components/apuntes/PinButton'
import PinNotice from '../../components/apuntes/PinNotice'
import { usePins } from '../../hooks/usePins'

// The correlatividades card loads after first paint so it never slows the
// page down.
const CorrelativasMini = lazy(() => import('../../components/apuntes/correlativas/CorrelativasMini'))

const PIN_HINT_KEY = 'apuntes.pinHintDismissed'

function readHintDismissed(): boolean {
  try { return localStorage.getItem(PIN_HINT_KEY) === '1' } catch { return false }
}

// /apuntes — find a subject's notes. With no query it lists the subjects
// with the most recently updated notes; typing searches every subject by
// code or name. `q` lives in the URL so back/forward keeps the search.
export default function ApuntesHomePage() {
  const { t, i18n } = useTranslation()
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState(params.get('q') ?? '')
  const debounced = useDebounced(query.trim(), 300)
  const [subjects, setSubjects] = useState<ApunteSubject[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const reqRef = useRef(0)
  // The student's plan subjects ("Tus materias"); [] without a plan.
  const [mine, setMine] = useState<ApunteSubject[] | null>(null)
  const [mineFailed, setMineFailed] = useState(false)
  const [mineTick, setMineTick] = useState(0)

  useEffect(() => {
    setMineFailed(false)
    setMine(null)
    fetchMyPlanSubjects()
      .then((res) => setMine(res ?? []))
      .catch((e) => { console.error(e); setMineFailed(true) })
  }, [mineTick])

  useEffect(() => {
    const next = new URLSearchParams(params)
    if (debounced) next.set('q', debounced)
    else next.delete('q')
    if (next.toString() !== params.toString()) setParams(next, { replace: true })
    // Only react to the debounced value; params is read, not tracked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])

  useEffect(() => {
    const id = ++reqRef.current
    setLoading(true)
    fetchApunteSubjects(debounced || undefined, 20)
      .then((res) => { if (reqRef.current === id) { setSubjects(res); setError(null) } })
      .catch((e) => { if (reqRef.current === id) setError(apuntesErrorCopy(e, t)) })
      .finally(() => { if (reqRef.current === id) setLoading(false) })
  }, [debounced, tick, t])

  const searching = debounced !== ''
  const { pins } = usePins()
  const [hintDismissed, setHintDismissed] = useState(readHintDismissed)
  const [showCorr, setShowCorr] = useState(false)

  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
    const go = () => setShowCorr(true)
    if (w.requestIdleCallback) w.requestIdleCallback(go, { timeout: 1500 })
    else window.setTimeout(go, 300)
  }, [])

  // Once something is pinned the hint has done its job.
  useEffect(() => {
    if (pins && pins.length > 0 && !hintDismissed) {
      try { localStorage.setItem(PIN_HINT_KEY, '1') } catch { /* storage blocked */ }
      setHintDismissed(true)
    }
  }, [pins, hintDismissed])

  function dismissHint() {
    try { localStorage.setItem(PIN_HINT_KEY, '1') } catch { /* storage blocked */ }
    setHintDismissed(true)
  }

  return (
    <main id="main-content" tabIndex={-1} className="outline-none">
      <section className="bg-white dark:bg-night-raised border-b border-border dark:border-night-border">
        <div className="container-content py-section-mobile lg:py-14 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-8">
          <div className="max-w-2xl">
            <span className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
              {t('apuntes.home.eyebrow')}
            </span>
            <h1 className="font-display font-bold text-h2 lg:text-h1 text-ink-primary dark:text-night-text mt-1">
              {t('apuntes.home.title')}
            </h1>
            <p className="font-body text-body-lg text-ink-secondary dark:text-night-muted mt-3">
              {t('apuntes.home.subtitle')}
            </p>
          </div>
          <div className="lg:max-w-xs p-5 rounded-card border border-accent-200 dark:border-accent-800 bg-accent-50 dark:bg-accent-900/20 flex flex-col gap-3">
            <p className="font-display font-bold text-h5 text-ink-primary dark:text-night-text">{t('apuntes.home.ctaTitle')}</p>
            <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('apuntes.home.ctaBody')}</p>
            <Link to="/apuntes/mis-apuntes" className={buttonClass({ className: 'self-start' })}>
              {t('apuntes.home.cta')}
            </Link>
          </div>
        </div>
      </section>

      <section className="container-content py-10 lg:py-14" aria-labelledby="apuntes-list-heading">
        {pins && pins.length > 0 && (
          <section aria-labelledby="apuntes-pins-heading" className="mb-8">
            <h2 id="apuntes-pins-heading" className="flex items-center gap-2 font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted mb-3">
              <span className="text-accent-600 dark:text-accent-300"><PinIcon filled size={14} /></span>
              {t('apuntes.pins.title')}
            </h2>
            <ul className="grid grid-cols-1 min-[420px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {pins.map((p) => (
                <li key={p.subjectId} className="relative">
                  <Link
                    to={`/apuntes/${encodeURIComponent(p.subjectId)}`}
                    className="group h-full flex flex-col gap-1 pl-4 pr-11 py-3 rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface hover:border-primary transition-colors duration-150"
                  >
                    <span className="flex items-center gap-2 font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
                      {p.subjectId}
                      {p.hasWiki && (
                        <span className="px-1.5 rounded-sm bg-primary-50 dark:bg-primary-900 text-primary-700 dark:text-primary-200 normal-case tracking-normal">
                          {t('apuntes.pins.wiki')}
                        </span>
                      )}
                    </span>
                    <span className="font-body font-semibold text-body-sm text-ink-primary dark:text-night-text group-hover:text-primary line-clamp-2">
                      {p.subjectName}
                    </span>
                    <span className="font-mono text-label text-ink-secondary dark:text-night-muted">
                      {p.fileCount > 0 ? t('apuntes.home.fileCount', { count: p.fileCount }) : t('apuntes.home.noFilesYet')}
                    </span>
                  </Link>
                  <PinButton subject={p} className="absolute top-2 right-2" />
                </li>
              ))}
            </ul>
          </section>
        )}
        {showCorr && !searching && (
          <Suspense fallback={null}>
            <CorrelativasMini />
          </Suspense>
        )}
        {pins && pins.length === 0 && !hintDismissed && (
          <p className="mb-6 flex items-center gap-2 font-body text-body-sm text-ink-secondary dark:text-night-muted">
            <span className="text-accent-600 dark:text-accent-300"><PinIcon size={14} /></span>
            <span className="flex-1">{t('apuntes.pins.hint')}</span>
            <IconButton size="sm" onClick={dismissHint} aria-label={t('errors.dismiss')}><CloseIcon size={16} /></IconButton>
          </p>
        )}
        <label htmlFor="apuntes-search" className="sr-only">{t('apuntes.home.searchLabel')}</label>
        <div className="relative max-w-2xl">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-secondary dark:text-night-muted">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            id="apuntes-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('apuntes.home.searchPlaceholder')}
            className={inputClass({ className: 'pl-10 text-body' })}
            autoComplete="off"
          />
        </div>

        {!searching && (
          <section aria-labelledby="apuntes-mine-heading" className="mt-10">
            <h2 id="apuntes-mine-heading" className="font-display font-bold text-h4 text-ink-primary dark:text-night-text mb-1">
              {t('apuntes.home.mine')}
            </h2>
            {mineFailed ? (
              <ErrorState compact message={t('apuntes.home.mineFailed')} onRetry={() => setMineTick((n) => n + 1)} />
            ) : mine == null ? (
              <SkeletonCards count={3} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-3" cardClassName="h-24" />
            ) : mine.length === 0 ? (
              <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">
                {t('apuntes.home.mineNoPlan')}{' '}
                <Link to="/profile" className="text-primary underline">{t('apuntes.home.mineNoPlanLink')}</Link>
              </p>
            ) : (
              <>
                <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted mb-4">{t('apuntes.home.mineHint')}</p>
                <div className="flex flex-col gap-6">
                  {groupPlanSubjects(mine, t).map((g) => (
                    // Curricular years open; elective sections (long) start collapsed.
                    <details key={g.key} open={g.curricular} className="group/plan">
                      <summary className="cursor-pointer list-none flex items-baseline gap-2 mb-3 select-none">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true" className="text-ink-secondary dark:text-night-muted transition-transform duration-150 group-open/plan:rotate-90 self-center">
                          <polyline points="9 6 15 12 9 18" />
                        </svg>
                        <span className="font-display font-bold text-h5 text-ink-primary dark:text-night-text">{g.label}</span>
                        <span className="font-mono text-label text-ink-secondary dark:text-night-muted">
                          {t('apuntes.plan.subjectCount', { count: g.subjects.length })}
                        </span>
                      </summary>
                      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {g.subjects.map((s) => (
                          <li key={s.subjectId}><SubjectCard subject={s} lang={i18n.language} /></li>
                        ))}
                      </ul>
                    </details>
                  ))}
                </div>
              </>
            )}
          </section>
        )}

        <h2 id="apuntes-list-heading" className="font-display font-bold text-h4 text-ink-primary dark:text-night-text mt-10 mb-4">
          {searching ? t('apuntes.home.results', { q: debounced }) : t('apuntes.home.recent')}
        </h2>

        {loading && subjects == null && <SkeletonCards count={6} cardClassName="h-24" />}

        {error && !loading && <ErrorState message={error} onRetry={() => setTick((n) => n + 1)} />}

        {!error && subjects != null && subjects.length === 0 && !loading && (
          searching ? (
            <EmptyState title={t('apuntes.home.noMatches')} body={t('apuntes.home.noMatchesHint')} />
          ) : (
            <EmptyState
              title={t('apuntes.home.emptyTitle')}
              body={t('apuntes.home.emptyBody')}
              action={<Link to="/apuntes/mis-apuntes" className={buttonClass({ variant: 'outline' })}>{t('apuntes.home.cta')}</Link>}
            />
          )
        )}

        {!error && subjects != null && subjects.length > 0 && (
          <ul className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 ${loading ? 'opacity-60' : ''}`}>
            {subjects.map((s) => (
              <li key={s.subjectId}><SubjectCard subject={s} lang={i18n.language} /></li>
            ))}
          </ul>
        )}
      </section>
      <PinNotice />
    </main>
  )
}

function SubjectCard({ subject: s, lang }: { subject: ApunteSubject; lang: string }) {
  const { t } = useTranslation()
  const { pins } = usePins()
  // hasWiki from the API, else (older builds) from the pins list.
  const hasWiki = s.hasWiki ?? !!pins?.find((p) => p.subjectId === s.subjectId)?.hasWiki
  return (
    <div className="relative h-full">
      <Link
        to={`/apuntes/${encodeURIComponent(s.subjectId)}`}
        className={`group h-full flex flex-col gap-2 p-5 pr-12 rounded-card border bg-white dark:bg-night-surface shadow-card hover:shadow-card-hover transition-shadow duration-200 ${
          s.fileCount > 0 ? 'border-border dark:border-night-border' : 'border-dashed border-border dark:border-night-border'
        }`}
      >
        <span className="flex flex-wrap items-center gap-2 font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
          <span>
            {s.subjectId}
            {semesterLabel(s, t) && ` · ${semesterLabel(s, t)}`}
          </span>
          {hasWiki && (
            <span className="px-1.5 rounded-sm bg-primary-50 dark:bg-primary-900 text-primary-700 dark:text-primary-200 normal-case tracking-normal">
              {t('apuntes.pins.wiki')}
            </span>
          )}
        </span>
        <span className="font-display font-bold text-h5 text-ink-primary dark:text-night-text group-hover:text-primary transition-colors duration-150 line-clamp-2">
          {s.subjectName}
        </span>
        <span className="mt-auto font-mono text-label text-ink-secondary dark:text-night-muted">
          {s.fileCount > 0
            ? t('apuntes.home.fileCount', { count: s.fileCount })
            : t('apuntes.home.noFilesYet')}
          {s.lastUpdatedAt && ` · ${t('apuntes.home.updated', { date: formatDate(s.lastUpdatedAt, lang) })}`}
        </span>
      </Link>
      <PinButton
        subject={{ subjectId: s.subjectId, subjectName: s.subjectName, fileCount: s.fileCount, hasWiki }}
        className="absolute top-3 right-3"
      />
    </div>
  )
}
