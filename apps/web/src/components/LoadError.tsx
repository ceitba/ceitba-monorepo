import { useTranslation } from 'react-i18next'

// Error state for public content sections: tells the visitor the content
// failed to load (rather than pretending there is none) and offers a retry.
export default function LoadError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 py-12 px-6 rounded-card border border-dashed border-border dark:border-night-border text-center"
    >
      <div className="w-10 h-10 rounded-full bg-red-50 dark:bg-red-950/40 flex items-center justify-center text-red-600 dark:text-red-300" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" strokeWidth="2.5" />
        </svg>
      </div>
      <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">
        {t('errors.somethingWrong')}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="min-h-[36px] px-3 font-mono text-label uppercase tracking-widest text-primary border border-primary rounded-sm hover:bg-primary hover:text-white transition-colors duration-150"
      >
        {t('errors.retry')}
      </button>
    </div>
  )
}
