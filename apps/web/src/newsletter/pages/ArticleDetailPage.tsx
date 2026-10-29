import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ErrorState, LoadingRegion } from '@/components/ui'
import { ApiError } from '@/api/client'
import CategoryBadge from '../components/CategoryBadge'
import { useCategoryLabel } from '../hooks/useCategoryLabel'
import ArticleCard from '../components/ArticleCard'
import ArticleBody from '../components/article/ArticleBody'
import VoteButtons from '../components/VoteButtons'
import CommentsSection from '../components/engagement/CommentsSection'
import { fetchArticleById, fetchArticles } from '../api/articles'
import { trackEvent } from '../store/analyticsStore'
import { formatDate as formatLocalDate } from '../utils/dates'
import { articleDescription } from '../utils/seo'
import { useCanonical, useDocumentTitle, useMetaDescription, useNoIndex } from '@/hooks/useDocumentTitle'
import { articlePath, newsletterPath } from '@/newsletter/paths'
import type { Article } from '../types'

const GEO_BG: Record<string, string> = {
  blue:   'bg-primary-500',
  amber:  'bg-accent-400',
  green:  'bg-emerald-600',
  violet: 'bg-violet-600',
}

function formatDate(iso: string | null | undefined, lang: string) {
  return formatLocalDate(iso, lang, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
}

export default function ArticleDetailPage() {
  const { id } = useParams()
  const { t, i18n } = useTranslation()
  const categoryLabel = useCategoryLabel()
  const [article, setArticle] = useState<Article | null>(null)
  const [related, setRelated] = useState<Article[]>([])
  const [status, setStatus]   = useState<'loading' | 'success' | 'notFound' | 'error'>('loading')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setArticle(null)
    setRelated([])

    // The route always defines :id.
    fetchArticleById(id ?? '')
      .then((a) => {
        if (cancelled) return
        setArticle(a)
        setStatus('success')
        // Track view with category for analytics aggregation
        trackEvent('article_view', { articleId: a.id, category: a.category })
        // "More from…" is secondary: if it fails the section just stays hidden.
        fetchArticles({ category: a.category })
          .then((res) => { if (!cancelled) setRelated(res.data.filter((r) => r.id !== id).slice(0, 3)) })
          .catch((err: unknown) => console.error(err))
      })
      .catch((err: unknown) => {
        if (!cancelled) setStatus(err instanceof ApiError && err.status === 404 ? 'notFound' : 'error')
      })

    return () => { cancelled = true }
  }, [id, reloadKey])

  // Search engines index the tags set after render. Only once the article has
  // loaded, so NewsletterApp's section title (set on mount) doesn't override it.
  useDocumentTitle(article ? `${article.title} | ITBA News` : null)
  useMetaDescription(article ? articleDescription(article) : null)
  useCanonical(article ? `${window.location.origin}${articlePath(article.id)}` : null)
  // Only a real 404: a transient API error while Googlebot renders must not
  // deindex an existing page.
  useNoIndex(status === 'notFound')

  if (status === 'loading') return <LoadingSkeleton />
  if (status === 'notFound' || status === 'error' || !article) {
    const notFound = status !== 'error'
    return (
      <div className="container-content py-section-mobile lg:py-section">
        <ErrorState
          title={notFound ? t('articles.notFound.title') : t('articles.error.title')}
          message={notFound ? t('articles.notFound.message') : t('articles.error.articleMessage')}
          onRetry={notFound ? undefined : () => setReloadKey((k) => k + 1)}
          backTo={newsletterPath('/')}
          backLabel={t('articles.backToList')}
        />
      </div>
    )
  }

  const heroBg = GEO_BG[article.colorScheme ?? ''] ?? GEO_BG.blue

  return (
    <article className="py-section-mobile lg:py-section">
      <div className="container-content">
        <Link
          to={newsletterPath('/')}
          className="inline-flex items-center min-h-[44px] font-mono text-label text-ink-secondary hover:text-primary transition-colors duration-150 mb-6 focus-visible:rounded-sm"
        >
          {t('articles.backToArticles')}
        </Link>

        {/* Hero — image if available, geo fill otherwise */}
        {article.coverImage ? (
          <div className="rounded-card overflow-hidden mb-10 h-64 lg:h-96">
            <img
              src={article.coverImage}
              alt=""
              aria-hidden="true"
              className="w-full h-full object-cover"
            />
          </div>
        ) : (
          <div className={['relative rounded-card overflow-hidden h-48 lg:h-64 mb-10', heroBg].join(' ')}>
            <div className="absolute inset-0 opacity-20">
              <div className="absolute top-[-20%] right-[-5%] w-1/2 h-full rounded-full bg-white/30" />
              <div className="absolute bottom-[-30%] left-[-5%] w-2/3 h-2/3 rotate-12 bg-white/20" />
            </div>
            <div className="absolute inset-0 bg-linear-to-br from-black/0 to-black/30" />
            <div className="absolute bottom-5 left-6">
              <CategoryBadge category={article.category} />
            </div>
          </div>
        )}

        {/* Content column */}
        <div className="max-w-2xl">
          {article.coverImage && (
            <div className="mb-3">
              <CategoryBadge category={article.category} />
            </div>
          )}

          <h1 className="font-display text-h2 lg:text-display lg:font-extrabold lg:leading-[1.05] font-bold text-ink-primary leading-tight">
            {article.title}
          </h1>

          <div className="flex flex-wrap items-center gap-3 mt-4 pb-6 border-b border-border dark:border-night-border">
            <span className="font-body text-body-sm text-ink-secondary">
              {t('articles.meta.by')}{' '}
              <strong className="text-ink-primary font-semibold">{(article.authors ?? []).join(', ')}</strong>
            </span>
            <span className="text-border dark:text-night-muted" aria-hidden="true">·</span>
            <time className="font-mono text-label text-ink-secondary" dateTime={article.date ?? undefined}>
              {formatDate(article.date, i18n.language)}
            </time>
            <span className="text-border dark:text-night-muted" aria-hidden="true">·</span>
            <span className="font-mono text-label text-ink-secondary">
              {t('articles.meta.readingTime', { time: article.readingTime })}
            </span>
          </div>

          {/* Body */}
          <ArticleBody body={article.body?.length ? article.body : [article.excerpt ?? '']} articleId={article.id} className="mt-8" />

          {/* Vote bar — counts hidden from public */}
          <div className="mt-10 pt-6 border-t border-border dark:border-night-border">
            <VoteButtons articleId={article.id} />
          </div>

          <CommentsSection articleId={article.id} />
        </div>

        {/* Related */}
        {related.length > 0 && (
          <section className="mt-16 pt-10 border-t border-border dark:border-night-border" aria-labelledby="related-heading">
            <h2 id="related-heading" className="font-display text-h3 font-bold text-ink-primary mb-6">
              {t('articles.moreFrom', { category: categoryLabel(article.category) })}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {related.map((a) => <ArticleCard key={a.id} article={a} />)}
            </div>
          </section>
        )}
      </div>
    </article>
  )
}

function LoadingSkeleton() {
  return (
    <LoadingRegion className="py-section-mobile lg:py-section">
      <div className="container-content">
        <div className="skeleton h-4 w-32 rounded-xs mb-8" />
        <div className="skeleton rounded-card h-48 lg:h-64 mb-10" />
        <div className="max-w-2xl flex flex-col gap-3">
          <div className="skeleton h-10 w-4/5 rounded-xs" />
          <div className="skeleton h-10 w-3/5 rounded-xs" />
          <div className="flex gap-4 mt-1 pb-6 border-b border-border dark:border-night-border">
            <div className="skeleton h-3 w-24 rounded-xs" />
            <div className="skeleton h-3 w-32 rounded-xs" />
          </div>
          {[1,2,3,4].map((i) => <div key={i} className="skeleton h-4 w-full rounded-xs" />)}
        </div>
      </div>
    </LoadingRegion>
  )
}

