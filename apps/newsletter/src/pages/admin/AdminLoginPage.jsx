import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { signInWithCredentials } from '../../store/authStore'

export default function AdminLoginPage() {
  const navigate  = useNavigate()
  const location  = useLocation()
  const from      = location.state?.from ?? '/admin/articles'

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    // Simulate network round-trip; replace with real OAuth redirect
    await new Promise((r) => setTimeout(r, 400))
    const result = signInWithCredentials(username.trim(), password)
    setLoading(false)

    if (result.ok) {
      navigate(from, { replace: true })
    } else {
      setError(result.error)
    }
  }

  return (
    <div className="min-h-screen bg-primary-900 flex flex-col items-center justify-center px-4">
      {/* Card */}
      <div className="w-full max-w-sm bg-white rounded-card shadow-card-hover p-8">
        {/* Brand */}
        <div className="mb-8 text-center">
          <p className="font-display text-h3 font-bold text-primary">ITBA News</p>
          <p className="font-mono text-label text-ink-secondary uppercase tracking-widest mt-1">
            Panel de Administración
          </p>
        </div>

        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
          <Field
            label="Usuario"
            id="username"
            type="text"
            value={username}
            onChange={setUsername}
            autoComplete="username"
            disabled={loading}
          />
          <Field
            label="Contraseña"
            id="password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            disabled={loading}
          />

          {error && (
            <p role="alert" className="font-body text-body-sm text-red-600 bg-red-50 px-3 py-2 rounded-sm">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="min-h-[44px] bg-primary text-surface font-body font-semibold rounded-sm hover:bg-primary-600 transition-colors duration-150 disabled:opacity-60 disabled:cursor-not-allowed focus-visible:rounded"
          >
            {loading ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>

        {/* OAuth stub note */}
        <p className="mt-6 font-mono text-label text-ink-secondary text-center leading-relaxed">
          Próximamente: acceso con
          <br />
          <span className="text-primary font-medium">Google (ITBA)</span>
        </p>

        {/* Demo hint */}
        <p className="mt-4 font-mono text-label text-border text-center">
          demo: admin / ceitba2025
        </p>
      </div>
    </div>
  )
}

function Field({ label, id, type, value, onChange, autoComplete, disabled }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-body text-body-sm font-semibold text-ink-primary">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        disabled={disabled}
        required
        className="w-full min-h-[44px] px-3 py-2 border border-border rounded-sm font-body text-body text-ink-primary bg-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-60"
      />
    </div>
  )
}
