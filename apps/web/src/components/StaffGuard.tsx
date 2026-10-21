import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import AuthGuard from './AuthGuard'
import PageFallback from './PageFallback'
import { EmptyState, buttonClass } from './ui'

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
    <main id="main-content" tabIndex={-1} className="outline-hidden container-content py-section-mobile lg:py-section">
      <EmptyState
        title={<span role="heading" aria-level={1}>{t('staffGuard.title')}</span>}
        body={t('staffGuard.body')}
        action={<Link to="/" className={buttonClass({ variant: 'outline' })}>{t('staffGuard.home')}</Link>}
      />
    </main>
  )
}
