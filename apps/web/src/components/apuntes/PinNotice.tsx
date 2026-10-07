import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../../api/client'
import { PIN_LIMIT } from '../../api/pins'
import { usePins } from '../../hooks/usePins'
import { clearPinError } from '../../store/pinsStore'
import { toast } from '../ui'

// Turns a failed pin toggle (limit reached, network...) into an error toast.
// Renders nothing; mount it once on pages with pin buttons.
export default function PinNotice() {
  const { t } = useTranslation()
  const { lastError } = usePins()
  useEffect(() => {
    if (!lastError) return
    toast.error(
      lastError instanceof ApiError && lastError.code === 'BOOKMARK_LIMIT'
        ? t('apuntes.pins.limit', { limit: PIN_LIMIT })
        : t('apuntes.pins.failed'),
    )
    clearPinError()
  }, [lastError, t])
  return null
}
