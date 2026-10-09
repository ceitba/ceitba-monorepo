import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { EmptyState, ErrorState, LoadingRegion, ToggleGroup } from '@/components/ui'
import ArticleCard from '../components/ArticleCard'
import SkeletonCard from '../components/SkeletonCard'
import WriteForNewsletter from '../components/WriteForNewsletter'
import NewsletterPageHeader from '../components/NewsletterPageHeader'
import { fetchArticles } from '../api/articles'
import { CATEGORIES } from '../constants/categories'
import { useCategoryLabel } from '../hooks/useCategoryLabel'
import type { Article } from '../types'

interface FetchState {
  status: 'loading' | 'success' | 'error'
  data: Article[]
}

function useFetchArticles(category: string | null, reloadKey: number) {
  const [state, setState] = useState<FetchState>({ status: 'loading', data: [] })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading', data: [] })

    fetchArticles({ category: category ?? undefined })
      .then(({ data }) => {
        if (!cancelled) setState({ status: 'success', data })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', data: [] })
      })

    return () => { cancelled = true }
  }, [category, reloadKey])

  return state
}

export default function ArticlesPage() {
  const { t } = useTranslation()
  // null = all categories (no filter param)
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const { status, data: articles } = useFetchArticles(activeCategory, reloadKey)

  const featured  = articles.find((a) => a.featured)
  const secondary = articles.filter((a) => !a.featured)

  return (
    <div className="py-section-mobile lg:py-section">
      <div className="container-content">
        <NewsletterPageHeader
          current="articles"
          title={t('articles.pageTitle')}
          subtitle={t('articles.pageSubtitle')}
          action={<WriteForNewsletter />}
        />

        <FilterBar
          categories={CATEGORIES}
          active={activeCategory}
          onChange={setActiveCategory}
        />

        <div className="mt-8">
          {status === 'loading' && <LoadingState />}
          {status === 'error'   && (
            <ErrorState
              title={t('articles.error.title')}
              message={t('articles.error.message')}
              onRetry={() => setReloadKey((k) => k + 1)}
            />
          )}
          {status === 'success' && articles.length === 0 && (
            <ArticlesEmpty category={activeCategory} />
          )}
          {status === 'success' && articles.length > 0 && (
            <EditorialGrid featured={featured} secondary={secondary} />
          )}
        </div>
      </div>
    </div>
  )
}

interface FilterBarProps {
  categories: string[]
  active: string | null
  onChange: (category: string | null) => void
}

function FilterBar({ categories, active, onChange }: FilterBarProps) {
  const { t } = useTranslation()
  const label = useCategoryLabel()
  return (
    <ToggleGroup
      label={t('articles.filter.label')}
      value={active}
      onChange={onChange}
      options={[null, ...categories].map((cat) => ({
        value: cat,
        key: cat ?? 'all',
        label: cat ? label(cat) : t('categories.all'),
      }))}
    />
  )
}

interface EditorialGridProps {
  featured: Article | undefined
  secondary: Article[]
}

function EditorialGrid({ featured, secondary }: EditorialGridProps) {
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
    <LoadingRegion className="flex flex-col gap-6">
      <SkeletonCard featured />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        <SkeletonCard /><SkeletonCard /><SkeletonCard />
      </div>
    </LoadingRegion>
  )
}

interface EmptyStateProps {
  category: string | null
}

function ArticlesEmpty({ category }: EmptyStateProps) {
  const { t } = useTranslation()
  const label = useCategoryLabel()
  return (
    <EmptyState
      title={t('articles.empty.title', { category: category ? label(category) : t('categories.all') })}
      body={t('articles.empty.message')}
    />
  )
}
