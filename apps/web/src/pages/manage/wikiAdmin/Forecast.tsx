import { useTranslation } from 'react-i18next'
import { fetchForecast, type CostSummary } from '../../../api/kbAdmin'
import { Panel, ViewState } from './shared'
import { basisText, range, tokens, usd } from './format'
import { useLoad, type Loaded } from './useLoad'

const STAGES = ['DIGEST', 'PLAN', 'WRITE', 'RETRY'] as const

// "Gasto esperado" (ADMIN doc §7): next run by stage, expected week and
// month with their range and basis, batch/cache savings, the weekly limit
// warning, and expected vs actual for the last runs.
export default function Forecast({ summary }: { summary: Loaded<CostSummary> }) {
  const { t, i18n } = useTranslation()
  const f = useLoad(fetchForecast)

  return (
    <Panel title={t('manage.wikiAi.forecast.title')}>
      <ViewState state={f} skeleton="rows">
        {(fc) => (
          <div className="flex flex-col gap-4">
            {fc.limits?.exceedsLimit && (
              <p role="alert" className="px-3 py-2 rounded-sm border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 font-body text-body-sm text-amber-800 dark:text-amber-200">
                ⚠ {t('manage.wikiAi.forecast.overLimit', { expected: usd(fc.weekly?.expectedUsd, 2), limit: usd(fc.limits.weeklyCostLimitUsd, 2) })}
              </p>
            )}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <p className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.forecast.nextRun')}</p>
                <p className="font-display font-bold text-h3 tabular-nums">{fc.nextRun ? usd(fc.nextRun.totalUsd, 2) : '—'}</p>
                {fc.nextRun && (
                  <>
                    <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">
                      {t('manage.wikiAi.runs.subjectsN', { count: Array.isArray(fc.nextRun.dirtySubjects) ? fc.nextRun.dirtySubjects.length : fc.nextRun.dirtySubjects ?? 0 })}
                    </p>
                    <ul className="mt-2 flex flex-col gap-1 font-body text-body-sm">
                      {STAGES.map((st) => {
                        const s = fc.nextRun?.perStage?.[st]
                        if (!s) return null
                        return (
                          <li key={st}>
                            <div className="flex items-baseline justify-between gap-2">
                              <span>{t(`manage.wikiAi.stages.${st}`)}</span>
                              <span className="tabular-nums whitespace-nowrap">{usd(s.costUsd, 2)}</span>
                            </div>
                            <p className="font-mono text-[0.66rem] text-ink-secondary dark:text-night-muted truncate" title={s.model ?? ''}>
                              {s.model} · {s.mode} · {tokens(s.inputTokens)} → {tokens(s.outputTokens)}
                            </p>
                          </li>
                        )
                      })}
                    </ul>
                  </>
                )}
              </div>
              <div>
                <p className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.forecast.weekly')}</p>
                <p className="font-display font-bold text-h3 tabular-nums">{usd(fc.weekly?.expectedUsd, 2)}</p>
                <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted tabular-nums">{range(fc.weekly?.low, fc.weekly?.high)}</p>
                <p className="mt-3 font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.forecast.monthly')}</p>
                <p className="font-display font-bold text-h4 tabular-nums">{usd(fc.monthly?.expectedUsd, 2)}</p>
                <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted tabular-nums">{range(fc.monthly?.low, fc.monthly?.high)}</p>
                {fc.weekly?.basis && <p className="mt-2 font-body text-[0.75rem] text-ink-secondary dark:text-night-muted">{basisText(fc.weekly.basis, fc.weekly.runsUsed, t)}</p>}
              </div>
              <div>
                <p className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.forecast.savings')}</p>
                {fc.savings ? (
                  <dl className="mt-1 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 font-body text-body-sm">
                    <dt>{t('manage.wikiAi.forecast.savingsBatch')}{fc.discountIsEstimate && <span title={t('manage.wikiAi.prices.upTo', { pct: 50 })}>*</span>}</dt>
                    <dd className="tabular-nums text-emerald-700 dark:text-emerald-300">−{usd(fc.savings.batchUsd, 2)}</dd>
                    <dt>{t('manage.wikiAi.forecast.savingsCache')}</dt>
                    <dd className="tabular-nums text-emerald-700 dark:text-emerald-300">−{usd(fc.savings.cacheUsd, 2)}</dd>
                  </dl>
                ) : <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">—</p>}
                {fc.fullRebuild && (
                  <p className="mt-3 font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.forecast.fullRebuild', { cost: usd(fc.fullRebuild.costUsd, 2) })}</p>
                )}
                {fc.discountIsEstimate && <p className="mt-2 font-body text-[0.72rem] text-ink-secondary dark:text-night-muted">* {t('manage.wikiAi.prices.upTo', { pct: 50 })}</p>}
              </div>
            </div>
          </div>
        )}
      </ViewState>

      {summary.data?.accuracy?.lastRuns && summary.data.accuracy.lastRuns.length > 0 && (
        <div className="mt-5 pt-4 border-t border-border dark:border-night-border">
          <p className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted mb-2">{t('manage.wikiAi.forecast.accuracy')}</p>
          <table className="w-full font-body text-body-sm">
            <thead><tr>
              <th className="text-left font-mono text-label uppercase tracking-widest py-1">{t('manage.wikiAi.runs.run')}</th>
              <th className="text-right font-mono text-label uppercase tracking-widest py-1">{t('manage.wikiAi.forecast.expected')}</th>
              <th className="text-right font-mono text-label uppercase tracking-widest py-1">{t('manage.wikiAi.forecast.actual')}</th>
              <th className="text-right font-mono text-label uppercase tracking-widest py-1">Δ</th>
            </tr></thead>
            <tbody>
              {summary.data.accuracy.lastRuns.map((r) => {
                const diff = r.expectedUsd && r.actualUsd != null ? (r.actualUsd - r.expectedUsd) / r.expectedUsd : null
                return (
                  <tr key={r.runId} className="border-t border-border dark:border-night-border">
                    <td className="py-1 font-mono text-label">{r.startedAt ? new Date(r.startedAt).toLocaleDateString(i18n.language) : r.runId.slice(0, 8)}</td>
                    <td className="py-1 text-right tabular-nums">{usd(r.expectedUsd, 2)}</td>
                    <td className="py-1 text-right tabular-nums">{usd(r.actualUsd, 2)}</td>
                    <td className={`py-1 text-right tabular-nums ${diff != null && Math.abs(diff) > 0.25 ? 'text-amber-700 dark:text-amber-300' : 'text-ink-secondary dark:text-night-muted'}`}>
                      {diff == null ? '—' : `${diff > 0 ? '+' : ''}${Math.round(diff * 100)}%`}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}
