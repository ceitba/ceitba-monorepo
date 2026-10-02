import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  canAccessAdmin,
  getSession,
  peekReturnPath,
  startGoogleSignIn,
  takeReturnPath,
} from '../../store/authStore'

const KNOWN_ERRORS = ['unauthorized', 'unauthorized_workspace', 'unverified_email', 'invalid_state', 'auth_failed']

// The API sets the HttpOnly session cookie before redirecting back here (no
// token in the URL), or appends ?error=<code> when the login was rejected.
// On success we refresh the profile and go back to where the user started
// (saved by startGoogleSignIn); admin-initiated logins without a saved
// destination land on the default for their role.
export default function AdminCallbackPage() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const [errorCode, setErrorCode] = useState(() => params.get('error') ?? params.get('authError'))

  useEffect(() => {
    if (errorCode) return
    let cancelled = false
    getSession({ force: true }).then((profile) => {
      if (cancelled) return
      if (!profile) {
        setErrorCode('auth_failed')
        return
      }
      const returnTo = takeReturnPath()
      navigate(returnTo ?? (canAccessAdmin(profile) ? '/admin/articles' : '/'), { replace: true })
    })
    return () => { cancelled = true }
  }, [errorCode, navigate])

  if (errorCode) {
    const code = KNOWN_ERRORS.includes(errorCode) ? errorCode : 'auth_failed'
    const returnTo = peekReturnPath()
    return (
      <div className="min-h-screen bg-primary-900 flex flex-col items-center justify-center px-4">
        <div role="alert" className="w-full max-w-sm bg-white rounded-card shadow-card-hover p-8 flex flex-col gap-4 text-center">
          <p className="font-display text-h4 font-bold text-ink-primary">{t('auth.errorTitle')}</p>
          <p className="font-body text-body-sm text-red-700 bg-red-50 border border-red-200 rounded-sm px-3 py-2">
            {t(`auth.errors.${code}`)}
          </p>
          <button
            type="button"
            onClick={() => startGoogleSignIn({ returnTo })}
            className="min-h-[44px] px-5 bg-primary text-surface font-body font-semibold rounded-sm hover:bg-primary-600 transition-colors duration-150 focus-visible:rounded"
          >
            {t('auth.tryAgain')}
          </button>
          <Link
            to={returnTo ?? '/'}
            onClick={() => takeReturnPath()}
            className="font-mono text-label text-ink-secondary hover:text-primary underline underline-offset-2"
          >
            {t('auth.back')}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-primary-900 flex items-center justify-center">
      <p className="text-white font-mono text-label uppercase tracking-widest">
        {t('auth.verifying')}
      </p>
    </div>
  )
}
