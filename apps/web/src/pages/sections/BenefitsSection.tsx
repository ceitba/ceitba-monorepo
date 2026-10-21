import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useBenefitCards, useBenefits } from '../../hooks/useContent'
import type { BenefitCard, BenefitEntry } from '../../api/content'
import { Button, EmptyState, ErrorState, SkeletonCards, ToggleGroup } from '../../components/ui'
import { benefitCategoryName } from '../../utils/benefits'
import BenefitIcon from './BenefitIcon'
import { safeHttpUrl, safeLinkUrl } from '../../utils/url'

const ALL = '__all__'

export default function BenefitsSection() {
  const { t, i18n } = useTranslation()
  const lang: 'es' | 'en' = i18n.language === 'en' ? 'en' : 'es'
  const { data: categories, loading: loadingCategories, error: categoriesError, reload: reloadCategories } = useBenefits()
  const { data: cards, loading: loadingCards, error: cardsError, reload: reloadCards } = useBenefitCards()
  const categoryList: BenefitEntry[] = categories ?? []
  const cardList = useMemo<BenefitCard[]>(() => cards ?? [], [cards])

  const [active, setActive] = useState<string>(ALL)

  const visibleCards = useMemo(() => {
    if (active === ALL) return cardList
    return cardList.filter((c) => c.categorySlug === active)
  }, [cardList, active])

  const loading = loadingCategories || loadingCards
  const failed = categoriesError != null || cardsError != null
  const retry = () => {
    if (categoriesError != null) void reloadCategories()
    if (cardsError != null) void reloadCards()
  }

  return (
    <section className="py-section-mobile lg:py-section" aria-labelledby="benefits-heading">
      <div className="container-content">
        <div className="mb-8">
          <h1 id="benefits-heading" className="font-display font-bold text-h2 text-ink-primary dark:text-night-text mb-2">
            {t('benefits.sectionTitle')}
          </h1>
          <p className="font-body text-body text-ink-secondary dark:text-night-muted">
            {t('benefits.sectionSubtitle')}
          </p>
        </div>

        {categoryList.length > 0 && (
          <ToggleGroup
            className="mb-8"
            label={t('benefits.filterLabel')}
            value={active}
            onChange={setActive}
            options={[
              { value: ALL, label: t('benefits.all') },
              ...categoryList.map((c) => ({
                value: c.slug,
                label: <CategoryLabel label={benefitCategoryName(c.slug, c, lang, t)} icon={<BenefitIcon slug={c.slug} />} colorVar={c.colorVar} active={active === c.slug} />,
              })),
            ]}
          />
        )}

        {failed && !loading ? (
          <ErrorState onRetry={retry} />
        ) : loading ? (
          <SkeletonCards count={6} cardClassName="h-72" />
        ) : visibleCards.length === 0 ? (
          <EmptyState
            title={t(active === ALL ? 'benefits.emptyTitle' : 'benefits.emptyFilteredTitle')}
            body={t(active === ALL ? 'benefits.empty' : 'benefits.emptyFiltered')}
            action={active !== ALL ? <Button variant="outline" onClick={() => setActive(ALL)}>{t('benefits.showAll')}</Button> : undefined}
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 animate-fade-in">
            {visibleCards.map((card) => (
              <BenefitCardView
                key={card.id}
                card={card}
                category={categoryList.find((c) => c.slug === card.categorySlug)}
                lang={lang}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

// Category filter label: the category's colour dot + icon, then its name.
function CategoryLabel({
  label,
  active,
  colorVar,
  icon,
}: {
  label: string
  active: boolean
  colorVar?: string
  icon?: React.ReactNode
}) {
  return (
    <span className="inline-flex items-center gap-2">
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
    </span>
  )
}

function BenefitCardView({
  card,
  category,
  lang,
}: {
  card: BenefitCard
  category?: BenefitEntry
  lang: 'es' | 'en'
}) {
  const { t } = useTranslation()
  const title = lang === 'es' ? card.titleEs : card.titleEn
  const summary = lang === 'es' ? card.summaryEs : card.summaryEn
  const bullets = lang === 'es' ? card.bulletsEs : card.bulletsEn
  const ctaLabel = lang === 'es' ? card.ctaLabelEs : card.ctaLabelEn
  const categoryLabel = benefitCategoryName(card.categorySlug, category, lang, t)
  const imageUrl = safeHttpUrl(card.imageUrl)
  const ctaUrl = safeLinkUrl(card.ctaUrl)

  return (
    <article
      className="flex flex-col rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface shadow-card hover:shadow-card-hover transition-shadow duration-200 overflow-hidden">
      {imageUrl && (
        <div className="w-full aspect-video bg-page-bg dark:bg-night-bg overflow-hidden">
          <img
            src={imageUrl}
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
            <BenefitIcon slug={card.categorySlug} />
            {categoryLabel}
          </span>
          {card.price && (
            <span className="ml-auto font-mono text-label uppercase tracking-widest text-ink-primary dark:text-night-text">
              {card.price}
            </span>
          )}
        </div>

        <h3 className="font-display font-bold text-h5 text-ink-primary dark:text-night-text">
          {title}
        </h3>

        {summary && (
          <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">
            {summary}
          </p>
        )}

        {bullets.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {bullets.map((b) => (
              <li key={b} className="flex items-start gap-2 font-body text-body-sm text-ink-secondary dark:text-night-muted">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-primary-300 dark:bg-primary-300 shrink-0" aria-hidden="true" />
                {b}
              </li>
            ))}
          </ul>
        )}

        {ctaUrl && (
          <a
            href={ctaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-auto min-h-[44px] inline-flex items-center gap-1.5 font-mono text-label uppercase tracking-widest text-primary font-bold self-start"
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
