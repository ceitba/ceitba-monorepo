import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePins } from '../../hooks/usePins'
import { togglePin, type PinInput } from '../../store/pinsStore'

// Pin toggle for a subject (optimistic through pinsStore; failures surface
// via PinNotice on the page).
export default function PinButton({ subject, size = 'sm', className = '' }: {
  subject: PinInput
  size?: 'sm' | 'md'
  className?: string
}) {
  const { t } = useTranslation()
  const { pins } = usePins()
  const [busy, setBusy] = useState(false)
  const pinned = !!pins?.some((p) => p.subjectId === subject.subjectId)
  const label = pinned ? t('apuntes.pins.unpin') : t('apuntes.pins.pin')
  const dim = size === 'md' ? 'w-10 h-10' : 'w-8 h-8'

  async function onClick(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (busy || pins == null) return
    setBusy(true)
    try {
      await togglePin(subject)
    } catch {
      /* rolled back by the store; PinNotice shows the error */
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pinned}
      aria-label={`${label}: ${subject.subjectName}`}
      title={label}
      disabled={pins == null}
      className={`${dim} flex-shrink-0 inline-flex items-center justify-center rounded-full transition-colors duration-150 disabled:opacity-40 ${
        pinned
          ? 'text-accent-600 dark:text-accent-300 bg-accent-50 dark:bg-accent-900/30 hover:bg-accent-100 dark:hover:bg-accent-900/50'
          : 'text-ink-secondary dark:text-night-muted hover:text-primary hover:bg-primary-50 dark:hover:bg-primary-900'
      } ${className}`}
    >
      <PinIcon filled={pinned} size={size === 'md' ? 18 : 16} />
    </button>
  )
}

export function PinIcon({ filled, size = 16 }: { filled?: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="17" x2="12" y2="22" />
      <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
    </svg>
  )
}
