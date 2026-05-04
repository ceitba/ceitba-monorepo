import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import CategoryBadge from '../components/CategoryBadge'
import ArticleCard from '../components/ArticleCard'
import VoteButtons from '../components/VoteButtons'
import { fetchArticleById, fetchArticles } from '../api/articles'
import { trackEvent } from '../store/analyticsStore'

const GEO_BG = {
  blue:   'bg-primary-500',
  amber:  'bg-accent-400',
  green:  'bg-emerald-600',
  violet: 'bg-violet-600',
}

function formatDate(iso, lang) {
  return new Date(iso).toLocaleDateString(lang === 'en' ? 'en-US' : 'es-AR', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })
}

export default function ArticleDetailPage() {
  const { id } = useParams()
  const { t, i18n } = useTranslation()
  const [article, setArticle] = useState(null)
  const [related, setRelated] = useState([])
  const [status, setStatus]   = useState('loading')

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setArticle(null)

    fetchArticleById(id)
      .then((a) => {
        if (cancelled) return
        setArticle(a)
        setStatus('success')
        // Track view with category for analytics aggregation
        trackEvent('article_view', { articleId: a.id, category: a.category })
        return fetchArticles({ category: a.category })
      })
      .then((res) => {
        if (cancelled || !res) return
        setRelated(res.data.filter((a) => a.id !== id).slice(0, 3))
      })
      .catch(() => { if (!cancelled) setStatus('error') })

    return () => { cancelled = true }
  }, [id])

  if (status === 'loading') return <LoadingSkeleton />
  if (status === 'error' || !article) return <ErrorState t={t} />

  const heroBg = GEO_BG[article.colorScheme] ?? GEO_BG.blue

  return (
    <article className="py-section-mobile lg:py-section animate-fade-in">
      <div className="container-content">
        <Link
          to="/"
          className="inline-block font-mono text-label text-ink-secondary hover:text-primary transition-colors duration-150 mb-8 focus-visible:rounded"
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
            <div className="absolute inset-0 bg-gradient-to-br from-black/0 to-black/30" />
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

          <h1 className="font-display text-h2 lg:text-display font-bold text-ink-primary leading-tight">
            {article.title}
          </h1>

          <div className="flex flex-wrap items-center gap-3 mt-4 pb-6 border-b border-border">
            <span className="font-body text-body-sm text-ink-secondary">
              {t('articles.meta.by')}{' '}
              <strong className="text-ink-primary font-semibold">{(article.authors ?? []).join(', ')}</strong>
            </span>
            <span className="text-border" aria-hidden="true">·</span>
            <time className="font-mono text-label text-ink-secondary" dateTime={article.date}>
              {formatDate(article.date, i18n.language)}
            </time>
            <span className="text-border" aria-hidden="true">·</span>
            <span className="font-mono text-label text-ink-secondary">
              {t('articles.meta.readingTime', { time: article.readingTime })}
            </span>
          </div>

          {/* Body */}
          <div className="mt-8 flex flex-col gap-5">
            {(article.body ?? [article.excerpt]).map((para, i) => (
              <p key={i} className="font-body text-body text-ink-primary leading-[1.75]">
                {para}
              </p>
            ))}
          </div>

          {/* Vote bar — counts hidden from public */}
          <div className="mt-10 pt-6 border-t border-border">
            <VoteButtons articleId={article.id} />
          </div>
        </div>

        {/* Related */}
        {related.length > 0 && (
          <section className="mt-16 pt-10 border-t border-border" aria-labelledby="related-heading">
            <h2 id="related-heading" className="font-display text-h3 font-bold text-ink-primary mb-6">
              {t('articles.moreFrom', { category: article.category })}
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
    <div className="py-section-mobile lg:py-section" aria-busy="true">
      <div className="container-content">
        <div className="skeleton h-4 w-32 rounded mb-8" />
        <div className="skeleton rounded-card h-48 lg:h-64 mb-10" />
        <div className="max-w-2xl flex flex-col gap-3">
          <div className="skeleton h-10 w-4/5 rounded" />
          <div className="skeleton h-10 w-3/5 rounded" />
          <div className="flex gap-4 mt-1 pb-6 border-b border-border">
            <div className="skeleton h-3 w-24 rounded" />
            <div className="skeleton h-3 w-32 rounded" />
          </div>
          {[1,2,3,4].map((i) => <div key={i} className="skeleton h-4 w-full rounded" />)}
        </div>
      </div>
    </div>
  )
}

function ErrorState({ t }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center py-32 gap-6 text-center">
      <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <div>
        <p className="font-display text-h4 font-bold text-ink-primary">{t('articles.error.title')}</p>
        <p className="font-body text-body text-ink-secondary mt-1">{t('articles.error.message')}</p>
      </div>
      <Link to="/" className="min-h-[44px] px-6 py-2.5 bg-primary text-surface font-body font-semibold rounded-sm hover:bg-primary-600 transition-colors duration-150 focus-visible:rounded inline-flex items-center">
        {t('common.backHome')}
      </Link>
    </div>
  )
}
