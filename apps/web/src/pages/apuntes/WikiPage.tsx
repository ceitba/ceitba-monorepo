import '../../i18nApuntes'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useLocation, useParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { fetchKbPage, fetchSubjectKb, type KbPage, type KbPageSummary } from '../../api/kb'
import { apuntesErrorCopy } from '../../components/apuntes/errorCopy'
import { EmptyState, ErrorState, LoadingRegion, Skeleton, buttonClass } from '../../components/ui'
import WikiArticle, { PagesPanel } from '../../components/apuntes/wiki/WikiArticle'

// /apuntes/:subjectId/wiki/:slug — one wiki page with its sources,
// backlinks and the subject's other pages.
export default function WikiPage() {
  const { subjectId = '', slug = '' } = useParams()
  const { t } = useTranslation()
  const location = useLocation()
  const [page, setPage] = useState<KbPage | null>(null)
  const [pages, setPages] = useState<KbPageSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [tick, setTick] = useState(0)
  const reqRef = useRef(0)

  useEffect(() => {
    const id = ++reqRef.current
    setLoading(true); setError(null); setNotFound(false)
    fetchKbPage(subjectId, slug)
      .then((res) => { if (reqRef.current === id) setPage(res) })
      .catch((e) => {
        if (reqRef.current !== id) return
        setPage(null)
        if (e instanceof ApiError && e.status === 404) setNotFound(true)
        else setError(apuntesErrorCopy(e, t))
      })
      .finally(() => { if (reqRef.current === id) setLoading(false) })
  }, [subjectId, slug, tick, t])

  // The sibling list only changes per subject.
  useEffect(() => {
    let cancelled = false
    fetchSubjectKb(subjectId)
      .then((kb) => { if (!cancelled) setPages(kb.pages ?? []) })
      .catch(() => { if (!cancelled) setPages([]) })
    return () => { cancelled = true }
  }, [subjectId])

  // New page without a hash: start at the top. Hash targets are scrolled
  // to (and flashed) by WikiMarkdown once the lazy body has rendered.
  useEffect(() => {
    if (page && !location.hash) window.scrollTo(0, 0)
    // Only when the page itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page?.id])

  if (slug === 'index') return <Navigate to={`/apuntes/${encodeURIComponent(subjectId)}`} replace />

  return (
    <main id="main-content" tabIndex={-1} className="outline-none container-content py-section-mobile lg:py-section">
      <nav aria-label={t('apuntes.breadcrumbAria')} className="mb-4 font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted flex flex-wrap items-center gap-x-2">
        <Link to="/apuntes" className="hover:text-primary">{t('apuntes.title')}</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/apuntes/${encodeURIComponent(subjectId)}?vista=wiki`} className="hover:text-primary normal-case tracking-normal">
          {page?.subjectName ?? subjectId}
        </Link>
        <span aria-hidden="true">/</span>
        <span>{t('wiki.tabs.wiki')}</span>
      </nav>

      {loading && !page && (
        <LoadingRegion className="flex flex-col gap-4 max-w-[70ch]">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-[40vh] !rounded-card" />
        </LoadingRegion>
      )}

      {error && (
        <ErrorState
          message={error}
          onRetry={() => setTick((n) => n + 1)}
          backTo={`/apuntes/${encodeURIComponent(subjectId)}`}
          backLabel={t('wiki.backToSubject')}
        />
      )}

      {notFound && (
        <EmptyState
          title={t('wiki.notFoundTitle')}
          body={t('wiki.notFoundBody')}
          action={<Link to={`/apuntes/${encodeURIComponent(subjectId)}`} className={buttonClass()}>{t('wiki.backToSubject')}</Link>}
        />
      )}

      {page && (
        <WikiArticle
          key={page.id}
          page={page}
          aside={
            <>
              <PagesPanel subjectId={page.subjectId} pages={pages} currentSlug={page.slug} />
              <Link
                to="/ia"
                className="block rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface p-4 hover:border-primary transition-colors duration-150"
              >
                <span className="block font-display font-bold text-h5 text-ink-primary dark:text-night-text">{t('wiki.askAi.title')}</span>
                <span className="block font-body text-body-sm text-ink-secondary dark:text-night-muted mt-1">{t('wiki.askAi.body')}</span>
              </Link>
            </>
          }
        />
      )}
    </main>
  )
}
