import { apiRequest, BASE_URL } from '../api/client'
import { fetchMyFollows } from '../api/follows'

// Cookie-based session: the JWT lives in an HttpOnly cookie set by the API,
// invisible to JS. The only thing we cache here is the user profile fetched
// from /v1/auth/me — it lets components read role/orgs/follows synchronously
// after the first hydrate.

let _profile = null
let _hydrated = false      // true after the first /me round-trip, success or 401
let _hydratePromise = null // dedupe concurrent boot calls

export function startGoogleSignIn() {
  const redirectUri =
    import.meta.env.VITE_GOOGLE_REDIRECT_URI ??
    `${window.location.origin}/admin/callback`
  window.location.href = `${BASE_URL}/auth/google?redirect_uri=${encodeURIComponent(redirectUri)}`
}

// Loads the session profile from the API. Subsequent calls return the cache
// unless `force` is true. Returns null if the cookie is missing/expired.
export async function getSession({ force = false } = {}) {
  if (_hydrated && !force) return _profile
  if (_hydratePromise) return _hydratePromise
  _hydratePromise = (async () => {
    try {
      const res = await apiRequest('GET', '/auth/me')
      if (res.ok) _profile = await res.json()
      else _profile = null
    } catch {
      _profile = null
    } finally {
      _hydrated = true
      _hydratePromise = null
    }
    return _profile
  })()
  return _hydratePromise
}

// Synchronous — returns cached profile after first getSession() call.
export function getCachedSession() {
  return _profile
}

// Synchronous — true if we have a hydrated profile. Anything more accurate
// requires awaiting getSession() since the cookie itself is invisible to JS.
export function isAuthenticated() {
  return _profile != null
}

export function getOrganizations() {
  return _profile?.organizations ?? []
}

export function isOrgMember() {
  return getOrganizations().length > 0
}

export function isStaff() {
  return _profile?.role === 'staff'
}

export function isAdmin() {
  return ['staff', 'admin', 'editor'].includes(_profile?.role)
}

export function getFollows() {
  return _profile?.follows ?? []
}

export function isFollowing(slug) {
  return getFollows().includes(slug)
}

export async function refreshFollows() {
  if (!_profile) return getFollows()
  try {
    const list = await fetchMyFollows()
    _profile.follows = list.map((f) => f.orgSlug)
  } catch {
    /* keep cached follows on error */
  }
  return getFollows()
}

// Clears the API cookie + the in-memory cache. Always resolves; logout is
// best-effort because UX-wise the user expects "logged out" even if the
// network call fails.
export async function signOut() {
  try {
    await apiRequest('POST', '/auth/logout')
  } catch {
    /* ignore */
  }
  _profile = null
  _hydrated = true
}
