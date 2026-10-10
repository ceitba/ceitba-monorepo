import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useBenefits } from '../../hooks/useContent'
import SeeAllButton from '../../components/SeeAllButton'
import { ErrorState, SkeletonCards } from '../../components/ui'
import { benefitCategoryName } from '../../utils/benefits'
import BenefitIcon from './BenefitIcon'

export default function HomeBenefitsPreview() {
  const { t, i18n } = useTranslation()
  const lang: 'es' | 'en' = i18n.language === 'en' ? 'en' : 'es'
  const { data, loading, error, reload } = useBenefits()
  const categories = data ?? []

  return (
    <section
      className="py-section-mobile lg:py-section bg-white dark:bg-night-raised"
      aria-labelledby="home-benefits-heading"
    >
      <div className="container-content">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-8">
          <div>
            <span className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
              {t('home.benefits.eyebrow')}
            </span>
            <h2
              id="home-benefits-heading"
              className="font-display font-bold text-h3 text-ink-primary dark:text-night-text mt-1 mb-2"
            >
              {t('home.benefits.title')}
            </h2>
            <p className="font-body text-body text-ink-secondary dark:text-night-muted max-w-2xl">
              {t('home.benefits.subtitle')}
            </p>
          </div>
          <SeeAllButton to="/benefits" label={t('home.benefits.seeAll')} />
        </div>

        {error && !loading ? (
          <ErrorState onRetry={() => void reload()} />
        ) : loading ? (
          <SkeletonCards count={5} cardClassName="h-40" />
        ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 animate-fade-in">
          {categories.map((cat) => (
                <Link
                  to="/benefits"
                  key={cat.slug}
                  className="group flex flex-col gap-3 p-5 rounded-card border border-border dark:border-night-border bg-page-bg dark:bg-night-surface shadow-card hover:shadow-card-hover transition-shadow duration-200 text-left"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="w-10 h-10 rounded-card flex items-center justify-center text-primary-800 flex-shrink-0"
                      style={{ backgroundColor: `var(${cat.colorVar})` }}
                    >
                      <BenefitIcon slug={cat.slug} size={22} />
                    </span>
                    <h3 className="font-display font-bold text-h5 text-ink-primary dark:text-night-text group-hover:text-primary transition-colors duration-150">
                      {benefitCategoryName(cat.slug, cat, lang, t)}
                    </h3>
                  </div>
                  <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted line-clamp-3">
                    {t(`benefits.${cat.slug}.description`, { defaultValue: '' })}
                  </p>
                </Link>
              ))
          }
        </div>
        )}
      </div>
    </section>
  )
}
