import i18n from 'i18next'
import { apiRequest, BASE_URL } from '../api/client'
import { fetchMyFollows } from '../api/follows'

// Cookie-based session: the JWT lives in an HttpOnly cookie set by the API,
// invisible to JS. The only thing we cache here is the user profile fetched
// from /v1/auth/me — it lets components read role/orgs/follows synchronously
// after the first hydrate. Components subscribe() to re-render on
// sign-in/sign-out/follow changes (see hooks/useAuthSession).
//
// Server prefs (theme/language) are applied via the inline applyServerPrefs
// below rather than imported from prefsStore to avoid a circular import
// (authStore ↔ prefsStore) that Rollup minifies into a TDZ crash on click
// events. prefsStore can still import from us; we don't import from it.
// For the same reason we import the i18next singleton directly instead of
// ../i18n (which imports prefsStore).

function applyServerPrefs(profile) {
  if (!profile) return
  try {
    if (profile.theme === 'light' || profile.theme === 'dark') {
      localStorage.setItem('prefs.theme', profile.theme)
      document.documentElement.classList.toggle('dark', profile.theme === 'dark')
    }
    if (profile.language === 'es' || profile.language === 'en') {
      localStorage.setItem('prefs.lang', profile.language)
    }
  } catch { /* storage unavailable */ }
  if ((profile.language === 'es' || profile.language === 'en') && i18n.language !== profile.language) {
    i18n.changeLanguage(profile.language)
  }
}

let _profile = null
let _hydrated = false      // true after the first /me round-trip, success or 401
let _hydratePromise = null // dedupe concurrent boot calls
const _listeners = new Set()

function notify() { _listeners.forEach((fn) => fn(_profile)) }

// Subscribe to profile changes (login, logout, refresh). Returns an unsubscribe.
export function subscribe(fn) {
  _listeners.add(fn)
  return () => { _listeners.delete(fn) }
}

// ── Sign-in redirect ────────────────────────────────────────────────────────

const RETURN_KEY = 'auth.returnTo'

// Router-relative path (e.g. "/articles/abc") to come back to after the
// Google round-trip. Only same-app absolute paths are accepted.
function isSafeReturnPath(path) {
  return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//')
    && !path.startsWith('/admin/callback') && !path.startsWith('/admin/login')
}

// `returnTo` is where the callback page sends the user afterwards. Omit it
// (admin login page without a guarded destination) to land on the default
// for the user's role.
export function startGoogleSignIn({ returnTo } = {}) {
  try {
    if (isSafeReturnPath(returnTo)) sessionStorage.setItem(RETURN_KEY, returnTo)
    else sessionStorage.removeItem(RETURN_KEY)
  } catch { /* storage unavailable — fall back to the role default */ }
  const redirectUri =
    import.meta.env.VITE_GOOGLE_REDIRECT_URI ??
    `${window.location.origin}${import.meta.env.BASE_URL}admin/callback`
  window.location.href = `${BASE_URL}/auth/google?redirect_uri=${encodeURIComponent(redirectUri)}`
}

// Reads and clears the saved return path. Returns null when none was saved.
export function takeReturnPath() {
  try {
    const path = sessionStorage.getItem(RETURN_KEY)
    sessionStorage.removeItem(RETURN_KEY)
    return isSafeReturnPath(path) ? path : null
  } catch {
    return null
  }
}

// Peek without clearing (used to build "try again" links).
export function peekReturnPath() {
  try {
    const path = sessionStorage.getItem(RETURN_KEY)
    return isSafeReturnPath(path) ? path : null
  } catch {
    return null
  }
}

// ── Session ─────────────────────────────────────────────────────────────────

// Loads the session profile from the API. Subsequent calls return the cache
// unless `force` is true. Returns null if the cookie is missing/expired.
export async function getSession({ force = false } = {}) {
  if (_hydrated && !force) return _profile
  if (_hydratePromise) return _hydratePromise
  _hydratePromise = (async () => {
    try {
      const res = await apiRequest('GET', '/auth/me')
      if (res.ok) {
        _profile = await res.json()
        // Server is canonical for theme/language once the user is signed in;
        // overwrite the localStorage cache so all CEITBA SPAs paint the same.
        applyServerPrefs(_profile)
      } else {
        _profile = null
      }
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

// Synchronous — returns cached profile after first getSession() call.
export function getCachedSession() {
  return _profile
}

export function isHydrated() {
  return _hydrated
}

// Synchronous — true if we have a hydrated profile. Anything more accurate
// requires awaiting getSession() since the cookie itself is invisible to JS.
export function isAuthenticated() {
  return _profile != null
}

// ── Roles ───────────────────────────────────────────────────────────────────
// /auth/me returns role 'staff' | 'user' plus org memberships. Every helper
// takes an optional profile so React code can pass the one from
// useAuthSession(); without it they read the cached session.

export function getOrganizations(profile = _profile) {
  return profile?.organizations ?? []
}

export function isOrgMember(profile = _profile) {
  return getOrganizations(profile).length > 0
}

// Feature gates (API docs/CAPABILITIES.md): /auth/me lists the effective keys.
export function hasCapability(key, profile = _profile) {
  return Array.isArray(profile?.capabilities) && profile.capabilities.includes(key)
}

export function isStaff(profile = _profile) {
  return profile?.role === 'staff'
}

// Membership role 'admin' (set by staff from the CEITBA dashboard), as
// opposed to a plain 'member'.
export function isOrgAdmin(slug, profile = _profile) {
  return getOrganizations(profile).some((m) => m.slug === slug && m.role === 'admin')
}

// The followers list exposes names and emails: the API only serves it to
// staff and to that org's admins, so plain members don't get the link.
export function canViewFollowers(slug, profile = _profile) {
  return isStaff(profile) || isOrgAdmin(slug, profile)
}

// Who may enter /admin: anyone signed in. Staff and organization members
// manage their org's content; everyone else writes independent articles
// (no organization) that staff review before publishing.
export function canAccessAdmin(profile = _profile) {
  return profile != null
}

// Staff and org members publish directly; independent authors submit.
export function canManageOrganizations(profile = _profile) {
  return isStaff(profile) || isOrgMember(profile)
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
    // New object so subscribers comparing references re-render.
    _profile = { ..._profile, follows: list.map((f) => f.orgSlug) }
    notify()
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
  notify()
}
