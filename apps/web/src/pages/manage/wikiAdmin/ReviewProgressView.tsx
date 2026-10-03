import { useTranslation } from 'react-i18next'
import type { ReviewProgress } from '../../../api/kbAdmin'
import { ProgressBar } from './ProgressPanel'

// "configKey" (plan@effort|write@effort) → "plan (effort) → write".
export function prettyConfig(key: string, plan?: string, write?: string): string {
  if (plan && write) return `${plan} → ${write}`
  const [p, w] = key.split('|')
  const fmt = (s?: string) => (s ? s.replace(/@(\w+)$/, ' ($1)') : '?')
  return w ? `${fmt(p)} → ${fmt(w)}` : key
}

// One-line summary: "Revisión: 12/30 páginas · resultado todavía no confiable".
export function ReviewSummaryLine({ summary, className = '' }: { summary: ReviewProgress | null | undefined; className?: string }) {
  const { t } = useTranslation()
  if (!summary || !summary.totalPairs) return null
  const reviewed = summary.reviewedByAnyone ?? summary.reviewedByMe ?? 0
  return (
    <p className={`font-body text-body-sm ${summary.confident ? 'text-emerald-700 dark:text-emerald-300' : 'text-ink-secondary dark:text-night-muted'} ${className}`}>
      {t('manage.wikiAi.reviewProgress.summary', { done: reviewed, total: summary.totalPairs })}
      {' · '}
      {summary.confident ? t('manage.wikiAi.reviewProgress.confident') : t('manage.wikiAi.reviewProgress.notConfident')}
    </p>
  )
}

// Header for the blind review screen: my progress, per-subject chips and
// a confidence meter per configuration.
export default function ReviewProgressHeader({ progress, fallback }: {
  progress: ReviewProgress | null
  // From review/next when the progress endpoint is missing.
  fallback?: { reviewedByMe?: number; totalPairs?: number; remaining?: number } | null
}) {
  const { t } = useTranslation()
  const total = progress?.totalPairs ?? fallback?.totalPairs ?? null
  const mine = progress?.reviewedByMe ?? fallback?.reviewedByMe ?? (total != null && fallback?.remaining != null ? total - fallback.remaining : null)
  const min = progress?.minRatingsForConfidence ?? 20
  return (
    <div className="flex flex-col gap-3 p-4 rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface">
      {total != null && mine != null ? (
        <div className="flex flex-col gap-1">
          <p className="font-body text-body-sm">
            <strong className="tabular-nums">{t('manage.wikiAi.reviewProgress.mine', { done: mine, total })}</strong>
            {progress?.reviewedByAnyone != null && (
              <span className="text-ink-secondary dark:text-night-muted"> · {t('manage.wikiAi.reviewProgress.anyone', { n: progress.reviewedByAnyone })}</span>
            )}
          </p>
          <ProgressBar percent={total ? (mine / total) * 100 : 0} />
        </div>
      ) : fallback?.remaining != null ? (
        <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.review.remaining', { count: fallback.remaining })}</p>
      ) : null}

      {progress?.perSubject && progress.perSubject.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {progress.perSubject.map((s) => {
            const done = s.reviewedByMe ?? 0
            const complete = s.totalPairs > 0 && done >= s.totalPairs
            return (
              <li
                key={s.subjectId}
                title={s.subjectName ?? s.subjectId}
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border font-body text-[0.75rem] ${
                  complete ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300' : 'border-border dark:border-night-border text-ink-secondary dark:text-night-muted'
                }`}
              >
                <span className="font-mono">{s.subjectId}</span>
                <span className="tabular-nums">{done}/{s.totalPairs}</span>
              </li>
            )
          })}
        </ul>
      )}

      {progress?.ratingsPerConfig && progress.ratingsPerConfig.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {progress.ratingsPerConfig.map((c) => {
            const ok = c.ratings >= min
            return (
              <div key={c.configKey} className="flex flex-col gap-1">
                <p className="font-body text-[0.78rem]">
                  <span className="font-mono text-[0.7rem] text-ink-secondary dark:text-night-muted">{prettyConfig(c.configKey, c.plan, c.write)}</span>
                  <span className={`block ${ok ? 'text-emerald-700 dark:text-emerald-300' : ''}`}>{t('manage.wikiAi.reviewProgress.confidence', { n: Math.min(c.ratings, min), min })}</span>
                </p>
                <ProgressBar percent={(Math.min(c.ratings, min) / min) * 100} tone={ok ? 'done' : 'primary'} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
