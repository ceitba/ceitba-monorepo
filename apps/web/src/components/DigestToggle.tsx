import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchDigestSubscription, setDigestSubscription } from '../api/digestSubscription'

type State = 'loading' | 'ready' | 'saving' | 'loadError'

// "Recibir 'La semana en ITBA' por mail" row of the account menu. Loaded
// when the menu opens, toggled optimistically and rolled back if the PUT
// fails.
export default function DigestToggle() {
  const { t } = useTranslation()
  const [enabled, setEnabled] = useState<boolean | null>(null) // null until loaded
  const [state, setState] = useState<State>('loading')
  const [error, setError] = useState(false)

  useEffect(() => {
    let active = true
    fetchDigestSubscription()
      .then(({ enabled: value }) => { if (active) { setEnabled(Boolean(value)); setState('ready') } })
      .catch(() => { if (active) setState('loadError') })
    return () => { active = false }
  }, [])

  async function toggle() {
    if (state !== 'ready') return
    const previous = Boolean(enabled)
    setEnabled(!previous)
    setError(false)
    setState('saving')
    try {
      const res = await setDigestSubscription(!previous)
      setEnabled(Boolean(res?.enabled ?? !previous))
    } catch {
      setEnabled(previous)
      setError(true)
    } finally {
      setState('ready')
    }
  }

  if (state === 'loadError') return null

  const on = Boolean(enabled)
  return (
    <div className="px-3 py-2 border-b border-border dark:border-night-border">
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={on}
        onClick={toggle}
        disabled={state !== 'ready'}
        className="w-full flex items-center justify-between gap-3 text-left font-body text-body-sm text-ink-primary dark:text-night-text disabled:cursor-wait"
      >
        <span className="leading-snug">{t('digest.toggle')}</span>
        <span
          aria-hidden="true"
          className={[
            'relative inline-flex flex-shrink-0 w-9 h-5 rounded-full transition-colors duration-150',
            on ? 'bg-primary dark:bg-primary-400' : 'bg-border dark:bg-night-border',
            enabled === null ? 'opacity-50' : '',
          ].join(' ')}
        >
          <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-[#fff] shadow transition-transform duration-150 ${on ? 'translate-x-4' : ''}`} />
        </span>
      </button>
      <p className="mt-1 font-body text-label text-ink-secondary dark:text-night-muted">{t('digest.toggleHint')}</p>
      {error && (
        <p role="alert" className="mt-1 font-body text-label text-red-600">{t('digest.toggleError')}</p>
      )}
    </div>
  )
}
