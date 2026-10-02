// Canonical article/event categories — the exact strings stored by the API
// and matched by its `?category=` filter (exact, case-sensitive). Labels
// live in locales under `categories.<value>`; "all" means omitting the
// filter, never a magic value.
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

function fold(value) {
  return String(value).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

const BY_FOLDED = new Map(CATEGORIES.map((c) => [fold(c), c]))

// Maps legacy spellings ("ACADÉMICO", "academico") to the canonical value.
// Unknown values are returned unchanged so nothing is silently rewritten.
export function normalizeCategory(value) {
  if (value == null || value === '') return value
  return BY_FOLDED.get(fold(value)) ?? value
}

// Options for a category <select>: the canonical list plus the current
// value if it is something else, so editing never drops it silently.
export function categoryOptions(current) {
  return current && !CATEGORIES.includes(current) ? [...CATEGORIES, current] : CATEGORIES
}
