import { useTranslation } from 'react-i18next'
import { ErrorState } from '@/components/ui'

// Inline error shown by ViewBoundary when a sub-view crashes (the error
// itself is logged by the boundary, never shown).
export default function ViewBoundaryFallback({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation()
  return <ErrorState title={t('errors.somethingWrong')} message={t('manage.wikiAi.crashed')} onRetry={onRetry} />
}
