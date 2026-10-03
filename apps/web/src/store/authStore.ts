import { apiRequest, BASE_URL, onCapabilityRequired } from '../api/client'

export interface UserMembership {
  slug: string
  role: string
}

export interface UserProfile {
  id: string
  name: string | null
  email: string
  role: 'staff' | 'user' | string
  avatarUrl: string | null
  theme: 'light' | 'dark' | null
  language: 'es' | 'en' | null
  careerId: string | null
  plan: string | null
  fileNumber: number | null
  organizations: UserMembership[]
  follows: string[]
  // Feature flags granted to this user (GET /auth/me), e.g. ["apuntes"].
  // STAFF users always have every capability.
  capabilities?: string[]
}

let _profile: UserProfile | null = null
let _hydrated = false
let _hydratePromise: Promise<UserProfile | null> | null = null
const _listeners = new Set<(p: UserProfile | null) => void>()

// Capabilities the API refused with 403 CAPABILITY_REQUIRED during this
// session, even if /me still lists them (revoked mid-session). Cleared when
// the signed-in user changes.
const _denied = new Set<string>()

function notify() { _listeners.forEach((fn) => fn(_profile)) }

onCapabilityRequired((capability) => {
  // The only gated feature today is Apuntes; older API builds may omit the key.
  const key = capability ?? 'apuntes'
  if (_denied.has(key)) return
  _denied.add(key)
  notify()
})

export function hasCapability(profile: UserProfile | null, key: string): boolean {
  if (!profile || _denied.has(key)) return false
  if (profile.role === 'staff') return true
  return profile.capabilities?.includes(key) ?? false
}

// Subscribe to profile changes (login, logout, refresh). Returns an unsubscribe.
export function subscribe(fn: (p: UserProfile | null) => void): () => void {
  _listeners.add(fn)
  return () => { _listeners.delete(fn) }
}

const RETURN_TO_KEY = 'auth.returnTo'

// `returnTo` is an in-app path (e.g. "/apuntes") to land on after the OAuth
// round-trip; AuthCallback reads it back with takeReturnTo().
export function startGoogleSignIn(returnTo?: string): void {
  if (returnTo) {
    try { sessionStorage.setItem(RETURN_TO_KEY, returnTo) } catch { /* storage blocked */ }
  }
  const redirectUri =
    (import.meta.env.VITE_GOOGLE_REDIRECT_URI as string | undefined) ??
    `${window.location.origin}${window.location.pathname}`
  window.location.href =
    `${BASE_URL}/auth/google?redirect_uri=${encodeURIComponent(redirectUri)}`
}

export function takeReturnTo(): string | null {
  try {
    const value = sessionStorage.getItem(RETURN_TO_KEY)
    sessionStorage.removeItem(RETURN_TO_KEY)
    return value
  } catch {
    return null
  }
}

export async function getSession(opts: { force?: boolean } = {}): Promise<UserProfile | null> {
  if (_hydrated && !opts.force) return _profile
  if (_hydratePromise) return _hydratePromise
  _hydratePromise = (async () => {
    try {
      const res = await apiRequest('GET', '/auth/me')
      const prevId = _profile?.id
      _profile = res.ok ? ((await res.json()) as UserProfile) : null
      if (_profile?.id !== prevId) _denied.clear()
    } catch {
      _profile = null
    } finally {
      _hydrated = true
      _hydratePromise = null
      notify()
    }
    return _profile
  })()
  return _hydratePromise
}

export function getCachedSession(): UserProfile | null {
  return _profile
}

export function isAuthenticated(): boolean {
  return _profile != null
}

export function isStaff(): boolean {
  return _profile?.role === 'staff'
}

export async function signOut(): Promise<void> {
  try {
    await apiRequest('POST', '/auth/logout')
  } catch {
    /* ignore */
  }
  _profile = null
  _hydrated = true
  _denied.clear()
  notify()
}
