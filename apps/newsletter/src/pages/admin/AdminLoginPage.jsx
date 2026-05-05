import { useSearchParams } from 'react-router-dom'
import { startGoogleSignIn } from '../../store/authStore'

const ERROR_MESSAGES = {
  unauthorized:           'Solo cuentas @itba.edu.ar pueden iniciar sesión.',
  unauthorized_workspace: 'Solo cuentas del workspace ITBA pueden iniciar sesión.',
  unverified_email:       'Tu correo de Google aún no está verificado.',
  auth_failed:            'No pudimos completar el inicio de sesión. Probá de nuevo.',
}

export default function AdminLoginPage() {
  const [params] = useSearchParams()
  const errorCode = params.get('error')
  const errorMsg = errorCode ? (ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.auth_failed) : null

  return (
    <div className="min-h-screen bg-primary-900 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm bg-white rounded-card shadow-card-hover p-8">
        <div className="mb-8 text-center">
          <p className="font-display text-h3 font-bold text-primary">ITBA News</p>
          <p className="font-mono text-label text-ink-secondary uppercase tracking-widest mt-1">
            Panel de Administración
          </p>
        </div>

        {errorMsg && (
          <p className="mb-4 px-3 py-2 rounded-sm bg-red-50 text-red-700 font-body text-body-sm border border-red-200">
            {errorMsg}
          </p>
        )}

        <button
          type="button"
          onClick={startGoogleSignIn}
          className="w-full min-h-[44px] flex items-center justify-center gap-3 bg-white border border-border rounded-sm font-body text-body font-semibold text-ink-primary hover:border-primary hover:bg-primary-50 transition-colors duration-150 focus-visible:rounded"
        >
          <GoogleIcon />
          Ingresar con Google (ITBA)
        </button>

        <p className="mt-6 font-mono text-label text-ink-secondary text-center leading-relaxed">
          Requiere cuenta <span className="text-primary font-medium">@itba.edu.ar</span>
        </p>
      </div>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#4285F4" d="M24 9.5c3.2 0 5.9 1.1 8.1 3.2l6-6C34.5 3.2 29.7 1 24 1 15 1 7.4 6.3 4 13.8l7 5.4C12.8 13.2 17.9 9.5 24 9.5z"/>
      <path fill="#34A853" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.4c-.5 2.8-2.1 5.1-4.5 6.7l7 5.4c4.1-3.8 6.5-9.4 6.5-16.1z" clipPath="none"/>
      <path fill="#FBBC05" d="M11 28.2C10.4 26.6 10 24.9 10 23s.4-3.6 1-5.2L4 12.4C2.3 15.6 1 19.2 1 23s1.3 7.4 3 10.6l7-5.4z"/>
      <path fill="#EA4335" d="M24 46c5.7 0 10.5-1.9 14-5.1l-7-5.4c-1.9 1.3-4.3 2-7 2-6.1 0-11.2-3.7-13-9.1l-7 5.4C7.4 41.7 15 46 24 46z"/>
    </svg>
  )
}
