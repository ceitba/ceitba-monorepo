/**
 * Contributor auth store — mock Google OIDC for @itba.edu.ar accounts.
 * Replace signInContributor with a Google OIDC redirect that enforces hd=itba.edu.ar.
 */

const SESSION_KEY = 'itbanews_contributor_session'

const DEMO_CONTRIBUTORS = [
  { id: 'c1', email: 'alumno@itba.edu.ar',   password: 'itba2025', name: 'María García',  role: 'contributor' },
  { id: 'c2', email: 'delegado@itba.edu.ar', password: 'itba2025', name: 'Lucas Pérez',   role: 'contributor' },
]

export function signInContributor(email, password) {
  if (!email.endsWith('@itba.edu.ar')) {
    return { ok: false, error: 'Usá tu cuenta institucional @itba.edu.ar.' }
  }
  const user = DEMO_CONTRIBUTORS.find((u) => u.email === email && u.password === password)
  if (!user) return { ok: false, error: 'Credenciales incorrectas.' }

  const session = {
    id:        user.id,
    name:      user.name,
    email:     user.email,
    role:      'contributor',
    expiresAt: Date.now() + 8 * 60 * 60 * 1000,
  }
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
  return { ok: true, session }
}

export function getContributorSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const session = JSON.parse(raw)
    if (session.expiresAt < Date.now()) {
      sessionStorage.removeItem(SESSION_KEY)
      return null
    }
    return session
  } catch { return null }
}

export function isContributorAuthenticated() {
  return getContributorSession() !== null
}

export function signOutContributor() {
  sessionStorage.removeItem(SESSION_KEY)
}
