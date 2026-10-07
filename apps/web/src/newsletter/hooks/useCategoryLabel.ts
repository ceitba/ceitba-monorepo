import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

// Translated label for a category value. Unknown values (not in
// CATEGORIES) render as-is.
export function useCategoryLabel() {
  const { t } = useTranslation()
  return useCallback((category) => t(`categories.${category}`, { defaultValue: category ?? '' }), [t])
}
