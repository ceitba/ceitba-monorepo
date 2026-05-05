import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useBenefitCards, useBenefits } from '../../hooks/useContent'
import type { BenefitCard, BenefitEntry } from '../../api/content'

const ALL = '__all__'

const ICONS: Record<string, React.ReactNode> = {
  deportes: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  ),
  membresias: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" strokeWidth="3" />
    </svg>
  ),
  eventos: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  ),
  academico: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  ),
  representacion: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
}

export default function BenefitsSection() {
  const { t, i18n } = useTranslation()
  const lang: 'es' | 'en' = i18n.language === 'en' ? 'en' : 'es'
  const { data: categories, loading: loadingCategories } = useBenefits()
  const { data: cards, loading: loadingCards } = useBenefitCards()
  const categoryList: BenefitEntry[] = categories ?? []
  const cardList: BenefitCard[] = cards ?? []

  const [active, setActive] = useState<string>(ALL)

  const visibleCards = useMemo(() => {
    if (active === ALL) return cardList
    return cardList.filter((c) => c.categorySlug === active)
  }, [cardList, active])

  const loading = loadingCategories || loadingCards

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

        {categoryList.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-8" role="group" aria-label={t('benefits.filterLabel')}>
            <Chip
              label={t('benefits.all')}
              active={active === ALL}
              onClick={() => setActive(ALL)}
            />
            {categoryList.map((c) => (
              <Chip
                key={c.slug}
                label={t(`benefits.${c.slug}.name`, { defaultValue: c.slug })}
                colorVar={c.colorVar}
                icon={ICONS[c.slug]}
                active={active === c.slug}
                onClick={() => setActive(c.slug)}
              />
            ))}
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-72 rounded-card border border-border dark:border-[#3f3f46] bg-white dark:bg-[#27272a] skeleton" />
            ))}
          </div>
        ) : visibleCards.length === 0 ? (
          <EmptyState message={t('benefits.empty')} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {visibleCards.map((card, i) => (
              <BenefitCardView
                key={card.id}
                card={card}
                category={categoryList.find((c) => c.slug === card.categorySlug)}
                lang={lang}
                animationDelay={i * 60}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function Chip({
  label,
  active,
  colorVar,
  icon,
  onClick,
}: {
  label: string
  active: boolean
  colorVar?: string
  icon?: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full font-mono text-label uppercase tracking-widest transition-colors duration-150 ${
        active
          ? 'bg-primary dark:bg-[#7FA1D4] text-white dark:text-[#0f1f38] border border-primary'
          : 'border border-border dark:border-[#3f3f46] text-ink-secondary dark:text-[#a1a1aa] hover:border-primary hover:text-primary'
      }`}
    >
      {icon && (
        <span
          className={`inline-flex items-center justify-center w-5 h-5 rounded-full ${active ? '' : 'text-primary-800'}`}
          style={!active && colorVar ? { backgroundColor: `var(${colorVar})` } : undefined}
          aria-hidden="true"
        >
          {icon}
        </span>
      )}
      {label}
    </button>
  )
}

function BenefitCardView({
  card,
  category,
  lang,
  animationDelay,
}: {
  card: BenefitCard
  category?: BenefitEntry
  lang: 'es' | 'en'
  animationDelay: number
}) {
  const { t } = useTranslation()
  const title = lang === 'es' ? card.titleEs : card.titleEn
  const summary = lang === 'es' ? card.summaryEs : card.summaryEn
  const bullets = lang === 'es' ? card.bulletsEs : card.bulletsEn
  const ctaLabel = lang === 'es' ? card.ctaLabelEs : card.ctaLabelEn
  const categoryLabel = t(`benefits.${card.categorySlug}.name`, { defaultValue: card.categorySlug })

  return (
    <article
      className="flex flex-col rounded-card border border-border dark:border-[#3f3f46] bg-white dark:bg-[#27272a] shadow-card hover:shadow-card-hover transition-shadow duration-200 overflow-hidden animate-slide-up"
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      {card.imageUrl && (
        <div className="w-full aspect-[16/9] bg-page-bg dark:bg-[#18181b] overflow-hidden">
          <img
            src={card.imageUrl}
            alt={title}
            loading="lazy"
            className="w-full h-full object-cover"
          />
        </div>
      )}

      <div className="flex flex-col gap-3 p-5 flex-1">
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full font-mono text-label uppercase tracking-widest text-primary-800"
            style={category ? { backgroundColor: `var(${category.colorVar})` } : undefined}
          >
            {ICONS[card.categorySlug]}
            {categoryLabel}
          </span>
          {card.price && (
            <span className="ml-auto font-mono text-label uppercase tracking-widest text-ink-primary dark:text-[#f4f4f5]">
              {card.price}
            </span>
          )}
        </div>

        <h3 className="font-display font-bold text-h5 text-ink-primary dark:text-[#f4f4f5]">
          {title}
        </h3>

        {summary && (
          <p className="font-body text-body-sm text-ink-secondary dark:text-[#a1a1aa]">
            {summary}
          </p>
        )}

        {bullets.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {bullets.map((b) => (
              <li key={b} className="flex items-start gap-2 font-body text-body-sm text-ink-secondary dark:text-[#a1a1aa]">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-primary-300 dark:bg-[#7FA1D4] flex-shrink-0" aria-hidden="true" />
                {b}
              </li>
            ))}
          </ul>
        )}

        {card.ctaUrl && (
          <a
            href={card.ctaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-auto inline-flex items-center gap-1.5 font-mono text-label uppercase tracking-widest text-primary font-bold self-start"
          >
            {ctaLabel || t('benefits.learnMore')}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </a>
        )}
      </div>
    </article>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 px-6 rounded-card border border-dashed border-border dark:border-[#3f3f46] text-center">
      <div className="w-10 h-10 rounded-full bg-primary-50 dark:bg-primary-900 flex items-center justify-center" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" strokeWidth="2.5" />
        </svg>
      </div>
      <p className="font-body text-body-sm text-ink-secondary dark:text-[#a1a1aa]">
        {message}
      </p>
    </div>
  )
}
