import { useTranslation } from 'react-i18next'

// Inline error shown by ViewBoundary when a sub-view crashes.
export default function ViewBoundaryFallback({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <div role="alert" className="flex flex-col gap-2 px-4 py-4 rounded-card border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 font-body text-body-sm text-red-700 dark:text-red-300">
      <p className="font-semibold">{t('manage.wikiAi.crashed')}</p>
      <code className="font-mono text-[0.75rem] break-words opacity-80">{error.message}</code>
      <button type="button" onClick={onRetry} className="self-start font-mono text-label uppercase tracking-widest underline">{t('errors.retry')}</button>
    </div>
  )
}
