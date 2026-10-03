import '../../../i18nApuntes'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchEval, fetchRun, finalTone, isActiveStatus, isBlockedStatus } from '../../../api/kbAdmin'
import { ApiError } from '../../../api/client'
import { activeJobs, dismissToast, drop, finish, requestOpen } from './jobWatchStore'
import { useJobWatch } from './useJobWatch'

const TONE = {
  success: { border: 'border-emerald-300 dark:border-emerald-800', icon: 'text-emerald-600 dark:text-emerald-400', glyph: '✓' },
  warning: { border: 'border-amber-300 dark:border-amber-800', icon: 'text-amber-600 dark:text-amber-400', glyph: '!' },
  error: { border: 'border-red-300 dark:border-red-800', icon: 'text-red-600 dark:text-red-400', glyph: '✕' },
} as const

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
              const tone = finalTone(e.status)
              const name = e.setName ?? j.name
              const text = tone === 'error' ? t('manage.wikiAi.watch.evalFailed', { name, status: e.status })
                : tone === 'warning' ? t('manage.wikiAi.watch.evalPartial', { name, status: e.status })
                  : t('manage.wikiAi.watch.evalDone', { name, configs: e.configs?.length ?? 0, pages })
              finish('eval', j.id, e.status, `${pages}`, text, tone)
            }
          } else {
            const r = await fetchRun(j.id)
            if (!isActiveStatus(r.status)) {
              const tone = finalTone(r.status)
              const text = tone === 'error' ? t('manage.wikiAi.watch.runFailed', { status: r.status })
                : isBlockedStatus(r.status) ? t('manage.wikiAi.watch.runBlocked')
                  : tone === 'warning' ? t('manage.wikiAi.watch.runPartial', { subjects: r.subjects?.length ?? 0 })
                    : t('manage.wikiAi.watch.runDone', { subjects: r.subjects?.length ?? 0 })
              finish('run', j.id, r.status, '', text, tone)
            }
          }
        } catch (err) {
          // Gone (deleted, or another environment's id): stop watching it.
          // Anything else: try again next tick.
          if (err instanceof ApiError && err.status === 404) drop(j.kind, j.id)
        }
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
            TONE[toast.tone].border
          }`}
        >
          <span aria-hidden="true" className={TONE[toast.tone].icon}>{TONE[toast.tone].glyph}</span>
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
