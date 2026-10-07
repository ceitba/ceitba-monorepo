import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

// Shown by edit forms when the record can't be loaded. The form itself is
// not rendered, so an empty form can never be saved over the real record.
export default function LoadErrorState({ notFound, backTo, backLabel, onRetry }) {
  const { t } = useTranslation()
  return (
    <div role="alert" className="flex flex-col items-center justify-center py-32 gap-4 text-center">
      <p className="font-display text-h5 font-bold text-ink-primary">
        {notFound ? t('admin.form.notFoundTitle') : t('admin.form.loadErrorTitle')}
      </p>
      <p className="font-body text-body-sm text-ink-secondary max-w-sm">
        {notFound ? t('admin.form.notFoundMessage') : t('admin.form.loadErrorMessage')}
      </p>
      <div className="flex gap-3">
        {!notFound && (
          <button
            type="button"
            onClick={onRetry}
            className="min-h-[44px] px-5 bg-primary text-surface font-body font-semibold rounded-sm hover:bg-primary-600 transition-colors duration-150 focus-visible:rounded"
          >
            {t('admin.common.retry')}
          </button>
        )}
        <Link
          to={backTo}
          className="min-h-[44px] px-5 inline-flex items-center bg-white border border-border text-ink-secondary font-body font-semibold rounded-sm hover:border-primary hover:text-primary transition-colors duration-150 focus-visible:rounded"
        >
          {backLabel}
        </Link>
      </div>
    </div>
  )
}
