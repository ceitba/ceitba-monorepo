import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { fetchApunteSubjects, fetchMyPlanSubjects, type ApunteSubject } from '../../api/drive'
import { useDebounced } from '../../hooks/useDebounced'
import { apuntesErrorMessage, formatDate } from '../../utils/apuntes'
import EmptyState from '../../components/apuntes/EmptyState'
import { BTN_PRIMARY, INPUT } from '../../components/apuntes/buttons'

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

  useEffect(() => {
    fetchMyPlanSubjects()
      .then((res) => setMine(res ?? []))
      .catch(() => setMineFailed(true))
  }, [])

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
      .catch((e) => { if (reqRef.current === id) setError(apuntesErrorMessage(e, t)) })
      .finally(() => { if (reqRef.current === id) setLoading(false) })
  }, [debounced, tick, t])

  const searching = debounced !== ''

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
            <Link to="/apuntes/mis-apuntes" className={`${BTN_PRIMARY} self-start`}>
              {t('apuntes.home.cta')}
            </Link>
          </div>
        </div>
      </section>

      <section className="container-content py-10 lg:py-14" aria-labelledby="apuntes-list-heading">
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
            className={`${INPUT} pl-10 py-3 text-body`}
            autoComplete="off"
          />
        </div>

        {!searching && !mineFailed && (
          <section aria-labelledby="apuntes-mine-heading" className="mt-10">
            <h2 id="apuntes-mine-heading" className="font-display font-bold text-h4 text-ink-primary dark:text-night-text mb-1">
              {t('apuntes.home.mine')}
            </h2>
            {mine == null ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-3" aria-busy="true" aria-hidden="true">
                {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-24 rounded-card skeleton" />)}
              </div>
            ) : mine.length === 0 ? (
              <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">
                {t('apuntes.home.mineNoPlan')}{' '}
                <Link to="/profile" className="text-primary underline">{t('apuntes.home.mineNoPlanLink')}</Link>
              </p>
            ) : (
              <>
                <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted mb-4">{t('apuntes.home.mineHint')}</p>
                <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {mine.map((s) => (
                    <li key={s.subjectId}><SubjectCard subject={s} lang={i18n.language} /></li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}

        <h2 id="apuntes-list-heading" className="font-display font-bold text-h4 text-ink-primary dark:text-night-text mt-10 mb-4">
          {searching ? t('apuntes.home.results', { q: debounced }) : t('apuntes.home.recent')}
        </h2>

        {loading && subjects == null && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" aria-busy="true" aria-hidden="true">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-24 rounded-card skeleton" />)}
          </div>
        )}

        {error && !loading && (
          <div role="alert" className="flex flex-col items-start gap-3 py-6">
            <p className="font-body text-body-sm text-red-600 dark:text-red-400">{error}</p>
            <button type="button" onClick={() => setTick((n) => n + 1)} className="font-mono text-label uppercase tracking-widest text-primary hover:underline">
              {t('errors.retry')}
            </button>
          </div>
        )}

        {!error && subjects != null && subjects.length === 0 && !loading && (
          searching ? (
            <EmptyState title={t('apuntes.home.noMatches')} body={t('apuntes.home.noMatchesHint')} />
          ) : (
            <EmptyState
              title={t('apuntes.home.emptyTitle')}
              body={t('apuntes.home.emptyBody')}
              action={<Link to="/apuntes/mis-apuntes" className={BTN_PRIMARY}>{t('apuntes.home.cta')}</Link>}
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
    </main>
  )
}

function SubjectCard({ subject: s, lang }: { subject: ApunteSubject; lang: string }) {
  const { t } = useTranslation()
  return (
    <Link
      to={`/apuntes/${encodeURIComponent(s.subjectId)}`}
      className={`group h-full flex flex-col gap-2 p-5 rounded-card border bg-white dark:bg-night-surface shadow-card hover:shadow-card-hover transition-shadow duration-200 ${
        s.fileCount > 0 ? 'border-border dark:border-night-border' : 'border-dashed border-border dark:border-night-border'
      }`}
    >
      <span className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
        {s.subjectId}
        {s.year != null && ` · ${t('apuntes.picker.planYear', { year: s.year })}`}
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
  )
}
