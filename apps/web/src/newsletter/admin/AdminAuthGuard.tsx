import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import PageFallback from '@/components/PageFallback'
import { Button, EmptyState, buttonClass } from '@/components/ui'
import { startGoogleSignIn } from '@/store/authStore'
import { canAccessAdmin } from '../store/authStore'
import { useAuthSession } from '../hooks/useAuthSession'
import { newsletterPath } from '@/newsletter/paths'

// Cookie auth is HttpOnly, so wait for /me before deciding. Like the site's
// AuthGuard, anonymous visitors get a sign-in prompt that brings them back to
// the page they asked for; signed-in users without access are told why
// instead of being bounced away. Subscribes to the session, so signing out
// from the navbar swaps the admin for the prompt right away.
export default function AdminAuthGuard({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const location = useLocation()
  const { profile, loading } = useAuthSession()

  if (loading) return <PageFallback />

  if (!profile) {
    const returnTo = `${location.pathname}${location.search}`
    const devLogin = import.meta.env.DEV && import.meta.env.VITE_DEV_LOGIN === 'true'
    return (
      <main id="main-content" className="container-content py-section-mobile lg:py-section">
        <EmptyState
          title={<span role="heading" aria-level={1}>{t('admin.guard.signInTitle')}</span>}
          body={t('admin.guard.signInBody')}
          action={
            <div className="flex flex-col items-center gap-2">
              <Button onClick={() => startGoogleSignIn(returnTo)}>{t('admin.guard.signIn')}</Button>
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

  if (!canAccessAdmin(profile)) {
    return (
      <main id="main-content" className="container-content py-section-mobile lg:py-section">
        <EmptyState
          title={<span role="heading" aria-level={1}>{t('admin.guard.deniedTitle')}</span>}
          body={t('admin.guard.deniedBody')}
          action={
            <Link to={newsletterPath('/')} className={buttonClass({ variant: 'outline' })}>
              {t('admin.guard.backToNewsletter')}
            </Link>
          }
        />
      </main>
    )
  }

  return children
}
