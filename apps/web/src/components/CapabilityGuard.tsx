import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import AuthGuard from './AuthGuard'
import { useCapability } from '../hooks/useCapability'

// Logged-in pages behind a feature capability (today: Apuntes). Anonymous
// visitors get AuthGuard's sign-in prompt; signed-in users without the
// capability (or whose API calls came back 403 CAPABILITY_REQUIRED) get a
// friendly "not enabled for your account" page instead of an error.
export default function CapabilityGuard({ capability, children }: { capability: string; children: ReactElement }) {
  return (
    <AuthGuard>
      <CapabilityCheck capability={capability}>{children}</CapabilityCheck>
    </AuthGuard>
  )
}

function CapabilityCheck({ capability, children }: { capability: string; children: ReactElement }) {
  const { t } = useTranslation()
  const { enabled, loading } = useCapability(capability)

  if (loading) return null
  if (enabled) return children

  return (
    <main id="main-content" className="container-content py-section-mobile lg:py-section">
      <div className="max-w-lg mx-auto flex flex-col items-center text-center gap-5 py-12 animate-fade-in">
        <div className="relative w-20 h-20" aria-hidden="true">
          <div className="absolute inset-0 rounded-full bg-accent-50 dark:bg-accent-900" />
          <div className="absolute top-3 right-3 w-8 h-8 rotate-45 bg-primary-100 dark:bg-primary-800" />
          <div className="absolute bottom-3 left-3 w-5 h-5 rounded-full bg-accent-200 dark:bg-accent-700" />
        </div>
        <h1 className="font-display font-bold text-h3 text-ink-primary dark:text-night-text">
          {t(`capabilityGuard.${capability}.title`, { defaultValue: t('capabilityGuard.title') })}
        </h1>
        <p className="font-body text-body text-ink-secondary dark:text-night-muted">
          {t(`capabilityGuard.${capability}.body`, { defaultValue: t('capabilityGuard.body') })}
        </p>
        <Link
          to="/"
          className="min-h-[44px] inline-flex items-center px-6 py-2.5 bg-primary text-surface font-body font-semibold rounded-sm hover:bg-primary-600 transition-colors duration-150"
        >
          {t('capabilityGuard.home')}
        </Link>
      </div>
    </main>
  )
}
