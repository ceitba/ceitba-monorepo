import { apiRequest, BASE_URL } from '../api/client'
import { fetchMyFollows } from '../api/follows'

const TOKEN_KEY = 'auth_token'
let _profile = null

export function startGoogleSignIn() {
  const redirectUri =
    import.meta.env.VITE_GOOGLE_REDIRECT_URI ??
    `${window.location.origin}/admin/callback`
  window.location.href = `${BASE_URL}/auth/google?redirect_uri=${encodeURIComponent(redirectUri)}`
}

export async function handleCallback() {
  const token = new URLSearchParams(window.location.search).get('token')
  if (!token) return false
  sessionStorage.setItem(TOKEN_KEY, token)
  return true
}

export async function getSession() {
  if (!sessionStorage.getItem(TOKEN_KEY)) { _profile = null; return null }
  if (_profile) return _profile
  try {
    const res = await apiRequest('GET', '/auth/me')
    if (!res || !res.ok) { sessionStorage.removeItem(TOKEN_KEY); _profile = null; return null }
    _profile = await res.json()
    return _profile
  } catch {
    return null
  }
}

// Synchronous — returns cached profile after first getSession() call
export function getCachedSession() {
  return _profile
}

export function isAuthenticated() {
  return Boolean(sessionStorage.getItem(TOKEN_KEY))
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

export function signOut() {
  sessionStorage.removeItem(TOKEN_KEY)
  _profile = null
}
