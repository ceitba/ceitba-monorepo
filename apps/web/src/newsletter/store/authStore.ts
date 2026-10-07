import {
  getCachedSession,
  hasCapability as hasCapabilityFor,
  isStaff,
  patchCachedSession,
  startGoogleSignIn as startSharedSignIn,
} from '@/store/authStore'
import { fetchMyFollows } from '../api/follows'
import { newsletterPath } from '../paths'

// The session itself is the app-wide store (@/store/authStore). This module
// adds the newsletter's organization roles and follows on top of it.
export {
  getCachedSession,
  getSession,
  isAuthenticated,
  isHydrated,
  isStaff,
  signOut,
  subscribe,
} from '@/store/authStore'

// `returnTo` is an app path (e.g. location.pathname, or
// newsletterPath('/contribute')); without one the user lands on the admin
// area, which every signed-in user may enter.
export function startGoogleSignIn({ returnTo } = {}) {
  startSharedSignIn(returnTo ?? newsletterPath('/admin'))
}

// Feature gates (API docs/CAPABILITIES.md): /auth/me lists the effective keys.
export function hasCapability(key, profile = getCachedSession()) {
  return hasCapabilityFor(profile, key)
}

// ── Roles ───────────────────────────────────────────────────────────────────
// /auth/me returns role 'staff' | 'user' plus org memberships. Every helper
// takes an optional profile so React code can pass the one from
// useAuthSession(); without it they read the cached session.

export function getOrganizations(profile = getCachedSession()) {
  return profile?.organizations ?? []
}

export function isOrgMember(profile = getCachedSession()) {
  return getOrganizations(profile).length > 0
}

// Membership role 'admin' (set by staff from the CEITBA dashboard), as
// opposed to a plain 'member'.
export function isOrgAdmin(slug, profile = getCachedSession()) {
  return getOrganizations(profile).some((m) => m.slug === slug && m.role === 'admin')
}

// The followers list exposes names and emails: the API only serves it to
// staff and to that org's admins, so plain members don't get the link.
export function canViewFollowers(slug, profile = getCachedSession()) {
  return isStaff(profile) || isOrgAdmin(slug, profile)
}

// Who may enter /admin: anyone signed in. Staff and organization members
// manage their org's content; everyone else writes independent articles
// (no organization) that staff review before publishing.
export function canAccessAdmin(profile = getCachedSession()) {
  return profile != null
}

// Staff and org members publish directly; independent authors submit.
export function canManageOrganizations(profile = getCachedSession()) {
  return isStaff(profile) || isOrgMember(profile)
}

// ── Follows ─────────────────────────────────────────────────────────────────

export function getFollows() {
  return getCachedSession()?.follows ?? []
}

export function isFollowing(slug) {
  return getFollows().includes(slug)
}

export async function refreshFollows() {
  if (!getCachedSession()) return getFollows()
  try {
    const list = await fetchMyFollows()
    patchCachedSession({ follows: list.map((f) => f.orgSlug) })
  } catch {
    /* keep cached follows on error */
  }
  return getFollows()
}
