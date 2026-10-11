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
// session (revoked mid-session). A key is cleared when a later /me refresh
// lists it again, and all are cleared when the signed-in user changes.
const _denied = new Set<string>()

// Capabilities switched on for everyone (GET /capabilities), fetched when
// there's no session so anonymous visitors see those features too.
let _publicCapabilities: string[] = []

function notify() { _listeners.forEach((fn) => fn(_profile)) }

onCapabilityRequired((capability) => {
  // The only gated feature today is Apuntes; older API builds may omit the key.
  const key = capability ?? 'apuntes'
  if (_denied.has(key)) return
  _denied.add(key)
  notify()
})

export function hasCapability(profile: UserProfile | null, key: string): boolean {
  if (!profile) return _publicCapabilities.includes(key)
  if (_denied.has(key)) return false
  if (profile.role === 'staff') return true
  return profile.capabilities?.includes(key) ?? false
}

// Subscribe to profile changes (login, logout, refresh). Returns an unsubscribe.
export function subscribe(fn: (p: UserProfile | null) => void): () => void {
  _listeners.add(fn)
  return () => { _listeners.delete(fn) }
}

const RETURN_TO_KEY = 'auth.returnTo'

// OAuth callback routes: /auth/callback, plus the redirect URIs of the old
// standalone scheduler and newsletter apps (still routed, see App.tsx).
const CALLBACK_PATHS = ['/auth/', '/scheduler/auth/', '/newsletter/admin/callback']

// Only in-app paths are valid post-login destinations (no open redirects,
// no bouncing back into a callback).
export function isSafeReturnPath(path: unknown): path is string {
  return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//')
    && !path.startsWith('/\\') && !CALLBACK_PATHS.some((p) => path.startsWith(p))
}

// Pages whose unsaved work lives only in React state (the scheduler's
// workspace) register a callback that snapshots it. Every sign-in runs them
// before leaving for Google, including the navbar's, which renders outside
// those pages. Returns the unregister function (an effect's cleanup).
const _beforeSignIn = new Set<() => void>()

export function onBeforeSignIn(fn: () => void): () => void {
  _beforeSignIn.add(fn)
  return () => { _beforeSignIn.delete(fn) }
}

// `returnTo` is an in-app path (e.g. "/apuntes", "/scheduler/S?plan=...") to
// land on after the OAuth round-trip; AuthCallback reads it back with
// takeReturnTo().
export function startGoogleSignIn(returnTo?: string): void {
  for (const fn of _beforeSignIn) {
    try { fn() } catch (e) { console.error('auth: before sign-in', e) }
  }
  try {
    if (isSafeReturnPath(returnTo)) sessionStorage.setItem(RETURN_TO_KEY, returnTo)
    else sessionStorage.removeItem(RETURN_TO_KEY)
  } catch { /* storage blocked: land on home */ }
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
    return isSafeReturnPath(value) ? value : null
  } catch {
    return null
  }
}

// Same as takeReturnTo() without clearing it (e.g. for a "try again" link).
export function peekReturnTo(): string | null {
  try {
    const value = sessionStorage.getItem(RETURN_TO_KEY)
    return isSafeReturnPath(value) ? value : null
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
      // A fresh /me that lists a capability means it was granted (again).
      _profile?.capabilities?.forEach((key) => _denied.delete(key))
      if (!_profile) _publicCapabilities = await fetchPublicCapabilities()
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

async function fetchPublicCapabilities(): Promise<string[]> {
  try {
    const res = await apiRequest('GET', '/capabilities')
    if (!res.ok) return []
    return ((await res.json()) as { enabledForAll?: string[] }).enabledForAll ?? []
  } catch {
    return []
  }
}

export function getCachedSession(): UserProfile | null {
  return _profile
}

// True once the first /me round-trip finished, signed in or not.
export function isHydrated(): boolean {
  return _hydrated
}

// Updates fields of the cached profile after a change the API already
// accepted (e.g. the newsletter's org follows) and notifies subscribers.
export function patchCachedSession(patch: Partial<UserProfile>): void {
  if (!_profile) return
  // New object so subscribers comparing references re-render.
  _profile = { ..._profile, ...patch }
  notify()
}

export function isAuthenticated(): boolean {
  return _profile != null
}

export function isStaff(profile: UserProfile | null = _profile): boolean {
  return profile?.role === 'staff'
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
  _publicCapabilities = await fetchPublicCapabilities()
  notify()
}
