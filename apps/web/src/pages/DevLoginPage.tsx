import '../i18nApuntes'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { devLogin } from '../api/drive'
import { getSession } from '../store/authStore'
import { apuntesErrorMessage, isSafeReturnPath } from '../utils/apuntes'
import { Alert, Button, Field, inputClass } from '../components/ui'

// Local-only sign-in against CEITBA-API's POST /v1/auth/dev-login (API `dev`
// profile + AUTH_DEV_LOGIN_ENABLED=true). App.tsx only lazy-imports this
// page when `import.meta.env.DEV && VITE_DEV_LOGIN === 'true'`, so it is not
// part of production bundles.
const PRESETS = [
  { email: 'alumno1@itba.edu.ar', name: 'Alumno Uno', staff: false },
  { email: 'alumno2@itba.edu.ar', name: 'Alumno Dos', staff: false },
  { email: 'staff@itba.edu.ar', name: 'Staff CEITBA', staff: true },
]

export default function DevLoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [email, setEmail] = useState(PRESETS[0].email)
  const [name, setName] = useState(PRESETS[0].name)
  const [staff, setStaff] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function signIn(body: { email: string; name: string; staff: boolean }) {
    setBusy(true); setError(null)
    try {
      await devLogin(body)
      await getSession({ force: true })
      const returnTo = params.get('returnTo')
      navigate(isSafeReturnPath(returnTo) ? returnTo : '/apuntes', { replace: true })
    } catch (e) {
      setError(apuntesErrorMessage(e, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main id="main-content" tabIndex={-1} className="outline-none container-content py-section-mobile lg:py-section">
      <div className="max-w-md mx-auto flex flex-col gap-5 p-6 rounded-card border-2 border-dashed border-accent-400 bg-white dark:bg-night-surface">
        <div>
          <span className="font-mono text-label uppercase tracking-widest text-accent-600 dark:text-accent-300">{t('devLogin.eyebrow')}</span>
          <h1 className="font-display font-bold text-h4 text-ink-primary dark:text-night-text mt-1">{t('devLogin.title')}</h1>
          <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted mt-1">{t('devLogin.body')}</p>
        </div>

        {error && <Alert tone="error" onDismiss={() => setError(null)}>{error}</Alert>}

        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <Button key={p.email} variant="outline" disabled={busy} onClick={() => signIn(p)}>
              {p.staff ? t('devLogin.presetStaff', { user: p.email.split('@')[0] }) : p.email.split('@')[0]}
            </Button>
          ))}
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); void signIn({ email: email.trim(), name: name.trim(), staff }) }}
          className="flex flex-col gap-3 pt-4 border-t border-border dark:border-night-border"
        >
          <Field label={t('devLogin.email')} required>
            {(p) => <input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass()} />}
          </Field>
          <Field label={t('devLogin.name')} required>
            {(p) => <input {...p} type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputClass()} />}
          </Field>
          <label className="flex items-center gap-2 min-h-[44px] font-body text-body-sm text-ink-primary dark:text-night-text cursor-pointer">
            <input type="checkbox" checked={staff} onChange={(e) => setStaff(e.target.checked)} className="h-4 w-4 accent-primary" />
            {t('devLogin.staff')}
          </label>
          <Button type="submit" loading={busy} disabled={!email.trim()} className="self-start">
            {t('devLogin.submit')}
          </Button>
        </form>
      </div>
    </main>
  )
}
