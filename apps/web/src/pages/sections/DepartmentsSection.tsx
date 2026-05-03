import { useTranslation } from 'react-i18next'
import departmentsData from '../../data/departments.json'

interface DepartmentEntry {
  id: string
  colorVar: string
  order: number
}

const departments = (departmentsData as DepartmentEntry[]).sort((a, b) => a.order - b.order)

const ICONS: Record<string, React.ReactNode> = {
  it: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  ),
  media: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="23 7 16 12 23 17 23 7" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  ),
  infraestructura: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  ),
  nautica: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="5" r="3" />
      <line x1="12" y1="22" x2="12" y2="8" />
      <path d="M5 12H2a10 10 0 0 0 20 0h-3" />
    </svg>
  ),
  deportes: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="6" />
      <path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11" />
    </svg>
  ),
  directivos: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
}

export default function DepartmentsSection() {
  const { t } = useTranslation()

  return (
    <section className="py-section-mobile lg:py-section" aria-labelledby="departments-heading">
      <div className="container-content">
        <div className="mb-8">
          <h2 id="departments-heading" className="font-display font-bold text-h3 text-ink-primary dark:text-[#f4f4f5] mb-2">
            {t('departments.sectionTitle')}
          </h2>
          <p className="font-body text-body text-ink-secondary dark:text-[#a1a1aa]">
            {t('departments.sectionSubtitle')}
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {departments.map((dept, i) => (
            <article
              key={dept.id}
              className="flex flex-col gap-4 p-5 rounded-card border border-border dark:border-[#3f3f46] bg-white dark:bg-[#27272a] shadow-card hover:shadow-card-hover transition-shadow duration-200 animate-slide-up"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <div
                className="w-12 h-12 rounded-card flex items-center justify-center text-primary-800 flex-shrink-0"
                style={{ backgroundColor: `var(${dept.colorVar})` }}
              >
                {ICONS[dept.id]}
              </div>
              <div className="flex flex-col gap-1.5">
                <h3 className="font-display font-bold text-h5 text-ink-primary dark:text-[#f4f4f5]">
                  {t(`departments.${dept.id}.name`)}
                </h3>
                <p className="font-body text-body-sm text-ink-secondary dark:text-[#a1a1aa]">
                  {t(`departments.${dept.id}.description`)}
                </p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
