import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useDepartments } from '../../hooks/useContent'
import SeeAllButton from '../../components/SeeAllButton'
import { ErrorState, SkeletonCards } from '../../components/ui'

const ICONS: Record<string, React.ReactNode> = {
  it: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  ),
  media: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="23 7 16 12 23 17 23 7" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  ),
  infraestructura: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  ),
  nautica: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="5" r="3" />
      <line x1="12" y1="22" x2="12" y2="8" />
      <path d="M5 12H2a10 10 0 0 0 20 0h-3" />
    </svg>
  ),
  deportes: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="6" />
      <path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11" />
    </svg>
  ),
  directivos: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
}

export default function HomeDepartmentsPreview() {
  const { t } = useTranslation()
  const { data, loading, error, reload } = useDepartments()
  const departments = (data ?? []).slice(0, 6)

  return (
    <section
      className="py-section-mobile lg:py-section bg-page-bg dark:bg-night-bg"
      aria-labelledby="home-departments-heading"
    >
      <div className="container-content">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-8">
          <div>
            <span className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
              {t('home.departments.eyebrow')}
            </span>
            <h2
              id="home-departments-heading"
              className="font-display font-bold text-h3 text-ink-primary dark:text-night-text mt-1 mb-2"
            >
              {t('home.departments.title')}
            </h2>
            <p className="font-body text-body text-ink-secondary dark:text-night-muted max-w-2xl">
              {t('home.departments.subtitle')}
            </p>
          </div>
          <SeeAllButton to="/about" label={t('home.departments.seeAll')} />
        </div>

        {error && !loading ? (
          <ErrorState onRetry={() => void reload()} />
        ) : loading ? (
          <SkeletonCards count={6} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3" cardClassName="h-28" />
        ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 animate-fade-in">
          {departments.map((dept) => (
                <Link
                  to="/about"
                  key={dept.slug}
                  className="group flex flex-col items-start gap-2.5 p-4 rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface shadow-card hover:shadow-card-hover transition-shadow duration-200 text-left"
                  aria-label={t('home.departments.tileAria', { name: t(`departments.${dept.slug}.name`) })}
                >
                  <span
                    className="w-9 h-9 rounded-card flex items-center justify-center text-primary-800 flex-shrink-0"
                    style={{ backgroundColor: `var(${dept.colorVar})` }}
                  >
                    {ICONS[dept.slug]}
                  </span>
                  <span className="font-display font-bold text-body-sm text-ink-primary dark:text-night-text group-hover:text-primary transition-colors duration-150 leading-tight">
                    {t(`departments.${dept.slug}.name`)}
                  </span>
                </Link>
              ))
          }
        </div>
        )}
      </div>
    </section>
  )
}
