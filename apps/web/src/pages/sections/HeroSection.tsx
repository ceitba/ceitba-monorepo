import { useTranslation } from 'react-i18next'

export default function HeroSection() {
  const { t } = useTranslation()

  return (
    <section
      className="relative overflow-hidden bg-primary-50 dark:bg-[#0f1f38] py-section-mobile lg:py-section"
      aria-labelledby="hero-heading"
    >
      {/* Decorative oversized wordmark */}
      <span
        aria-hidden="true"
        className="absolute -right-4 top-1/2 -translate-y-1/2 font-display font-extrabold leading-none text-primary opacity-[0.06] dark:opacity-[0.09] pointer-events-none select-none"
        style={{ fontSize: 'clamp(7rem, 20vw, 17rem)' }}
      >
        CEITBA
      </span>

      <div className="container-content relative">
        <div className="max-w-2xl animate-fade-in">
          <span className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-[#a1a1aa]">
            {t('hero.eyebrow')}
          </span>
          <h1
            id="hero-heading"
            className="font-display text-h1 lg:text-display font-extrabold text-primary mt-2 mb-4 tracking-tight"
          >
            {t('hero.title')}
          </h1>
          <p className="font-body text-body-lg text-ink-primary dark:text-[#f4f4f5] font-semibold mb-4 leading-snug">
            {t('hero.subtitle')}
          </p>
          <p className="font-body text-body text-ink-secondary dark:text-[#a1a1aa]">
            {t('hero.description')}
          </p>
        </div>
      </div>
    </section>
  )
}
