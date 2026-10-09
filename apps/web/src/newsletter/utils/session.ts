import {
  getCachedSession,
  hasCapability as hasCapabilityFor,
  isStaff,
  patchCachedSession,
  startGoogleSignIn as startSharedSignIn,
  type UserMembership,
  type UserProfile,
} from '@/store/authStore'
import { fetchMyFollows } from '../api/follows'
import { MINE_PATH } from '../paths'

// Newsletter helpers over the app-wide session store (@/store/authStore):
// organization roles and follows. Read the session itself from there (or
// useAuth in components).

// `returnTo` is an app path (e.g. location.pathname, or
// newsletterPath('/contribute')); without one the user lands on Mis
// publicaciones, which every signed-in user may enter.
export function startGoogleSignIn({ returnTo }: { returnTo?: string } = {}): void {
  startSharedSignIn(returnTo ?? MINE_PATH)
}

// Feature gates (API docs/CAPABILITIES.md): /auth/me lists the effective keys.
export function hasCapability(key: string, profile: UserProfile | null = getCachedSession()): boolean {
  return hasCapabilityFor(profile, key)
}

// ── Roles ───────────────────────────────────────────────────────────────────
// /auth/me returns role 'staff' | 'user' plus org memberships. Every helper
// takes an optional profile so React code can pass the one from
// useAuth(); without it they read the cached session.

export function getOrganizations(profile: UserProfile | null = getCachedSession()): UserMembership[] {
  return profile?.organizations ?? []
}

// The organization new articles by staff default to when they don't belong
// to one (the student center writes as itself).
export const STAFF_DEFAULT_ORG = 'ceitba'

// Organizations whose drafts show in the user's Mis publicaciones: the ones
// they belong to, plus the staff default (the API lists any org's drafts to
// staff).
export function writerOrgSlugs(profile: UserProfile | null = getCachedSession()): string[] {
  const slugs = getOrganizations(profile).map((m) => m.slug)
  return isStaff(profile) && !slugs.includes(STAFF_DEFAULT_ORG) ? [...slugs, STAFF_DEFAULT_ORG] : slugs
}

// Membership role 'admin' (set by staff from the CEITBA dashboard), as
// opposed to a plain 'member'.
export function isOrgAdmin(slug: string, profile: UserProfile | null = getCachedSession()): boolean {
  return getOrganizations(profile).some((m) => m.slug === slug && m.role === 'admin')
}

// The followers list exposes names and emails: the API only serves it to
// staff and to that org's admins, so plain members don't get the link.
export function canViewFollowers(slug: string, profile: UserProfile | null = getCachedSession()): boolean {
  return isStaff(profile) || isOrgAdmin(slug, profile)
}

// ── Follows ─────────────────────────────────────────────────────────────────

export function getFollows(): string[] {
  return getCachedSession()?.follows ?? []
}

export function isFollowing(slug: string): boolean {
  return getFollows().includes(slug)
}

export async function refreshFollows(): Promise<string[]> {
  if (!getCachedSession()) return getFollows()
  try {
    const list = await fetchMyFollows()
    patchCachedSession({ follows: list.map((f) => f.orgSlug) })
  } catch {
    /* keep cached follows on error */
  }
  return getFollows()
}
