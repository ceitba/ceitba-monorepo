import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useSearchParams } from 'react-router-dom'
import ErrorBanner from './ErrorBanner'

// Error codes the API puts on the OAuth redirect (AuthController /
// LoginRejectedException). Anything else falls back to auth_failed.
const KNOWN = new Set(['unauthorized', 'unauthorized_workspace', 'unverified_email', 'auth_failed', 'invalid_state'])

// AuthCallback forwards `?error=` as `/?authError=…`; a failed state check
// redirects straight to the frontend root with `?error=`. Read either, show a
// dismissible banner, and strip the param so a reload doesn't re-show it.
export default function AuthErrorBanner() {
  const { t } = useTranslation()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const [code, setCode] = useState<string | null>(null)

  useEffect(() => {
    if (location.pathname === '/auth/callback') return
    const raw = params.get('authError') ?? params.get('error')
    if (raw == null) return
    setCode(KNOWN.has(raw) ? raw : 'auth_failed')
    const next = new URLSearchParams(params)
    next.delete('authError')
    next.delete('error')
    setParams(next, { replace: true })
  }, [location.pathname, params, setParams])

  if (!code) return null
  return (
    <div className="container-content pt-4">
      <ErrorBanner onDismiss={() => setCode(null)}>{t(`auth.errors.${code}`)}</ErrorBanner>
    </div>
  )
}
