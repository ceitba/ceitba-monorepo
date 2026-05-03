import { useTranslation } from 'react-i18next'

interface AppCardProps {
  href: string
  label: string
  description: string
  cta: string
  icon: React.ReactNode
  colorVar: string
}

function AppCard({ href, label, description, cta, icon, colorVar }: AppCardProps) {
  return (
    <a
      href={href}
      className="group flex flex-col rounded-card border border-border dark:border-[#3f3f46] bg-white dark:bg-[#27272a] shadow-card hover:shadow-card-hover transition-shadow duration-200 overflow-hidden"
    >
      <div
        className="flex items-center justify-center h-24 sm:h-32"
        style={{ backgroundColor: `var(${colorVar})` }}
        aria-hidden="true"
      >
        <div className="text-primary-800">
          {icon}
        </div>
      </div>
      <div className="flex flex-col flex-1 p-5 gap-3">
        <h3 className="font-display font-bold text-h5 text-ink-primary dark:text-[#f4f4f5] group-hover:text-primary transition-colors duration-150">
          {label}
        </h3>
        <p className="font-body text-body-sm text-ink-secondary dark:text-[#a1a1aa] flex-1">
          {description}
        </p>
        <div className="flex items-center gap-1.5 font-mono text-label uppercase tracking-widest text-primary font-bold">
          {cta}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="group-hover:translate-x-1 transition-transform duration-150">
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </div>
      </div>
    </a>
  )
}

const SchedulerIcon = () => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
    <line x1="8" y1="14" x2="8" y2="14" strokeWidth="2.5" />
    <line x1="12" y1="14" x2="12" y2="14" strokeWidth="2.5" />
    <line x1="16" y1="14" x2="16" y2="14" strokeWidth="2.5" />
    <line x1="8" y1="18" x2="8" y2="18" strokeWidth="2.5" />
    <line x1="12" y1="18" x2="12" y2="18" strokeWidth="2.5" />
  </svg>
)

const NewsletterIcon = () => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
    <polyline points="22,6 12,13 2,6" />
  </svg>
)

export default function AppsSection() {
  const { t } = useTranslation()

  return (
    <section className="py-section-mobile lg:py-section bg-white dark:bg-[#1c1c1f]" aria-labelledby="apps-heading">
      <div className="container-content">
        <div className="mb-8">
          <h2 id="apps-heading" className="font-display font-bold text-h3 text-ink-primary dark:text-[#f4f4f5] mb-2">
            {t('apps.sectionTitle')}
          </h2>
          <p className="font-body text-body text-ink-secondary dark:text-[#a1a1aa]">
            {t('apps.sectionSubtitle')}
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
          <AppCard
            href="/scheduler"
            label={t('apps.scheduler.label')}
            description={t('apps.scheduler.description')}
            cta={t('apps.scheduler.cta')}
            icon={<SchedulerIcon />}
            colorVar="--dept-color-it"
          />
          <AppCard
            href="/newsletter"
            label={t('apps.newsletter.label')}
            description={t('apps.newsletter.description')}
            cta={t('apps.newsletter.cta')}
            icon={<NewsletterIcon />}
            colorVar="--dept-color-nautica"
          />
        </div>
      </div>
    </section>
  )
}
