import type { TFunction } from 'i18next'
import type { BenefitEntry } from '../api/content'

// Display name for a benefit category: the API-provided name in the current
// language wins (so categories created from /manage don't show a raw slug),
// then the static i18n entry, then the other language's API name, then the slug.
export function benefitCategoryName(
  slug: string,
  category: Pick<BenefitEntry, 'nameEs' | 'nameEn'> | undefined,
  lang: 'es' | 'en',
  t: TFunction,
): string {
  const primary = lang === 'en' ? category?.nameEn : category?.nameEs
  if (primary?.trim()) return primary
  const fallback = lang === 'en' ? category?.nameEs : category?.nameEn
  return t(`benefits.${slug}.name`, { defaultValue: fallback?.trim() || slug })
}
