import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { IconButton, buttonClass } from '../ui'

// Zoom toolbar shared by the wiki graph and the correlatividades map:
// − / + icon buttons (44px on touch), an optional control between them
// (e.g. a range slider), then short text buttons for "fit" and "reset".
export default function ZoomControls({
  onZoomIn,
  onZoomOut,
  onFit,
  onReset,
  between,
  className = '',
}: {
  onZoomIn: () => void
  onZoomOut: () => void
  onFit?: () => void
  onReset?: () => void
  between?: ReactNode
  className?: string
}) {
  const { t } = useTranslation()
  const text = buttonClass({ variant: 'ghost', size: 'sm', className: 'px-2!' })
  return (
    <div
      role="group"
      aria-label={t('wiki.graphUi.zoomAria')}
      className={`flex flex-wrap items-center gap-1 p-1 rounded-xs border border-border dark:border-night-border bg-white/95 dark:bg-night-surface/95 ${className}`}
    >
      <IconButton size="sm" onClick={onZoomOut} aria-label={t('wiki.graphUi.zoomOut')}><MinusIcon /></IconButton>
      {between}
      <IconButton size="sm" onClick={onZoomIn} aria-label={t('wiki.graphUi.zoomIn')}><PlusIcon /></IconButton>
      {onFit && (
        <button type="button" onClick={onFit} aria-label={t('wiki.graphUi.fit')} className={text}>
          {t('wiki.graphUi.fitShort')}
        </button>
      )}
      {onReset && (
        <button type="button" onClick={onReset} aria-label={t('wiki.graphUi.reset')} className={text}>
          {t('wiki.graphUi.resetShort')}
        </button>
      )}
    </div>
  )
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function MinusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}
