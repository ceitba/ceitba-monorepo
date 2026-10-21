import '../../../i18nApuntes'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchEval, fetchRun, finalTone, isActiveStatus, isBlockedStatus } from '../../../api/kbAdmin'
import { ApiError } from '../../../api/client'
import { activeJobs, dismissToast, drop, finish, requestOpen } from './jobWatchStore'
import { useJobWatch } from './useJobWatch'
import { statusLabel } from './status'
import { Button, CloseIcon, IconButton } from '@/components/ui'

// Left accent per outcome, same as the kit Toaster.
const BORDER = {
  success: 'border-l-emerald-500',
  warning: 'border-l-amber-500',
  error: 'border-l-red-500',
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
              const text = tone === 'error' ? t('manage.wikiAi.watch.evalFailed', { name, status: statusLabel(e.status, t) })
                : tone === 'warning' ? t('manage.wikiAi.watch.evalPartial', { name, status: statusLabel(e.status, t) })
                  : t('manage.wikiAi.watch.evalDone', { name, configs: e.configs?.length ?? 0, pages })
              finish('eval', j.id, e.status, `${pages}`, text, tone)
            }
          } else {
            const r = await fetchRun(j.id)
            if (!isActiveStatus(r.status)) {
              const tone = finalTone(r.status)
              const text = tone === 'error' ? t('manage.wikiAi.watch.runFailed', { status: statusLabel(r.status, t) })
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

  // Not a transient kit toast: each notice stays until dismissed and carries
  // a "Ver resultados" action. Styled like the kit Toaster, stacked above it.
  if (!toasts.length) return null
  return (
    <div className="fixed z-50 bottom-4 inset-x-4 sm:inset-x-auto sm:right-4 sm:w-96 flex flex-col gap-2" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.key}
          role={toast.tone === 'error' ? 'alert' : 'status'}
          className={`flex items-start gap-2 pl-4 pr-1 py-1 rounded-xs border border-border border-l-4 dark:border-night-border bg-white dark:bg-night-surface shadow-card animate-fade-in ${BORDER[toast.tone]}`}
        >
          <div className="flex-1 min-w-0 py-2.5">
            <p className="font-body text-body-sm text-ink-primary dark:text-night-text">{toast.text}</p>
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 -ml-3"
              onClick={() => { requestOpen(toast.kind, toast.id); dismissToast(toast.key); onOpen() }}
            >
              {t('manage.wikiAi.watch.view')}
            </Button>
          </div>
          <IconButton size="sm" onClick={() => dismissToast(toast.key)} aria-label={t('errors.dismiss')}>
            <CloseIcon size={16} />
          </IconButton>
        </div>
      ))}
    </div>
  )
}
