import '../../../i18nApuntes'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchEval, fetchRun, isActiveStatus } from '../../../api/kbAdmin'
import { activeJobs, dismissToast, finish, requestOpen } from './jobWatchStore'
import { useJobWatch } from './useJobWatch'

// Polls watched jobs (15 s visible, 60 s hidden) and shows a toast when
// one finishes, wherever the admin is in /manage. Lazy-loaded by
// ManagePage only while something is watched or a toast is pending.
export default function JobWatcher({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation()
  const { toasts } = useJobWatch()

  useEffect(() => {
    let cancelled = false
    let timer = 0
    const tick = async () => {
      for (const j of activeJobs()) {
        try {
          if (j.kind === 'eval') {
            const e = await fetchEval(j.id)
            if (!isActiveStatus(e.status)) {
              const pages = (e.configs ?? []).reduce((a, c) => a + (c.metrics?.pagesWritten ?? 0), 0)
              const failed = /FAIL|CANCEL/i.test(e.status)
              const text = failed
                ? t('manage.wikiAi.watch.evalFailed', { name: e.setName ?? j.name, status: e.status })
                : t('manage.wikiAi.watch.evalDone', { name: e.setName ?? j.name, configs: e.configs?.length ?? 0, pages })
              finish('eval', j.id, e.status, `${pages}`, text, failed)
            }
          } else {
            const r = await fetchRun(j.id)
            if (!isActiveStatus(r.status)) {
              const failed = /FAIL|CANCEL/i.test(r.status)
              const text = failed
                ? t('manage.wikiAi.watch.runFailed', { status: r.status })
                : t('manage.wikiAi.watch.runDone', { subjects: r.subjects?.length ?? 0 })
              finish('run', j.id, r.status, '', text, failed)
            }
          }
        } catch { /* try again next tick */ }
        if (cancelled) return
      }
      if (!cancelled) timer = window.setTimeout(tick, document.visibilityState === 'hidden' ? 60000 : 15000)
    }
    timer = window.setTimeout(tick, 2000)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [t])

  if (!toasts.length) return null
  return (
    <div className="fixed bottom-4 right-4 left-4 sm:left-auto sm:w-96 z-50 flex flex-col gap-2" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.key}
          role="status"
          className={`flex items-start gap-3 px-4 py-3 rounded-card border shadow-card-hover bg-white dark:bg-night-surface font-body text-body-sm animate-slide-up ${
            toast.failed ? 'border-red-300 dark:border-red-800' : 'border-emerald-300 dark:border-emerald-800'
          }`}
        >
          <span aria-hidden="true" className={toast.failed ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}>{toast.failed ? '✕' : '✓'}</span>
          <div className="flex-1 min-w-0">
            <p className="text-ink-primary dark:text-night-text">{toast.text}</p>
            <button
              type="button"
              onClick={() => { requestOpen(toast.kind, toast.id); dismissToast(toast.key); onOpen() }}
              className="mt-1 font-mono text-label uppercase tracking-widest text-primary hover:underline"
            >
              {t('manage.wikiAi.watch.view')} →
            </button>
          </div>
          <button type="button" onClick={() => dismissToast(toast.key)} aria-label={t('errors.dismiss')} className="leading-none text-h5 opacity-60 hover:opacity-100">×</button>
        </div>
      ))}
    </div>
  )
}
