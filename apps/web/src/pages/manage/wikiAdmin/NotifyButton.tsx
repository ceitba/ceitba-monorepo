import { useTranslation } from 'react-i18next'
import { setNotify, type JobKind } from './jobWatchStore'
import { useJobWatch } from './useJobWatch'

// "Avisarme cuando termine": opts in to a browser notification for this
// job. Permission is only requested here, on click — never automatically.
export default function NotifyButton({ kind, id }: { kind: JobKind; id: string }) {
  const { t } = useTranslation()
  const { jobs } = useJobWatch()
  const job = jobs.find((j) => j.kind === kind && j.id === id)
  const supported = typeof Notification !== 'undefined'
  const denied = supported && Notification.permission === 'denied'
  const on = !!job?.notify && supported && Notification.permission === 'granted'

  async function toggle() {
    if (on) { setNotify(kind, id, false); return }
    if (!supported) return
    let perm = Notification.permission
    if (perm === 'default') perm = await Notification.requestPermission()
    if (perm === 'granted') setNotify(kind, id, true)
  }

  if (!supported) return null
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={denied || !job}
      aria-pressed={on}
      title={denied ? t('manage.wikiAi.watch.denied') : undefined}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm border font-mono text-label uppercase tracking-widest disabled:opacity-50 ${
        on ? 'border-primary text-primary' : 'border-border dark:border-night-border hover:border-primary hover:text-primary'
      }`}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      {on ? t('manage.wikiAi.watch.notifyOn') : t('manage.wikiAi.watch.notify')}
    </button>
  )
}
