// Canonical article/event categories — the exact strings stored by the API
// and matched by its `?category=` filter (exact, case-sensitive). The API
// (NewsCategories) rejects anything else on create/update, and its V29
// migration rewrote older spellings ("ACADÉMICO", "academico") to these.
// Labels live in locales under `categories.<value>`; "all" means omitting
// the filter, never a magic value.
export const CATEGORIES = [
  'Académico',
  'Campus',
  'Cultura',
  'Deportes',
  'Tecnología',
  'Organizaciones',
  'General',
]

export const DEFAULT_CATEGORY = 'Académico'

export function isCanonicalCategory(value) {
  return CATEGORIES.includes(value)
}

// Options for a category <select>: the canonical list plus the current
// value if it is something else (a row the migration could not map), so
// editing shows it instead of silently replacing it; the form then asks
// for a canonical value before saving, since the API would reject it.
export function categoryOptions(current) {
  return current && !CATEGORIES.includes(current) ? [...CATEGORIES, current] : CATEGORIES
}
