import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchDigestSubscription, setDigestSubscription } from '../api/digestSubscription'
import { Switch } from './ui'

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

  return (
    <div className="px-3 py-1 border-b border-border dark:border-night-border">
      <Switch
        role="menuitemcheckbox"
        checked={Boolean(enabled)}
        onChange={() => void toggle()}
        disabled={state !== 'ready'}
        label={t('digest.toggle')}
        hint={t('digest.toggleHint')}
      />
      {error && (
        <p role="alert" className="mt-1 font-body text-label text-red-600 dark:text-red-400">{t('digest.toggleError')}</p>
      )}
    </div>
  )
}
