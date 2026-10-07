import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

// Translated label for a category value. Unknown values (not in
// CATEGORIES) render as-is.
export function useCategoryLabel(): (category: string | null | undefined) => string {
  const { t } = useTranslation()
  return useCallback((category: string | null | undefined) => t(`categories.${category}`, { defaultValue: category ?? '' }), [t])
}
