import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import ArticleCard from '../components/ArticleCard'
import SkeletonCard from '../components/SkeletonCard'
import ContributeModal from '../components/ContributeModal'
import { fetchArticles } from '../api/articles'
import { CATEGORIES } from '../data/articles'
import { useAuthSession } from '../hooks/useAuthSession'

const ADMIN_ROLES = ['staff', 'admin', 'editor']

function useFetchArticles(category) {
  const [state, setState] = useState({ status: 'loading', data: [] })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading', data: [] })

    fetchArticles({ category })
      .then(({ data }) => {
        if (!cancelled) setState({ status: 'success', data })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', data: [] })
      })

    return () => { cancelled = true }
  }, [category])

  return state
}

export default function ArticlesPage() {
  const { t } = useTranslation()
  const [activeCategory, setActiveCategory] = useState('Todos')
  const { status, data: articles } = useFetchArticles(activeCategory)

  const featured  = articles.find((a) => a.featured)
  const secondary = articles.filter((a) => !a.featured)

  return (
    <div className="py-section-mobile lg:py-section">
      <div className="container-content">
        <header className="mb-8 lg:mb-12">
          <h1 className="font-display text-h1 lg:text-display font-bold text-ink-primary leading-tight">
            {t('articles.pageTitle')}
          </h1>
          <p className="font-body text-body-lg text-ink-secondary mt-2">
            {t('articles.pageSubtitle')}
          </p>
        </header>

        <FilterBar
          categories={CATEGORIES}
          active={activeCategory}
          onChange={setActiveCategory}
        />

        <div className="mt-8">
          {status === 'loading' && <LoadingState />}
          {status === 'error'   && (
            <ErrorState onRetry={() => setActiveCategory(activeCategory)} />
          )}
          {status === 'success' && articles.length === 0 && (
            <EmptyState category={activeCategory} />
          )}
          {status === 'success' && articles.length > 0 && (
            <EditorialGrid featured={featured} secondary={secondary} />
          )}
        </div>

        <ContributeBanner />
      </div>
    </div>
  )
}

function FilterBar({ categories, active, onChange }) {
  const { t } = useTranslation()
  return (
    <nav aria-label={t('articles.filter.label')}>
      <ul className="flex flex-wrap gap-2 list-none m-0 p-0" role="list">
        {categories.map((cat) => (
          <li key={cat}>
            <button
              type="button"
              onClick={() => onChange(cat)}
              aria-pressed={active === cat}
              className={[
                'min-h-[44px] px-4 py-2 rounded-sm font-mono text-label uppercase tracking-widest transition-all duration-150 focus-visible:rounded',
                active === cat
                  ? 'bg-primary text-surface shadow-sm'
                  : 'bg-white border border-border text-ink-secondary hover:border-primary hover:text-primary',
              ].join(' ')}
            >
              {t(`categories.${cat}`, { defaultValue: cat })}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function EditorialGrid({ featured, secondary }) {
  return (
    <div className="flex flex-col gap-6">
      {featured && <ArticleCard article={featured} featured />}
      {secondary.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {secondary.map((article) => (
            <ArticleCard key={article.id} article={article} />
          ))}
        </div>
      )}
    </div>
  )
}

function LoadingState() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <SkeletonCard featured />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        <SkeletonCard /><SkeletonCard /><SkeletonCard />
      </div>
    </div>
  )
}

function ErrorState({ onRetry }) {
  const { t } = useTranslation()
  return (
    <div role="alert" className="flex flex-col items-center justify-center py-24 gap-6 text-center">
      <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <div>
        <p className="font-display text-h4 font-bold text-ink-primary">{t('articles.error.title')}</p>
        <p className="font-body text-body text-ink-secondary mt-1">{t('articles.error.message')}</p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="min-h-[44px] px-6 py-2.5 bg-primary text-surface font-body font-semibold rounded-sm hover:bg-primary-600 transition-colors duration-150 focus-visible:rounded"
      >
        {t('articles.error.retry')}
      </button>
    </div>
  )
}

function ContributeBanner() {
  const { profile, loading } = useAuthSession()
  const [modalOpen, setModalOpen] = useState(false)

  // Don't flash an anonymous-state CTA before the cookie session resolves —
  // the banner is a non-critical accent, render nothing until we know.
  if (loading) return null

  const isAdmin = profile && ADMIN_ROLES.includes(profile.role)
  const ctaTo = isAdmin ? '/admin/articles' : '/contribute'
  const ctaLabel = isAdmin ? 'Panel admin' : 'Contribuir'
  const copyBody = profile
    ? 'Proponé artículos y eventos desde tu portal de contribución. El equipo editorial los revisa antes de publicar.'
    : 'Iniciá sesión con tu cuenta @itba.edu.ar para proponer artículos y eventos. El equipo editorial los revisa antes de publicar.'

  const ctaIcon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
  )
  const ctaClasses = 'inline-flex items-center gap-2 min-h-[44px] px-5 flex-shrink-0 bg-primary text-surface font-body text-body-sm font-semibold rounded-sm hover:bg-primary-600 transition-colors duration-150 focus-visible:rounded'

  return (
    <>
      <div className="mt-16 rounded-card border border-border bg-white shadow-card overflow-hidden">
        <div className="flex flex-col sm:flex-row items-stretch">
          {/* Geometric accent */}
          <div className="relative w-full sm:w-40 h-24 sm:h-auto flex-shrink-0 bg-primary-900 overflow-hidden">
            <div className="absolute top-[-20%] right-[-10%] w-2/3 h-[130%] rounded-full bg-primary-700/50" />
            <div className="absolute bottom-[-30%] left-[-5%] w-1/2 h-3/4 rotate-12 bg-accent/30" />
            <div className="absolute inset-0 flex items-center justify-center">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
              </svg>
            </div>
          </div>
          {/* Copy */}
          <div className="flex-1 px-6 py-5 flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
            <div>
              <p className="font-display text-h5 font-bold text-ink-primary">¿Tenés algo para contar?</p>
              <p className="font-body text-body-sm text-ink-secondary mt-1">{copyBody}</p>
            </div>
            {profile ? (
              <Link to={ctaTo} className={ctaClasses}>
                {ctaLabel}
                {ctaIcon}
              </Link>
            ) : (
              <button type="button" onClick={() => setModalOpen(true)} className={ctaClasses}>
                Contribuir
                {ctaIcon}
              </button>
            )}
          </div>
        </div>
      </div>
      <ContributeModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  )
}

function EmptyState({ category }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-6 text-center animate-fade-in">
      <div className="relative w-24 h-24">
        <div className="absolute inset-0 rounded-full bg-primary-50" />
        <div className="absolute top-3 left-3 w-10 h-10 rotate-45 bg-accent-100" />
        <div className="absolute bottom-4 right-3 w-6 h-6 rounded-full bg-primary-200" />
      </div>
      <div>
        <p className="font-display text-h4 font-bold text-ink-primary">
          {t('articles.empty.title', { category })}
        </p>
        <p className="font-body text-body text-ink-secondary mt-1">
          {t('articles.empty.message')}
        </p>
      </div>
    </div>
  )
}
