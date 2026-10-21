import type { AuthConfig } from '../../config/sections/auth';

/** AuthProperties.admits: case-insensitive, `@domain` suffix or exact email. */
export function admits(auth: AuthConfig, email: string | null | undefined): boolean {
  if (email == null) return false;
  const lower = email.toLowerCase();
  for (const d of auth.allowedDomains) if (lower.endsWith(`@${d.toLowerCase()}`)) return true;
  for (const e of auth.allowedEmails) if (lower === e.toLowerCase()) return true;
  return false;
}

/** ReviewLoginProperties.isReviewEmail (whether or not review login is enabled). */
export function isReviewEmail(auth: AuthConfig, candidate: string | null | undefined): boolean {
  const email = auth.reviewLogin.email;
  return email !== undefined && candidate != null && email.toLowerCase() === candidate.trim().toLowerCase();
}

/**
 * SessionAllowlist.admits: who may USE a session (JWT, refresh token, API key):
 * the allowlist plus the review account while review login is enabled.
 * Google sign-in checks `admits` directly.
 */
export function sessionAdmits(auth: AuthConfig, email: string | null | undefined): boolean {
  if (email == null) return false;
  return admits(auth, email) || (auth.reviewLogin.status === 'ENABLED' && isReviewEmail(auth, email));
}
