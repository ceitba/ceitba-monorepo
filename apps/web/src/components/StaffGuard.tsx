import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import AuthGuard from './AuthGuard'
import PageFallback from './PageFallback'
import { buttonClass } from './ui'

// Cookie auth is HttpOnly so we can't tell synchronously whether the visitor
// is staff: wait for /me, then gate on profile.role === 'staff'. Anonymous
// visitors get AuthGuard's sign-in prompt; signed-in students are told in
// place why they can't see the page (never a silent redirect). useAuth
// subscribes to the auth store, so losing STAFF swaps the page immediately.
export default function StaffGuard({ children }: { children: ReactElement }) {
  const { t } = useTranslation()
  const { loading, isAuthenticated, isStaff } = useAuth()
  if (loading) return <PageFallback />
  if (!isAuthenticated) return <AuthGuard>{children}</AuthGuard>
  if (isStaff) return children

  return (
    <main id="main-content" tabIndex={-1} className="outline-none container-content py-section-mobile lg:py-section">
      <div className="max-w-lg mx-auto flex flex-col items-center text-center gap-5 py-12 animate-fade-in">
        <div className="relative w-20 h-20" aria-hidden="true">
          <div className="absolute inset-0 rounded-full bg-primary-50 dark:bg-primary-900" />
          <div className="absolute top-3 left-3 w-8 h-8 rotate-45 bg-accent-100 dark:bg-accent-800" />
          <div className="absolute bottom-3 right-3 w-5 h-5 rounded-full bg-primary-200 dark:bg-primary-700" />
        </div>
        <h1 className="font-display font-bold text-h3 text-ink-primary dark:text-night-text">{t('staffGuard.title')}</h1>
        <p className="font-body text-body text-ink-secondary dark:text-night-muted">{t('staffGuard.body')}</p>
        <Link to="/" className={buttonClass({ variant: 'outline' })}>{t('staffGuard.home')}</Link>
      </div>
    </main>
  )
}
