import { useTranslation } from 'react-i18next'
import { useBenefits } from '../../hooks/useContent'

const ICONS: Record<string, React.ReactNode> = {
  deportes: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  ),
  membresias: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" strokeWidth="3" />
    </svg>
  ),
  eventos: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  ),
  academico: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  ),
  representacion: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
}

export default function HomeBenefitsPreview({ onSeeAll }: { onSeeAll: () => void }) {
  const { t } = useTranslation()
  const { data, loading } = useBenefits()
  const categories = data ?? []

  return (
    <section
      className="py-section-mobile lg:py-section bg-white dark:bg-[#1c1c1f]"
      aria-labelledby="home-benefits-heading"
    >
      <div className="container-content">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-8">
          <div>
            <span className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-[#a1a1aa]">
              {t('home.benefits.eyebrow')}
            </span>
            <h2
              id="home-benefits-heading"
              className="font-display font-bold text-h3 text-ink-primary dark:text-[#f4f4f5] mt-1 mb-2"
            >
              {t('home.benefits.title')}
            </h2>
            <p className="font-body text-body text-ink-secondary dark:text-[#a1a1aa] max-w-2xl">
              {t('home.benefits.subtitle')}
            </p>
          </div>
          <button
            type="button"
            onClick={onSeeAll}
            className="inline-flex items-center gap-1.5 font-mono text-label uppercase tracking-widest text-primary font-bold hover:gap-2.5 transition-all duration-150 self-start sm:self-auto"
          >
            {t('home.benefits.seeAll')}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {loading
            ? Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="h-40 rounded-card border border-border dark:border-[#3f3f46] bg-page-bg dark:bg-[#27272a] skeleton"
                />
              ))
            : categories.map((cat, i) => (
                <button
                  key={cat.slug}
                  type="button"
                  onClick={onSeeAll}
                  className="group flex flex-col gap-3 p-5 rounded-card border border-border dark:border-[#3f3f46] bg-page-bg dark:bg-[#27272a] hover:border-primary hover:-translate-y-0.5 transition-all duration-200 text-left animate-slide-up"
                  style={{ animationDelay: `${i * 50}ms` }}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="w-10 h-10 rounded-card flex items-center justify-center text-primary-800 flex-shrink-0"
                      style={{ backgroundColor: `var(${cat.colorVar})` }}
                    >
                      {ICONS[cat.slug]}
                    </span>
                    <h3 className="font-display font-bold text-h5 text-ink-primary dark:text-[#f4f4f5] group-hover:text-primary transition-colors duration-150">
                      {t(`benefits.${cat.slug}.name`, { defaultValue: cat.slug })}
                    </h3>
                  </div>
                  <p className="font-body text-body-sm text-ink-secondary dark:text-[#a1a1aa] line-clamp-3">
                    {t(`benefits.${cat.slug}.description`, { defaultValue: '' })}
                  </p>
                </button>
              ))
          }
        </div>
      </div>
    </section>
  )
}
