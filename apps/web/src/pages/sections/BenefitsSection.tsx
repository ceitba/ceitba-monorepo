import { useTranslation } from 'react-i18next'
import { useBenefits } from '../../hooks/useContent'

const ICONS: Record<string, React.ReactNode> = {
  deportes: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  ),
  membresias: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" strokeWidth="3" />
    </svg>
  ),
  eventos: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  ),
  academico: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  ),
  representacion: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
}

export default function BenefitsSection() {
  const { t, i18n } = useTranslation()
  const lang: 'es' | 'en' = i18n.language === 'en' ? 'en' : 'es'
  const { data, loading } = useBenefits()
  const benefits = data ?? []

  return (
    <section className="py-section-mobile lg:py-section" aria-labelledby="benefits-heading">
      <div className="container-content">
        <div className="mb-8">
          <h2 id="benefits-heading" className="font-display font-bold text-h3 text-ink-primary dark:text-[#f4f4f5] mb-2">
            {t('benefits.sectionTitle')}
          </h2>
          <p className="font-body text-body text-ink-secondary dark:text-[#a1a1aa]">
            {t('benefits.sectionSubtitle')}
          </p>
        </div>

        <div className="flex items-center gap-2.5 mb-6 px-4 py-3 rounded-card border border-border dark:border-[#3f3f46] bg-white dark:bg-[#27272a]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-ink-secondary dark:text-[#a1a1aa] flex-shrink-0" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" strokeWidth="2.5" />
          </svg>
          <p className="font-body text-body-sm text-ink-secondary dark:text-[#a1a1aa]">
            {t('benefits.detailsNote')}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {loading
            ? Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-40 rounded-card border border-border dark:border-[#3f3f46] bg-white dark:bg-[#27272a] skeleton" />
              ))
            : benefits.map((benefit, i) => {
                const highlights = lang === 'es' ? benefit.highlightsEs : benefit.highlightsEn
                const hasHighlights = highlights && highlights.length > 0
                return (
                  <article
                    key={benefit.slug}
                    className="flex flex-col gap-4 p-5 rounded-card border border-border dark:border-[#3f3f46] bg-white dark:bg-[#27272a] shadow-card hover:shadow-card-hover transition-shadow duration-200 animate-slide-up"
                    style={{ animationDelay: `${i * 60}ms` }}
                  >
                    <div className="flex items-start gap-4">
                      <div
                        className="w-12 h-12 rounded-card flex items-center justify-center text-primary-800 flex-shrink-0"
                        style={{ backgroundColor: `var(${benefit.colorVar})` }}
                      >
                        {ICONS[benefit.slug]}
                      </div>
                      <div className="flex flex-col gap-1 flex-1 min-w-0">
                        <h3 className="font-display font-bold text-h5 text-ink-primary dark:text-[#f4f4f5]">
                          {t(`benefits.${benefit.slug}.name`)}
                        </h3>
                        <p className="font-body text-body-sm text-ink-secondary dark:text-[#a1a1aa]">
                          {t(`benefits.${benefit.slug}.description`)}
                        </p>
                      </div>
                    </div>

                    {hasHighlights ? (
                      <ul className="flex flex-col gap-1.5 border-t border-border dark:border-[#3f3f46] pt-3">
                        {highlights.map((item) => (
                          <li key={item} className="flex items-start gap-2 font-body text-body-sm text-ink-secondary dark:text-[#a1a1aa]">
                            <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-primary-300 dark:bg-[#7FA1D4] flex-shrink-0" aria-hidden="true" />
                            {item}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="border-t border-border dark:border-[#3f3f46] pt-3">
                        <span className="inline-flex items-center gap-1.5 font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-[#a1a1aa]">
                          <span className="w-1.5 h-1.5 rounded-full bg-ink-secondary dark:bg-[#a1a1aa] opacity-50" aria-hidden="true" />
                          {t('benefits.detailsComingSoon')}
                        </span>
                      </div>
                    )}

                    {benefit.linkUrl && (
                      <a
                        href={benefit.linkUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 font-mono text-label uppercase tracking-widest text-primary font-bold self-start"
                      >
                        {t('benefits.learnMore')}
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <line x1="5" y1="12" x2="19" y2="12" />
                          <polyline points="12 5 19 12 12 19" />
                        </svg>
                      </a>
                    )}
                  </article>
                )
              })
          }
        </div>
      </div>
    </section>
  )
}
