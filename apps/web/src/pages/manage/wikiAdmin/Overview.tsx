import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  COST_STAGES, MODEL_STAGES, costPairs, rowKey, fetchCostSummary, fetchCosts, fetchRuns, fetchSettings,
  type KbSettings,
} from '../../../api/kbAdmin'
import CostChart from './CostChart'
import Forecast from './Forecast'
import QuotaCard from './QuotaCard'
import { Panel, StatusPill, ViewState } from './shared'
import { duration, pct, tokens, usd } from './format'
import { useLoad } from './useLoad'

const WEEKS = 12

// ISO datetime with the Buenos Aires offset: older API builds reject a
// bare date for `from` (OffsetDateTime parsing).
function since(weeks: number): string {
  const d = new Date(Date.now() - weeks * 7 * 864e5 - 3 * 36e5)
  return `${d.toISOString().slice(0, 10)}T00:00:00-03:00`
}

// Resumen: cost cards, weekly cost (by stage or model), top subjects, the
// models in use and the last run.
export default function Overview({ onOpenRun }: { onOpenRun: (id: string) => void }) {
  const { t, i18n } = useTranslation()
  const summary = useLoad(fetchCostSummary)
  const [by, setBy] = useState<'stage' | 'model'>('stage')
  const weekly = useLoad(() => fetchCosts({ from: since(WEEKS), groupBy: `week,${by}` }), [by])
  const settings = useLoad(fetchSettings)
  const runs = useLoad(() => fetchRuns(1))

  return (
    <div className="flex flex-col gap-4">
      <QuotaCard />

      <ViewState state={summary} skeleton="cards">
        {(s) => (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {s.simulated && (
              <p className="col-span-2 lg:col-span-4 font-mono text-label uppercase tracking-widest text-amber-700 dark:text-amber-300">{t('manage.wikiAi.simulated')}</p>
            )}
            <Stat label={t('manage.wikiAi.overview.last7')} value={usd(s.last7dUsd, 2)} />
            <Stat label={t('manage.wikiAi.overview.last30')} value={usd(s.last30dUsd, 2)} />
            <Stat label={t('manage.wikiAi.overview.projected')} value={usd(s.projectedMonthUsd, 2)} />
            <Stat label={t('manage.wikiAi.overview.cacheHit')} value={pct(s.cacheHitRatio, 1)} hint={t('manage.wikiAi.overview.cacheHint')} />
          </div>
        )}
      </ViewState>

      <Forecast summary={summary} />

      <Panel
        title={t('manage.wikiAi.overview.weekly')}
        actions={
          <div role="group" aria-label={t('manage.wikiAi.overview.groupBy')} className="flex rounded-sm border border-border dark:border-night-border overflow-hidden">
            {(['stage', 'model'] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={by === k}
                onClick={() => setBy(k)}
                className={`px-3 py-1 font-mono text-label uppercase tracking-widest ${by === k ? 'bg-primary text-white' : 'text-ink-secondary dark:text-night-muted hover:text-primary'}`}
              >
                {t(`manage.wikiAi.overview.by.${k}`)}
              </button>
            ))}
          </div>
        }
      >
        <ViewState state={weekly}>
          {(rows) => (
            <CostChart
              rows={rows}
              order={by === 'stage' ? COST_STAGES : undefined}
              labelOf={(k) => (by === 'stage' ? t(`manage.wikiAi.stages.${k.toUpperCase()}`, { defaultValue: k }) : k)}
            />
          )}
        </ViewState>
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Panel title={t('manage.wikiAi.overview.topSubjects')} className="lg:col-span-1">
          <ViewState state={summary} skeleton="rows" empty={(s) => !s.topSubjects?.length} emptyText={t('manage.wikiAi.overview.noCosts')}>
            {(s) => {
              const rows = s.topSubjects.slice(0, 8)
              const max = Math.max(...rows.map((r) => r.costUsd ?? 0), 0.0001)
              return (
                <ol className="flex flex-col gap-2">
                  {rows.map((r) => {
                    const id = r.subjectId ?? rowKey(r)
                    return (
                      <li key={id} className="flex flex-col gap-1">
                        <div className="flex justify-between gap-2 font-body text-body-sm">
                          <span className="truncate"><span className="font-mono text-label text-ink-secondary dark:text-night-muted mr-1.5">{id}</span>{r.subjectName}</span>
                          <span className="tabular-nums">{usd(r.costUsd, 2)}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-border dark:bg-night-border overflow-hidden" aria-hidden="true">
                          <div className="h-full rounded-full bg-primary dark:bg-primary-300" style={{ width: `${((r.costUsd ?? 0) / max) * 100}%` }} />
                        </div>
                      </li>
                    )
                  })}
                </ol>
              )
            }}
          </ViewState>
        </Panel>

        <Panel title={t('manage.wikiAi.overview.models')}>
          <ViewState state={settings} skeleton="rows">
            {(s) => <ModelsAtGlance s={s} />}
          </ViewState>
        </Panel>

        <Panel title={t('manage.wikiAi.overview.lastRun')}>
          <ViewState state={runs} skeleton="rows" empty={(r) => r.length === 0} emptyText={t('manage.wikiAi.runs.empty')}>
            {(r) => {
              const run = r[0]
              return (
                <div className="flex flex-col gap-2 font-body text-body-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill status={run.status} />
                    {run.stage && <span className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">{run.stage}</span>}
                    {run.dryRun && <span className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.runs.dry')}</span>}
                  </div>
                  <p className="text-ink-secondary dark:text-night-muted">
                    {run.startedAt ? new Date(run.startedAt).toLocaleString(i18n.language) : '—'} · {duration(run.startedAt, run.finishedAt)}
                  </p>
                  <p>{t('manage.wikiAi.runs.subjectsN', { count: run.subjects?.length ?? 0 })} · {tokens(run.tokensIn + run.tokensOut)} tokens · {usd(run.costUsd ?? run.costEstimate, 2)}</p>
                  {run.error && <p className="text-red-600 dark:text-red-400">{run.error}</p>}
                  <button type="button" onClick={() => onOpenRun(run.id)} className="self-start font-mono text-label uppercase tracking-widest text-primary hover:underline">
                    {t('manage.wikiAi.runs.details')} →
                  </button>
                </div>
              )
            }}
          </ViewState>
        </Panel>
      </div>

      {summary.data && costPairs(summary.data.byStage).length > 0 && (
        <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">
          {t('manage.wikiAi.overview.split30')}{' '}
          {costPairs(summary.data.byStage).map(([k, v]) => `${t(`manage.wikiAi.stages.${k.toUpperCase()}`, { defaultValue: k })} ${usd(v, 2)}`).join(' · ')}
        </p>
      )}
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface p-4" title={hint}>
      <p className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">{label}</p>
      <p className="font-display font-bold text-h3 text-ink-primary dark:text-night-text mt-1 tabular-nums">{value}</p>
    </div>
  )
}

function ModelsAtGlance({ s }: { s: KbSettings }) {
  const { t } = useTranslation()
  const model: Record<string, string> = { digest: s.modelDigest, plan: s.modelPlan, write: s.modelWrite, retry: s.modelRetry }
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 font-body text-body-sm">
      {MODEL_STAGES.map((st) => (
        <div key={st} className="contents">
          <dt className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">{t(`manage.wikiAi.stages.${st.toUpperCase()}`)}</dt>
          <dd className="font-mono text-label break-all">{model[st] ?? '—'}</dd>
        </div>
      ))}
      <div className="contents">
        <dt className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.settings.mode')}</dt>
        <dd>{t(`manage.wikiAi.settings.modes.${s.executionMode}`, { defaultValue: s.executionMode })}</dd>
      </div>
      <div className="contents">
        <dt className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.settings.weekly')}</dt>
        <dd>{s.enabled ? t('manage.wikiAi.on') : t('manage.wikiAi.off')}</dd>
      </div>
    </dl>
  )
}
