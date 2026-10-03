import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Progress, StageProgress } from '../../../api/kbAdmin'
import { ago, elapsed, tokens, usd } from './format'

function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms)
    return () => window.clearInterval(id)
  }, [ms])
  return now
}

export function ProgressBar({ percent, className = '', indeterminate = false, tone = 'primary' }: {
  percent?: number | null
  className?: string
  indeterminate?: boolean
  tone?: 'primary' | 'danger' | 'done'
}) {
  const color = tone === 'danger' ? 'bg-red-500' : tone === 'done' ? 'bg-emerald-600 dark:bg-emerald-400' : 'bg-primary dark:bg-primary-300'
  return (
    <div
      className={`h-1.5 rounded-full bg-border dark:bg-night-border overflow-hidden ${className}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate || percent == null ? undefined : Math.round(percent)}
    >
      {indeterminate || percent == null ? (
        <div className="h-full w-1/3 rounded-full bg-primary/60 dark:bg-primary-300/60 kb-indeterminate" />
      ) : (
        <div className={`h-full rounded-full transition-[width] duration-500 ${color}`} style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
      )}
    </div>
  )
}

const STATUS_STYLE: Record<string, string> = {
  done: 'border-emerald-300 dark:border-emerald-800',
  running: 'border-accent bg-accent-50 dark:bg-accent-900/30',
  waiting_batch: 'border-accent bg-accent-50 dark:bg-accent-900/30',
  failed: 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40',
  skipped: 'border-dashed border-border dark:border-night-border opacity-60',
  pending: 'border-dashed border-border dark:border-night-border',
}

// Stepper + overall bar + current line / ETA / last activity / stall
// warning. Without `progress` (API without the endpoint yet) it falls back
// to the current stage, live tokens and cost and the elapsed time.
export default function ProgressPanel({ progress, stages, fallback }: {
  progress: Progress | null
  stages: string[]
  fallback: { stage: string | null | undefined; startedAt: string | null | undefined; tokensIn?: number | null; tokensOut?: number | null; costUsd?: number | null }
}) {
  const { t } = useTranslation()
  const now = useNow()
  const byStage = new Map((progress?.stages ?? []).map((s) => [s.stage.toUpperCase(), s]))
  const order = progress?.stages?.length ? progress.stages.map((s) => s.stage.toUpperCase()) : stages
  const currentIdx = fallback.stage ? order.indexOf(fallback.stage.toUpperCase()) : -1
  const waiting = progress?.stages?.find((s) => s.status === 'waiting_batch')

  const statusOf = (st: string, i: number): string => {
    const p = byStage.get(st)
    if (p) return String(p.status)
    if (currentIdx < 0) return 'pending'
    return i < currentIdx ? 'done' : i === currentIdx ? 'running' : 'pending'
  }

  return (
    <div className="flex flex-col gap-3">
      {progress?.stalled && (
        <p role="status" className="px-3 py-2 rounded-sm border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 font-body text-body-sm text-amber-800 dark:text-amber-200">
          {t('manage.wikiAi.progress.stalled', { ago: ago(progress.lastActivityAt, now, t) })}
        </p>
      )}

      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2 font-body text-body-sm">
          <span className="text-ink-primary dark:text-night-text">
            {progress?.current ?? (fallback.stage ? t('manage.wikiAi.progress.inStage', { stage: t(`manage.wikiAi.progress.stages.${fallback.stage.toUpperCase()}`, { defaultValue: fallback.stage }) }) : t('manage.wikiAi.progress.starting'))}
          </span>
          {progress?.overall && <span className="font-display font-bold text-h5 tabular-nums">{Math.round(progress.overall.percent)}%</span>}
        </div>
        <ProgressBar percent={progress?.overall?.percent} indeterminate={!progress?.overall} />
        <p className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[0.72rem] text-ink-secondary dark:text-night-muted">
          {waiting ? (
            <span>{batchText(waiting, t)}</span>
          ) : progress?.etaSec != null ? (
            <span>{t('manage.wikiAi.progress.eta', { min: Math.max(1, Math.round(progress.etaSec / 60)) })}</span>
          ) : null}
          {progress?.lastActivityAt && <span>{t('manage.wikiAi.progress.lastActivity', { ago: ago(progress.lastActivityAt, now, t) })}</span>}
          <span>{t('manage.wikiAi.progress.elapsed', { time: elapsed(fallback.startedAt, now) })}</span>
          {(fallback.tokensIn != null || fallback.tokensOut != null) && (
            <span>{tokens(fallback.tokensIn ?? 0)} → {tokens(fallback.tokensOut ?? 0)} tokens</span>
          )}
          {fallback.costUsd != null && <span>{usd(fallback.costUsd)}</span>}
        </p>
      </div>

      <ol className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2" aria-label={t('manage.wikiAi.runs.timeline')}>
        {order.map((st, i) => {
          const p = byStage.get(st)
          const status = statusOf(st, i)
          const pct = p && p.total ? ((p.done ?? 0) / p.total) * 100 : status === 'done' ? 100 : status === 'running' || status === 'waiting_batch' ? null : 0
          return (
            <li key={st} className={`flex flex-col gap-1 px-2.5 py-2 rounded-sm border ${STATUS_STYLE[status] ?? STATUS_STYLE.pending}`}>
              <span className="font-mono text-label uppercase tracking-widest truncate">{t(`manage.wikiAi.progress.stages.${st}`, { defaultValue: st })}</span>
              <span className="font-body text-[0.72rem] text-ink-secondary dark:text-night-muted">
                {t(`manage.wikiAi.progress.status.${status}`, { defaultValue: status })}
                {p?.total ? ` · ${p.done ?? 0}/${p.total}` : ''}
                {p?.failed ? ` · ${t('manage.wikiAi.progress.failedN', { n: p.failed })}` : ''}
              </span>
              <ProgressBar
                percent={pct}
                indeterminate={(status === 'running' || status === 'waiting_batch') && pct == null}
                tone={status === 'failed' ? 'danger' : status === 'done' ? 'done' : 'primary'}
              />
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function batchText(s: StageProgress, t: (k: string, o?: Record<string, unknown>) => string): string {
  const rc = s.batch?.requestCounts
  const st = (s.batch?.doStatus ?? '').toLowerCase()
  if (/in_progress|processing/.test(st) && rc?.total) return t('manage.wikiAi.progress.batchProcessing', { done: rc.completed ?? 0, total: rc.total })
  if (/queued|validating/.test(st) || !st) return t('manage.wikiAi.progress.batchQueued')
  return t('manage.wikiAi.progress.batchStatus', { status: s.batch?.doStatus })
}
