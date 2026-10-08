import '../../i18nApuntes'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { fetchSubjectFiles, type FileSummary, type SubjectFiles } from '../../api/drive'
import YearBadge from '../../components/apuntes/YearBadge'
import { fetchSubjectKb, type SubjectKb } from '../../api/kb'
import WikiArticle, { PagesPanel } from '../../components/apuntes/wiki/WikiArticle'
import RelatedPanel from '../../components/apuntes/wiki/RelatedPanel'
import PinButton from '../../components/apuntes/PinButton'
import PinNotice from '../../components/apuntes/PinNotice'
import SubjectCorrelativas from '../../components/apuntes/correlativas/SubjectCorrelativas'
import { ApiError } from '../../api/client'
import { authorName, formatDate, formatSize, isCommunity } from '../../utils/apuntes'
import { apuntesErrorCopy } from '../../components/apuntes/errorCopy'
import CommunityBadge from '../../components/apuntes/CommunityBadge'
import { Button, EmptyState, ErrorState, LoadingRegion, Skeleton, Tabs, ToggleGroup, buttonClass, selectClass } from '../../components/ui'
import KindIcon from '../../components/apuntes/KindIcon'

const SubjectGraphThumb = lazy(() => import('../../components/apuntes/graph/SubjectGraphThumb'))

type Tab = 'wiki' | 'archivos'

// /apuntes/:subjectId — a subject's Apuntes, in two tabs: Wiki (the AI
// wiki's index page, its pages and related subjects; default when there is
// an index) and Archivos (published files grouped by the student who shared
// them). The tab lives in ?vista=.
export default function SubjectFilesPage() {
  const { subjectId = '' } = useParams()
  const { t, i18n } = useTranslation()
  const [params, setParams] = useSearchParams()
  const [kb, setKb] = useState<SubjectKb | null>(null)
  const [kbLoaded, setKbLoaded] = useState(false)
  const [data, setData] = useState<SubjectFiles | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [tick, setTick] = useState(0)
  const reqRef = useRef(0)

  useEffect(() => {
    const id = ++reqRef.current
    setLoading(true); setError(null); setNotFound(false)
    fetchSubjectFiles(subjectId)
      .then((res) => { if (reqRef.current === id) setData(res) })
      .catch((e) => {
        if (reqRef.current !== id) return
        setData(null)
        if (e instanceof ApiError && e.status === 404) setNotFound(true)
        else setError(apuntesErrorCopy(e, t))
      })
      .finally(() => { if (reqRef.current === id) setLoading(false) })
  }, [subjectId, tick, t])

  useEffect(() => {
    let cancelled = false
    setKb(null); setKbLoaded(false)
    // No wiki (404) or a failure both mean "files only".
    fetchSubjectKb(subjectId)
      .then((res) => { if (!cancelled) setKb(res) })
      .catch(() => { if (!cancelled) setKb(null) })
      .finally(() => { if (!cancelled) setKbLoaded(true) })
    return () => { cancelled = true }
  }, [subjectId])

  const requested = params.get('vista')
  const tab: Tab | null = requested === 'wiki' || requested === 'archivos'
    ? requested
    : kbLoaded ? (kb?.index ? 'wiki' : 'archivos') : null

  function selectTab(next: Tab) {
    const qs = new URLSearchParams(params)
    qs.set('vista', next)
    setParams(qs, { replace: true })
  }

  const groups = (data?.groups ?? []).filter((g) => g.files.length > 0)
  const totalFiles = groups.reduce((n, g) => n + g.files.length, 0)

  // Files tab: newest material first by default (academic year, then
  // name), or the folder order; optional year filter.
  const [sort, setSort] = useState<'recent' | 'folder'>('recent')
  const [yearFilter, setYearFilter] = useState<number | 'none' | null>(null)
  useEffect(() => { setYearFilter(null) }, [subjectId])
  const yearChips = (() => {
    const years = new Set<number>()
    let none = false
    groups.forEach((g) => g.files.forEach((f) => { if (f.academicYear != null) years.add(f.academicYear); else none = true }))
    return { years: [...years].sort((a, b) => b - a), none }
  })()
  const showYearChips = yearChips.years.length + (yearChips.none ? 1 : 0) > 1
  const hasEstimatedYear = groups.some((g) => g.files.some((f) => f.academicYear != null && f.academicYearSource === 'DRIVE'))
  const hasCommunity = groups.some((g) => isCommunity(g) || g.files.some((f) => f.community))
  const byRecent = (a: FileSummary, b: FileSummary) =>
    (b.academicYear ?? -Infinity) - (a.academicYear ?? -Infinity) ||
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  const shownGroups = groups
    .map((g) => {
      let files = g.files.filter((f) =>
        yearFilter == null ? true : yearFilter === 'none' ? f.academicYear == null : f.academicYear === yearFilter)
      if (sort === 'recent') files = [...files].sort(byRecent)
      return { ...g, files }
    })
    .filter((g) => g.files.length > 0)
    .sort((a, b) => (sort === 'recent' ? byRecent(a.files[0], b.files[0]) : 0))

  return (
    <main id="main-content" tabIndex={-1} className="outline-none container-content py-section-mobile lg:py-section">
      <nav aria-label={t('apuntes.breadcrumbAria')} className="mb-4 font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
        <Link to="/apuntes" className="hover:text-primary">{t('apuntes.title')}</Link>
        <span aria-hidden="true" className="mx-2">/</span>
        <span>{subjectId}</span>
      </nav>

      <header className="mb-8 pb-6 border-b border-border dark:border-night-border">
        {loading && !data ? (
          <LoadingRegion className="flex flex-col gap-3">
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="h-4 w-40" />
          </LoadingRegion>
        ) : (
          <>
            <span className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
              {data?.subjectId ?? subjectId}
            </span>
            <div className="flex items-start gap-3 mt-1">
              <h1 className="font-display font-bold text-h3 lg:text-h2 text-ink-primary dark:text-night-text min-w-0 flex-1">
                {data?.subjectName ?? kb?.subjectName ?? (notFound ? t('apuntes.subject.notFoundTitle') : subjectId)}
              </h1>
              {!notFound && (data || kb) && (
                <PinButton
                  size="md"
                  className="mt-1"
                  subject={{
                    subjectId,
                    subjectName: data?.subjectName ?? kb?.subjectName ?? subjectId,
                    fileCount: data ? totalFiles : null,
                    hasWiki: kb ? !!kb.index : null,
                  }}
                />
              )}
            </div>
            {data && (
              <p className="font-body text-body text-ink-secondary dark:text-night-muted mt-2">
                {t('apuntes.subject.summary', { count: totalFiles, authors: groups.length })}
              </p>
            )}
            {!notFound && <SubjectCorrelativas subjectId={subjectId} />}
          </>
        )}
      </header>

      {!notFound && (
        <div className="flex items-end gap-2 border-b border-border dark:border-night-border -mt-4 mb-8">
          {tab != null && (
            <Tabs
              className="!border-b-0 flex-1 min-w-0"
              items={(['wiki', 'archivos'] as Tab[]).map((id) => ({
                id,
                label: t(`wiki.tabs.${id}`),
                count: id === 'archivos' && data ? totalFiles : null,
              }))}
              active={tab}
              onChange={selectTab}
              label={t('wiki.tabsAria')}
              idPrefix={TABS_ID}
            />
          )}
          {kb && (kb.index || kb.pages.length > 0) && (
            <Link
              to={`/apuntes/${encodeURIComponent(subjectId)}/grafo`}
              className="ml-auto self-center inline-flex items-center min-h-[44px] font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted hover:text-primary"
            >
              {t('wiki.graphLink')}
            </Link>
          )}
        </div>
      )}

      {/* Also while ?vista=wiki waits for /kb, so "no wiki" never flashes. */}
      {(tab === null || (tab === 'wiki' && !kbLoaded)) && !notFound && <FileListSkeleton />}

      <div
        role={tab != null && !notFound ? 'tabpanel' : undefined}
        id={tab != null ? `${TABS_ID}-panel-${tab}` : undefined}
        aria-labelledby={tab != null && !notFound ? `${TABS_ID}-tab-${tab}` : undefined}
      >
      {tab === 'wiki' && kbLoaded && (
        kb?.index ? (
          <WikiArticle
            page={kb.index}
            showTitle={false}
            aside={
              <>
                <Suspense fallback={null}><SubjectGraphThumb subjectId={subjectId} /></Suspense>
                <PagesPanel subjectId={subjectId} pages={kb.pages} />
                <RelatedPanel related={kb.related} />
              </>
            }
          />
        ) : kb && kb.pages.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
            <PagesPanel subjectId={subjectId} pages={kb.pages} />
            <RelatedPanel related={kb.related} />
          </div>
        ) : (
          <EmptyState
            title={t('wiki.emptyTitle')}
            body={t('wiki.emptyBody')}
            action={<Button onClick={() => selectTab('archivos')}>{t('wiki.seeFiles')}</Button>}
          />
        )
      )}

      {tab === 'archivos' && error && (
        <ErrorState message={error} onRetry={() => setTick((n) => n + 1)} backTo="/apuntes" backLabel={t('apuntes.backToSearch')} />
      )}

      {notFound && (
        <EmptyState
          title={t('apuntes.subject.notFoundTitle')}
          body={t('apuntes.subject.notFoundBody')}
          action={<Link to="/apuntes" className={buttonClass()}>{t('apuntes.backToSearch')}</Link>}
        />
      )}

      {tab === 'archivos' && loading && !data && !error && <FileListSkeleton />}

      {tab === 'archivos' && data && groups.length === 0 && (
        <EmptyState
          title={t('apuntes.subject.emptyTitle')}
          body={t('apuntes.subject.emptyBody')}
          action={<Link to="/apuntes/mis-apuntes" className={buttonClass()}>{t('apuntes.home.cta')}</Link>}
        />
      )}

      {tab === 'archivos' && data && groups.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          {showYearChips ? (
            <ToggleGroup<number | 'none' | null>
              label={t('apuntes.year.filterAria')}
              value={yearFilter}
              onChange={setYearFilter}
              options={[
                { key: 'all', value: null, label: t('apuntes.year.all') },
                ...yearChips.years.map((y) => ({ value: y, label: String(y) })),
                ...(yearChips.none ? [{ value: 'none' as const, label: t('apuntes.year.none') }] : []),
              ]}
            />
          ) : <span />}
          <label className="inline-flex items-center gap-2 font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
            {t('apuntes.year.sortLabel')}
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as 'recent' | 'folder')}
              className={selectClass({ className: '!w-auto normal-case tracking-normal' })}
            >
              <option value="recent">{t('apuntes.year.sortRecent')}</option>
              <option value="folder">{t('apuntes.year.sortFolder')}</option>
            </select>
          </label>
        </div>
      )}

      {tab === 'archivos' && data && groups.length > 0 && (
        <div className="flex flex-col gap-10">
          {/* What the badges mean, spelled out once instead of in tooltips. */}
          {(hasEstimatedYear || hasCommunity) && (
            <ul className="-mt-4 flex flex-col gap-1 font-body text-label text-ink-secondary dark:text-night-muted">
              {hasEstimatedYear && <li>{t('apuntes.year.estimatedLegend')}</li>}
              {hasCommunity && <li><CommunityBadge className="mr-2" /> {t('apuntes.community.hint')}</li>}
            </ul>
          )}
          {shownGroups.map((g) => {
            const community = isCommunity(g) || g.files.some((f) => f.community)
            const author = community ? t('apuntes.community.label') : authorName(g.author, t)
            return (
              <section key={g.sourceId} aria-label={t('apuntes.subject.byAuthor', { author })}>
                <h2 className="flex items-baseline gap-3 mb-3">
                  {community
                    ? <CommunityBadge className="self-center" />
                    : <span className="font-display font-bold text-h5 text-ink-primary dark:text-night-text">{author}</span>}
                  <span className="font-mono text-label text-ink-secondary dark:text-night-muted">
                    {t('apuntes.home.fileCount', { count: g.files.length })}
                  </span>
                </h2>
                <ul className="rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface divide-y divide-border dark:divide-night-border">
                  {g.files.map((f) => (
                    <li key={f.id}>
                      <Link
                        to={`/apuntes/archivo/${encodeURIComponent(f.id)}`}
                        className="group flex items-start gap-3 px-4 py-3 hover:bg-primary-50 dark:hover:bg-primary-900/40 transition-colors duration-100"
                      >
                        <KindIcon kind={f.kind} size={20} className="mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <p className="font-body text-body text-ink-primary dark:text-night-text group-hover:text-primary break-words">
                            {f.name}
                            {community || f.community
                              ? f.academicYear != null && <CommunityBadge year={f.academicYear} className="ml-2 align-middle" />
                              : <YearBadge year={f.academicYear} source={f.academicYearSource} className="ml-2 align-middle" />}
                          </p>
                          {f.path && (
                            <p className="font-mono text-label text-ink-secondary dark:text-night-muted break-words">{f.path}</p>
                          )}
                          <p className="sm:hidden font-mono text-label text-ink-secondary dark:text-night-muted">
                            {[f.driveModifiedAt ? formatDate(f.driveModifiedAt, i18n.language) : '', formatSize(f.sizeBytes)]
                              .filter(Boolean).join(' · ')}
                          </p>
                        </div>
                        <div className="hidden sm:flex flex-col items-end gap-0.5 flex-shrink-0 font-mono text-label text-ink-secondary dark:text-night-muted">
                          {f.driveModifiedAt && (
                            <time dateTime={f.driveModifiedAt}>{formatDate(f.driveModifiedAt, i18n.language)}</time>
                          )}
                          {f.sizeBytes != null && <span>{formatSize(f.sizeBytes)}</span>}
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      )}
      </div>
      <PinNotice />
    </main>
  )
}

const TABS_ID = 'subject-tabs'

function FileListSkeleton() {
  return (
    <LoadingRegion className="flex flex-col gap-3">
      {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 !rounded-card" />)}
    </LoadingRegion>
  )
}
