import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useLocation, useParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { fetchKbPage, fetchSubjectKb, type KbPage, type KbPageSummary } from '../../api/kb'
import { apuntesErrorMessage } from '../../utils/apuntes'
import EmptyState from '../../components/apuntes/EmptyState'
import WikiArticle, { PagesPanel } from '../../components/apuntes/wiki/WikiArticle'
import { BTN_PRIMARY } from '../../components/apuntes/buttons'

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
        else setError(apuntesErrorMessage(e, t))
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

  // Scroll to the heading in the hash once the (lazy) body has rendered.
  useEffect(() => {
    if (!page) { window.scrollTo(0, 0); return }
    if (!location.hash) { window.scrollTo(0, 0); return }
    const id = decodeURIComponent(location.hash.slice(1))
    let tries = 0
    const timer = window.setInterval(() => {
      const el = document.getElementById(id)
      if (el || ++tries > 20) {
        window.clearInterval(timer)
        el?.scrollIntoView()
      }
    }, 100)
    return () => window.clearInterval(timer)
  }, [page, location.hash])

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
        <div aria-busy="true" aria-hidden="true" className="flex flex-col gap-4 max-w-[70ch]">
          <div className="h-10 w-2/3 rounded-sm skeleton" />
          <div className="h-4 w-full rounded-sm skeleton" />
          <div className="h-4 w-5/6 rounded-sm skeleton" />
          <div className="h-[40vh] rounded-card skeleton" />
        </div>
      )}

      {error && (
        <div role="alert" className="flex flex-col items-start gap-3 py-6">
          <p className="font-body text-body-sm text-red-600 dark:text-red-400">{error}</p>
          <button type="button" onClick={() => setTick((n) => n + 1)} className="font-mono text-label uppercase tracking-widest text-primary hover:underline">
            {t('errors.retry')}
          </button>
        </div>
      )}

      {notFound && (
        <EmptyState
          title={t('wiki.notFoundTitle')}
          body={t('wiki.notFoundBody')}
          action={<Link to={`/apuntes/${encodeURIComponent(subjectId)}`} className={BTN_PRIMARY}>{t('wiki.backToSubject')}</Link>}
        />
      )}

      {page && (
        <WikiArticle
          key={page.id}
          page={page}
          aside={<PagesPanel subjectId={page.subjectId} pages={pages} currentSlug={page.slug} />}
        />
      )}
    </main>
  )
}
