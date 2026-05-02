/**
 * Auth store.
 *
 * Current implementation: credential check against hardcoded values.
 * Intended replacement: OIDC / Google Sign-In via the ITBA API.
 *
 * To migrate, replace `signInWithCredentials` with a function that:
 *   1. Initiates the Google OAuth flow (redirect or popup)
 *   2. Exchanges the auth code at POST /auth/google/callback
 *   3. Stores the returned JWT in sessionStorage under SESSION_KEY
 *
 * Everything else (getSession, signOut, isAuthenticated) stays the same.
 */

const SESSION_KEY = 'itbanews_admin_session'

// --- Demo credentials (replace with OIDC) ---
const DEMO_USER = {
  username: 'admin',
  password: 'ceitba2025',
  name:     'Administrador CEITBA',
  role:     'community_manager',
}

export function signInWithCredentials(username, password) {
  if (username === DEMO_USER.username && password === DEMO_USER.password) {
    const session = {
      name:      DEMO_USER.name,
      role:      DEMO_USER.role,
      expiresAt: Date.now() + 8 * 60 * 60 * 1000, // 8 h
    }
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
    return { ok: true, session }
  }
  return { ok: false, error: 'Credenciales incorrectas.' }
}

export function getSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const session = JSON.parse(raw)
    if (session.expiresAt < Date.now()) {
      sessionStorage.removeItem(SESSION_KEY)
      return null
    }
    return session
  } catch {
    return null
  }
}

export function isAuthenticated() {
  return getSession() !== null
}

export function signOut() {
  sessionStorage.removeItem(SESSION_KEY)
}
