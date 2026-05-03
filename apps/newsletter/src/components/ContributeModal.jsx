import { startGoogleSignIn } from '../store/authStore'

export default function ContributeModal({ open, onClose }) {
  if (!open) return null

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-ink-primary/50"
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="contribute-modal-title"
        className="fixed z-50 inset-0 flex items-center justify-center p-4"
      >
        <div className="bg-white rounded-card shadow-xl max-w-sm w-full p-8 flex flex-col items-center gap-6 relative">
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center text-ink-secondary hover:text-ink-primary rounded-sm transition-colors duration-150"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>

          <div className="text-center">
            <p id="contribute-modal-title" className="font-display text-h4 font-bold text-ink-primary">
              Contribuir
            </p>
            <p className="font-body text-body-sm text-ink-secondary mt-2">
              Iniciá sesión con tu cuenta{' '}
              <span className="font-semibold text-ink-primary">@itba.edu.ar</span>{' '}
              para proponer artículos y eventos.
            </p>
          </div>

          <button
            type="button"
            onClick={startGoogleSignIn}
            className="w-full inline-flex items-center justify-center gap-3 min-h-[48px] px-6 bg-white border border-border rounded-sm shadow-sm hover:shadow-md font-body text-body-sm font-semibold text-ink-primary transition-shadow duration-150"
          >
            <GoogleIcon />
            Iniciar sesión con Google
          </button>

          <p className="font-mono text-label text-ink-secondary text-center">
            Solo cuentas <span className="text-ink-primary">@itba.edu.ar</span>
          </p>
        </div>
      </div>
    </>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
      <path fill="none" d="M0 0h48v48H0z"/>
    </svg>
  )
}
