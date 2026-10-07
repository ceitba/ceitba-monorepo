import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { newsletterPath } from '@/newsletter/paths'

const PAGES = [
  { id: 'articles', to: '/' },
  { id: 'events', to: '/events' },
  { id: 'organizations', to: '/organizations' },
] as const

export type NewsletterPage = (typeof PAGES)[number]['id']

// Header of the newsletter's three public pages. There's no section bar
// under the app Navbar: the page says where you are ("ITBA News" eyebrow +
// title) and links to its two sibling pages right under the title, where
// you're already reading.
export default function NewsletterPageHeader({
  current,
  title,
  subtitle,
  action,
}: {
  current: NewsletterPage
  title: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <header className="mb-8 lg:mb-12 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
      <div>
        <p className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
          {t('nav.home')}
        </p>
        <h1 className="font-display text-h1 lg:text-display font-bold text-ink-primary dark:text-night-text leading-tight">
          {title}
        </h1>
        {subtitle && (
          <p className="font-body text-body-lg text-ink-secondary dark:text-night-muted mt-2">{subtitle}</p>
        )}
        <nav aria-label={t('nav.home')} className="mt-3">
          <ul className="flex flex-wrap items-center gap-x-5 list-none m-0 p-0">
            {PAGES.map((p) => (
              <li key={p.id}>
                {p.id === current ? (
                  <span aria-current="page" className="inline-flex items-center min-h-[44px] font-mono text-label uppercase tracking-widest font-bold text-ink-primary dark:text-night-text">
                    {t(`nav.${p.id}`)}
                  </span>
                ) : (
                  <Link
                    to={newsletterPath(p.to)}
                    className="inline-flex items-center gap-1 min-h-[44px] font-mono text-label uppercase tracking-widest text-primary dark:text-primary-300 hover:underline underline-offset-4"
                  >
                    {t(`nav.${p.id}`)}
                    <span aria-hidden="true">→</span>
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </nav>
      </div>
      {action}
    </header>
  )
}
