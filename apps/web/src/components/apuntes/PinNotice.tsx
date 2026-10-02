import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../../api/client'
import { PIN_LIMIT } from '../../api/pins'
import { usePins } from '../../hooks/usePins'
import { clearPinError } from '../../store/pinsStore'
import ErrorBanner from '../ErrorBanner'

// Floating notice for failed pin toggles (limit reached, network...).
export default function PinNotice() {
  const { t } = useTranslation()
  const { lastError } = usePins()
  useEffect(() => {
    if (!lastError) return
    const id = window.setTimeout(clearPinError, 8000)
    return () => window.clearTimeout(id)
  }, [lastError])
  if (!lastError) return null
  const message = lastError instanceof ApiError && lastError.code === 'BOOKMARK_LIMIT'
    ? t('apuntes.pins.limit', { limit: PIN_LIMIT })
    : t('apuntes.pins.failed')
  return (
    <div className="fixed bottom-4 inset-x-4 sm:inset-x-auto sm:right-6 sm:max-w-sm z-50 animate-slide-up shadow-card-hover">
      <ErrorBanner onDismiss={clearPinError}>{message}</ErrorBanner>
    </div>
  )
}
