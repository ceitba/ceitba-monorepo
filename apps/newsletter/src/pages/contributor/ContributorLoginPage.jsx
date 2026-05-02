import { useState } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { signInContributor } from '../../store/contributorAuthStore'

export default function ContributorLoginPage() {
  const navigate  = useNavigate()
  const location  = useLocation()
  const from      = location.state?.from ?? '/contribute'

  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    await new Promise((r) => setTimeout(r, 400))
    const result = signInContributor(email.trim(), password)
    setLoading(false)
    if (result.ok) {
      navigate(from, { replace: true })
    } else {
      setError(result.error)
    }
  }

  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="mb-8 text-center">
          <Link to="/" className="inline-block focus-visible:rounded">
            <span className="font-display text-h3 font-bold text-primary">ITBA News</span>
          </Link>
          <p className="font-body text-body-sm text-ink-secondary mt-1">Portal de contribuidores</p>
        </div>

        <div className="bg-white rounded-card border border-border shadow-card p-8">
          <h1 className="font-display text-h4 font-bold text-ink-primary mb-1">Acceder</h1>
          <p className="font-body text-body-sm text-ink-secondary mb-6">
            Usá tu cuenta <span className="font-semibold text-ink-primary">@itba.edu.ar</span>
          </p>

          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="font-body text-body-sm font-semibold text-ink-primary" htmlFor="email">
                Correo institucional
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vos@itba.edu.ar"
                required
                className="w-full min-h-[44px] px-3 py-2 border border-border rounded-sm font-body text-body text-ink-primary bg-white focus:outline-none focus:ring-1 focus:border-primary focus:ring-primary/30 transition-colors duration-150"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="font-body text-body-sm font-semibold text-ink-primary" htmlFor="password">
                Contraseña
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full min-h-[44px] px-3 py-2 border border-border rounded-sm font-body text-body text-ink-primary bg-white focus:outline-none focus:ring-1 focus:border-primary focus:ring-primary/30 transition-colors duration-150"
              />
            </div>

            {error && (
              <p role="alert" className="font-body text-body-sm text-red-600 bg-red-50 rounded-sm px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="min-h-[44px] w-full bg-primary text-surface font-body font-semibold rounded-sm hover:bg-primary-600 transition-colors duration-150 disabled:opacity-60 focus-visible:rounded mt-1"
            >
              {loading ? 'Ingresando…' : 'Ingresar'}
            </button>
          </form>

          <div className="mt-4 p-3 rounded-sm bg-surface border border-border">
            <p className="font-mono text-label text-ink-secondary uppercase tracking-widest mb-2">Demo</p>
            <p className="font-body text-body-sm text-ink-secondary">
              <span className="font-semibold text-ink-primary">alumno@itba.edu.ar</span> / itba2025
            </p>
            <p className="font-body text-body-sm text-ink-secondary mt-0.5">
              <span className="font-semibold text-ink-primary">delegado@itba.edu.ar</span> / itba2025
            </p>
          </div>
        </div>

        <p className="text-center font-body text-body-sm text-ink-secondary mt-6">
          ¿Staff de CEITBA?{' '}
          <Link to="/admin/login" className="text-primary hover:underline underline-offset-2 font-semibold">
            Acceder al panel admin
          </Link>
        </p>
      </div>
    </div>
  )
}
