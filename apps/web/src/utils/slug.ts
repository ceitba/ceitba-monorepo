// Organization slugs: the API's primary key and the newsletter URL segment
// (/newsletter/organizations/<slug>). Mirrors CEITBA-API's OrganizationRequest
// validation: lowercase letters/digits in hyphen-separated groups, 2–40 chars.
export const SLUG_MIN = 2
export const SLUG_MAX = 40
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

export function isValidSlug(slug: string): boolean {
  return slug.length >= SLUG_MIN && slug.length <= SLUG_MAX && SLUG_PATTERN.test(slug)
}

// "Club de Robótica  ITBA!" → "club-de-robotica-itba". Accents are stripped
// (ñ → n), anything else that isn't a-z/0-9 becomes a single hyphen, and the
// result is trimmed of hyphens and capped at SLUG_MAX without a trailing one.
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/, '')
}
