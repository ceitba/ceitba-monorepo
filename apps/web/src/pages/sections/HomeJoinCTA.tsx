import { useTranslation } from 'react-i18next'

export default function HomeJoinCTA() {
  const { t } = useTranslation()

  return (
    <section
      className="py-section-mobile lg:py-section bg-page-bg dark:bg-[#18181b]"
      aria-labelledby="home-join-heading"
    >
      <div className="container-content">
        <div className="relative overflow-hidden rounded-card border border-border dark:border-[#3f3f46] bg-primary-50 dark:bg-[#0f1f38] px-6 py-10 sm:px-12 sm:py-14">
          <span
            aria-hidden="true"
            className="absolute -right-6 -bottom-12 font-display font-extrabold leading-none text-primary opacity-[0.06] dark:opacity-[0.09] pointer-events-none select-none"
            style={{ fontSize: 'clamp(6rem, 16vw, 12rem)' }}
          >
            CEITBA
          </span>

          <div className="relative max-w-2xl">
            <span className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-[#a1a1aa]">
              {t('home.cta.eyebrow')}
            </span>
            <h2
              id="home-join-heading"
              className="font-display font-bold text-h2 text-primary mt-2 mb-3 tracking-tight"
            >
              {t('home.cta.title')}
            </h2>
            <p className="font-body text-body-lg text-ink-primary dark:text-[#f4f4f5]">
              {t('home.cta.body')}
            </p>

            <div className="flex flex-wrap gap-3 mt-6">
              <a
                href="mailto:ceitba@itba.edu.ar"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-card bg-primary text-white dark:bg-[#7FA1D4] dark:text-[#0f1f38] font-mono text-label uppercase tracking-widest font-bold hover:opacity-90 transition-opacity duration-150"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
                {t('home.cta.contact')}
              </a>
              <a
                href="https://instagram.com/ceitba"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-card border border-primary text-primary dark:text-[#7FA1D4] dark:border-[#7FA1D4] font-mono text-label uppercase tracking-widest font-bold hover:bg-primary hover:text-white dark:hover:bg-[#7FA1D4] dark:hover:text-[#0f1f38] transition-colors duration-150"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                  <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                  <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" strokeWidth="2.5" />
                </svg>
                {t('home.cta.follow')}
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
