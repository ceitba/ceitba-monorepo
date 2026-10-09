import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import AuthGuard from './AuthGuard'
import { EmptyState, buttonClass } from './ui'
import PageFallback from './PageFallback'
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

  if (loading) return <PageFallback />
  if (enabled) return children

  return (
    <main id="main-content" tabIndex={-1} className="outline-none container-content py-section-mobile lg:py-section">
      <EmptyState
        title={
          <span role="heading" aria-level={1}>
            {t(`capabilityGuard.${capability}.title`, { defaultValue: t('capabilityGuard.title') })}
          </span>
        }
        body={t(`capabilityGuard.${capability}.body`, { defaultValue: t('capabilityGuard.body') })}
        action={<Link to="/" className={buttonClass()}>{t('capabilityGuard.home')}</Link>}
      />
    </main>
  )
}
