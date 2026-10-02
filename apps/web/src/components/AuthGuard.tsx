import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { startGoogleSignIn } from '../store/authStore'

// Logged-in-only pages. Like StaffGuard it waits for /me (the session cookie
// is HttpOnly), but instead of bouncing anonymous visitors home it explains
// why they need to sign in and sends them through Google, returning to the
// page they asked for.
export default function AuthGuard({ children }: { children: ReactElement }) {
  const { t } = useTranslation()
  const { loading, isAuthenticated } = useAuth()
  const location = useLocation()

  if (loading) return null
  if (isAuthenticated) return children

  const returnTo = `${location.pathname}${location.search}`
  const devLogin = import.meta.env.DEV && import.meta.env.VITE_DEV_LOGIN === 'true'

  return (
    <main id="main-content" className="container-content py-section-mobile lg:py-section">
      <div className="max-w-lg mx-auto flex flex-col items-center text-center gap-5 py-12 animate-fade-in">
        <div className="relative w-20 h-20" aria-hidden="true">
          <div className="absolute inset-0 rounded-full bg-primary-50 dark:bg-primary-900" />
          <div className="absolute top-3 left-3 w-8 h-8 rotate-45 bg-accent-100 dark:bg-accent-800" />
          <div className="absolute bottom-3 right-3 w-5 h-5 rounded-full bg-primary-200 dark:bg-primary-700" />
        </div>
        <h1 className="font-display font-bold text-h3 text-ink-primary dark:text-night-text">
          {t('authGuard.title')}
        </h1>
        <p className="font-body text-body text-ink-secondary dark:text-night-muted">
          {t('authGuard.body')}
        </p>
        <button
          type="button"
          onClick={() => startGoogleSignIn(returnTo)}
          className="min-h-[44px] px-6 py-2.5 bg-primary text-surface font-body font-semibold rounded-sm hover:bg-primary-600 transition-colors duration-150"
        >
          {t('authGuard.signIn')}
        </button>
        {devLogin && (
          <Link
            to={`/dev-login?returnTo=${encodeURIComponent(returnTo)}`}
            className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted hover:text-primary"
          >
            {t('devLogin.link')}
          </Link>
        )}
      </div>
    </main>
  )
}
