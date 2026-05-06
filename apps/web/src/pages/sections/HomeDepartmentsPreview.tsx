import { useTranslation } from 'react-i18next'
import { useDepartments } from '../../hooks/useContent'

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

export default function HomeDepartmentsPreview({ onSeeAll }: { onSeeAll: () => void }) {
  const { t } = useTranslation()
  const { data, loading } = useDepartments()
  const departments = (data ?? []).slice(0, 6)

  return (
    <section
      className="py-section-mobile lg:py-section bg-page-bg dark:bg-[#18181b]"
      aria-labelledby="home-departments-heading"
    >
      <div className="container-content">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-8">
          <div>
            <span className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-[#a1a1aa]">
              {t('home.departments.eyebrow')}
            </span>
            <h2
              id="home-departments-heading"
              className="font-display font-bold text-h3 text-ink-primary dark:text-[#f4f4f5] mt-1 mb-2"
            >
              {t('home.departments.title')}
            </h2>
            <p className="font-body text-body text-ink-secondary dark:text-[#a1a1aa] max-w-2xl">
              {t('home.departments.subtitle')}
            </p>
          </div>
          <SeeAllButton onClick={onSeeAll} label={t('home.departments.seeAll')} />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {loading
            ? Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="h-28 rounded-card border border-border dark:border-[#3f3f46] bg-white dark:bg-[#27272a] skeleton"
                />
              ))
            : departments.map((dept, i) => (
                <button
                  key={dept.slug}
                  type="button"
                  onClick={onSeeAll}
                  className="group flex flex-col items-start gap-2.5 p-4 rounded-card border border-border dark:border-[#3f3f46] bg-white dark:bg-[#27272a] shadow-card hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200 text-left animate-slide-up"
                  style={{ animationDelay: `${i * 50}ms` }}
                  aria-label={t('home.departments.tileAria', { name: t(`departments.${dept.slug}.name`) })}
                >
                  <span
                    className="w-9 h-9 rounded-card flex items-center justify-center text-primary-800 flex-shrink-0"
                    style={{ backgroundColor: `var(${dept.colorVar})` }}
                  >
                    {ICONS[dept.slug]}
                  </span>
                  <span className="font-display font-bold text-body-sm text-ink-primary dark:text-[#f4f4f5] group-hover:text-primary transition-colors duration-150 leading-tight">
                    {t(`departments.${dept.slug}.name`)}
                  </span>
                </button>
              ))
          }
        </div>
      </div>
    </section>
  )
}

function SeeAllButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 font-mono text-label uppercase tracking-widest text-primary font-bold hover:gap-2.5 transition-all duration-150 self-start sm:self-auto"
    >
      {label}
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <line x1="5" y1="12" x2="19" y2="12" />
        <polyline points="12 5 19 12 12 19" />
      </svg>
    </button>
  )
}
