import '../../i18nApuntes'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { fetchSubjectFiles, type SubjectFiles } from '../../api/drive'
import { fetchSubjectKb, type SubjectKb } from '../../api/kb'
import WikiArticle, { PagesPanel } from '../../components/apuntes/wiki/WikiArticle'
import RelatedPanel from '../../components/apuntes/wiki/RelatedPanel'
import PinButton from '../../components/apuntes/PinButton'
import PinNotice from '../../components/apuntes/PinNotice'
import { ApiError } from '../../api/client'
import { apuntesErrorMessage, formatDate, formatSize } from '../../utils/apuntes'
import EmptyState from '../../components/apuntes/EmptyState'
import KindIcon from '../../components/apuntes/KindIcon'
import { BTN_PRIMARY } from '../../components/apuntes/buttons'

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
        else setError(apuntesErrorMessage(e, t))
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

  return (
    <main id="main-content" tabIndex={-1} className="outline-none container-content py-section-mobile lg:py-section">
      <nav aria-label={t('apuntes.breadcrumbAria')} className="mb-4 font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
        <Link to="/apuntes" className="hover:text-primary">{t('apuntes.title')}</Link>
        <span aria-hidden="true" className="mx-2">/</span>
        <span>{subjectId}</span>
      </nav>

      <header className="mb-8 pb-6 border-b border-border dark:border-night-border">
        {loading && !data ? (
          <div aria-hidden="true" className="flex flex-col gap-3">
            <div className="h-10 w-2/3 rounded-sm skeleton" />
            <div className="h-4 w-40 rounded-sm skeleton" />
          </div>
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
          </>
        )}
      </header>

      {!notFound && (
        <div role="tablist" aria-label={t('wiki.tabsAria')} className="flex gap-2 border-b border-border dark:border-night-border -mt-4 mb-8">
          {(['wiki', 'archivos'] as Tab[]).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => selectTab(id)}
              className={`px-4 py-2 -mb-px border-b-2 font-mono text-label uppercase tracking-widest transition-colors duration-150 ${
                tab === id ? 'border-primary text-primary' : 'border-transparent text-ink-secondary dark:text-night-muted hover:text-primary'
              }`}
            >
              {t(`wiki.tabs.${id}`)}
              {id === 'archivos' && data && <span className="ml-1.5 opacity-70">{totalFiles}</span>}
            </button>
          ))}
          {kb && (kb.index || kb.pages.length > 0) && (
            <Link
              to={`/apuntes/${encodeURIComponent(subjectId)}/grafo`}
              className="ml-auto self-center font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted hover:text-primary"
            >
              {t('wiki.graphLink')}
            </Link>
          )}
        </div>
      )}

      {tab === null && !notFound && (
        <div className="flex flex-col gap-3" aria-busy="true" aria-hidden="true">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 rounded-card skeleton" />)}
        </div>
      )}

      {tab === 'wiki' && (
        kb?.index ? (
          <WikiArticle
            page={kb.index}
            showTitle={false}
            aside={
              <>
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
            action={<button type="button" onClick={() => selectTab('archivos')} className={BTN_PRIMARY}>{t('wiki.seeFiles')}</button>}
          />
        )
      )}

      {tab === 'archivos' && error && (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="font-body text-body-sm text-red-600 dark:text-red-400">{error}</p>
          <button type="button" onClick={() => setTick((n) => n + 1)} className="font-mono text-label uppercase tracking-widest text-primary hover:underline">
            {t('errors.retry')}
          </button>
        </div>
      )}

      {notFound && (
        <EmptyState
          title={t('apuntes.subject.notFoundTitle')}
          body={t('apuntes.subject.notFoundBody')}
          action={<Link to="/apuntes" className={BTN_PRIMARY}>{t('apuntes.backToSearch')}</Link>}
        />
      )}

      {tab === 'archivos' && loading && !data && !error && (
        <div className="flex flex-col gap-3" aria-busy="true" aria-hidden="true">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 rounded-card skeleton" />)}
        </div>
      )}

      {tab === 'archivos' && data && groups.length === 0 && (
        <EmptyState
          title={t('apuntes.subject.emptyTitle')}
          body={t('apuntes.subject.emptyBody')}
          action={<Link to="/apuntes/mis-apuntes" className={BTN_PRIMARY}>{t('apuntes.home.cta')}</Link>}
        />
      )}

      {tab === 'archivos' && data && groups.length > 0 && (
        <div className="flex flex-col gap-10">
          {groups.map((g) => {
            const author = g.author?.anonymous || !g.author?.name ? t('apuntes.anonymousAuthor') : g.author.name
            return (
              <section key={g.sourceId} aria-label={t('apuntes.subject.byAuthor', { author })}>
                <h2 className="flex items-baseline gap-3 mb-3">
                  <span className="font-display font-bold text-h5 text-ink-primary dark:text-night-text">{author}</span>
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
      <PinNotice />
    </main>
  )
}
