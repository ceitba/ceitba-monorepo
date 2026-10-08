import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { startGoogleSignIn } from '../store/authStore'
import { Button, EmptyState, buttonClass } from './ui'
import PageFallback from './PageFallback'

// Logged-in-only pages. Like StaffGuard it waits for /me (the session cookie
// is HttpOnly), but instead of bouncing anonymous visitors home it explains
// why they need to sign in and sends them through Google, returning to the
// page they asked for.
export default function AuthGuard({ children }: { children: ReactElement }) {
  const { t } = useTranslation()
  const { loading, isAuthenticated } = useAuth()
  const location = useLocation()

  if (loading) return <PageFallback />
  if (isAuthenticated) return children

  const returnTo = `${location.pathname}${location.search}`
  const devLogin = import.meta.env.DEV && import.meta.env.VITE_DEV_LOGIN === 'true'

  return (
    <main id="main-content" tabIndex={-1} className="outline-none container-content py-section-mobile lg:py-section">
      <EmptyState
        title={<span role="heading" aria-level={1}>{t('authGuard.title')}</span>}
        body={t('authGuard.body')}
        action={
          <div className="flex flex-col items-center gap-2">
            <Button onClick={() => startGoogleSignIn(returnTo)}>{t('authGuard.signIn')}</Button>
            {devLogin && (
              <Link to={`/dev-login?returnTo=${encodeURIComponent(returnTo)}`} className={buttonClass({ variant: 'ghost', size: 'sm' })}>
                {t('devLogin.link', { defaultValue: 'Dev login' })}
              </Link>
            )}
          </div>
        }
      />
    </main>
  )
}
