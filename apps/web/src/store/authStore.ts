import { apiRequest, BASE_URL } from '../api/client'

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
}

let _profile: UserProfile | null = null
let _hydrated = false
let _hydratePromise: Promise<UserProfile | null> | null = null
const _listeners = new Set<(p: UserProfile | null) => void>()

function notify() { _listeners.forEach((fn) => fn(_profile)) }

// Subscribe to profile changes (login, logout, refresh). Returns an unsubscribe.
export function subscribe(fn: (p: UserProfile | null) => void): () => void {
  _listeners.add(fn)
  return () => { _listeners.delete(fn) }
}

export function startGoogleSignIn(): void {
  const redirectUri =
    (import.meta.env.VITE_GOOGLE_REDIRECT_URI as string | undefined) ??
    `${window.location.origin}${window.location.pathname}`
  window.location.href =
    `${BASE_URL}/auth/google?redirect_uri=${encodeURIComponent(redirectUri)}`
}

export async function getSession(opts: { force?: boolean } = {}): Promise<UserProfile | null> {
  if (_hydrated && !opts.force) return _profile
  if (_hydratePromise) return _hydratePromise
  _hydratePromise = (async () => {
    try {
      const res = await apiRequest('GET', '/auth/me')
      _profile = res.ok ? ((await res.json()) as UserProfile) : null
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
  notify()
}
