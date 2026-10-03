import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  configKey, createEval, modelWithEffort, createEvalSet, refreezeEvalSet, estimateEval, fetchEval, fetchEvalSets, fetchEvals, fetchLeaderboard, fetchModels, promoteEval,
  type EvalConfigResult, type EvalMetrics, type EvalRun, type KbModel, type LeaderboardRow, type ModelConfig,
} from '../../../api/kbAdmin'
import { fetchApunteSubjects, type ApunteSubject } from '../../../api/drive'
import { useDebounced } from '../../../hooks/useDebounced'
import { apuntesErrorMessage } from '../../../utils/apuntes'
import ConfirmDialog from '../../../components/ConfirmDialog'
import ErrorBanner from '../../../components/ErrorBanner'
import Notice from '../../../components/Notice'
import BlindReview from './BlindReview'
import ReasoningSelect from './ReasoningSelect'
import { ModelSelect } from './SettingsView'
import { BTN, BTN_PRI, CostImpactDialog, FIELD, Panel, StatusPill, TD, TH, ViewState, isUnavailable, pct, secs, tokens, usd, useLoad } from './shared'

const FEW_RATINGS = 20

// Metric rows for the comparison table: format and which direction wins.
type Dir = 'high' | 'low' | null
const METRICS: { key: keyof EvalMetrics; fmt: (v: number | null | undefined) => string; dir: Dir; headline?: boolean }[] = [
  { key: 'costPerValidPage', fmt: (v) => usd(v), dir: 'low', headline: true },
  { key: 'firstPassValidRate', fmt: (v) => pct(v, 0), dir: 'high', headline: true },
  { key: 'finalValidRate', fmt: (v) => pct(v, 0), dir: 'high' },
  { key: 'unsupportedClaimsRate', fmt: (v) => pct(v, 1), dir: 'low' },
  { key: 'citationDensity', fmt: (v) => (v == null ? '—' : v.toFixed(2)), dir: 'high' },
  { key: 'uncitedSections', fmt: (v) => (v == null ? '—' : String(v)), dir: 'low' },
  { key: 'coverageViolations', fmt: (v) => (v == null ? '—' : String(v)), dir: 'low' },
  { key: 'copyViolations', fmt: (v) => (v == null ? '—' : String(v)), dir: 'low' },
  { key: 'pagesPlanned', fmt: (v) => (v == null ? '—' : String(v)), dir: null },
  { key: 'pagesWritten', fmt: (v) => (v == null ? '—' : String(v)), dir: null },
  { key: 'avgWords', fmt: (v) => (v == null ? '—' : String(Math.round(v))), dir: null },
  { key: 'crossLinks', fmt: (v) => (v == null ? '—' : String(v)), dir: 'high' },
  { key: 'anchors', fmt: (v) => (v == null ? '—' : String(v)), dir: 'high' },
  { key: 'inputTokens', fmt: tokens, dir: null },
  { key: 'outputTokens', fmt: tokens, dir: null },
  { key: 'emptyToolCallRate', fmt: (v) => pct(v, 1), dir: 'low' },
  { key: 'costUsd', fmt: (v) => usd(v, 2), dir: 'low' },
  { key: 'durationSec', fmt: secs, dir: 'low' },
]

function best(values: (number | null | undefined)[], dir: Dir): number | null {
  if (!dir) return null
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v))
  if (nums.length < 2) return null
  return dir === 'high' ? Math.max(...nums) : Math.min(...nums)
}

export default function EvalsView() {
  const { t } = useTranslation()
  const [openEval, setOpenEval] = useState<string | null>(null)
  const sets = useLoad(fetchEvalSets)
  const evals = useLoad(fetchEvals)
  const models = useLoad(fetchModels)
  const [lbSet, setLbSet] = useState<string>('')

  useEffect(() => { if (!lbSet && sets.data?.length) setLbSet(sets.data[0].id) }, [sets.data, lbSet])

  if (openEval) {
    return (
      <EvalDetail
        id={openEval}
        setName={(sid) => sets.data?.find((s) => s.id === sid)?.name}
        onBack={() => { setOpenEval(null); evals.reload() }}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <SetsPanel sets={sets} />
        <NewEvalPanel sets={sets.data ?? []} models={models.data ?? []} disabled={sets.unavailable} onCreated={(e) => { evals.reload(); if (e?.id) setOpenEval(e.id) }} />
      </div>

      <Panel title={t('manage.wikiAi.evals.list')}>
        <ViewState state={evals} skeleton="rows" empty={(e) => e.length === 0} emptyText={t('manage.wikiAi.evals.noEvals')}>
          {(list) => (
            <ul className="flex flex-col divide-y divide-border dark:divide-night-border">
              {list.map((e) => (
                <li key={e.id}>
                  <button type="button" onClick={() => setOpenEval(e.id)} className="w-full text-left flex flex-wrap items-center gap-3 py-2 hover:text-primary">
                    <StatusPill status={e.status} />
                    <span className="font-body text-body-sm font-semibold">{e.setName ?? sets.data?.find((s) => s.id === e.setId)?.name ?? e.setId}</span>
                    <span className="font-mono text-label text-ink-secondary dark:text-night-muted">{(e.configs ?? []).map((c) => c.configKey).join(' vs ')}</span>
                    <span className="ml-auto font-mono text-label text-ink-secondary dark:text-night-muted">{new Date(e.createdAt).toLocaleDateString()}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ViewState>
      </Panel>

      <Panel
        title={t('manage.wikiAi.evals.leaderboard')}
        actions={sets.data && sets.data.length > 0 ? (
          <select value={lbSet} onChange={(e) => setLbSet(e.target.value)} aria-label={t('manage.wikiAi.evals.set')} className={FIELD}>
            {sets.data.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        ) : undefined}
      >
        {lbSet ? <Leaderboard setId={lbSet} /> : (
          <p className="py-4 text-center font-body text-body-sm text-ink-secondary dark:text-night-muted">
            {sets.unavailable ? t('manage.wikiAi.unavailable') : t('manage.wikiAi.evals.noSets')}
          </p>
        )}
      </Panel>
    </div>
  )
}

function SetsPanel({ sets }: { sets: ReturnType<typeof useLoad<Awaited<ReturnType<typeof fetchEvalSets>>>> }) {
  const { t } = useTranslation()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<ApunteSubject[]>([])
  const [q, setQ] = useState('')
  const debounced = useDebounced(q, 250)
  const [options, setOptions] = useState<ApunteSubject[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreezing, setRefreezing] = useState<{ id: string; name: string } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function refreeze() {
    if (!refreezing) return
    setBusy(true); setError(null)
    try {
      await refreezeEvalSet(refreezing.id)
      setNotice(t('manage.wikiAi.evals.refrozen', { name: refreezing.name }))
      sets.reload()
    } catch (e) {
      setError(apuntesErrorMessage(e, t))
    } finally {
      setBusy(false); setRefreezing(null)
    }
  }

  useEffect(() => {
    if (!debounced.trim()) { setOptions([]); return }
    let cancelled = false
    fetchApunteSubjects(debounced, 8).then((r) => { if (!cancelled) setOptions(r) }).catch(() => {})
    return () => { cancelled = true }
  }, [debounced])

  async function create() {
    setBusy(true); setError(null)
    try {
      await createEvalSet({ name: name.trim(), subjectIds: picked.map((s) => s.subjectId) })
      setCreating(false); setName(''); setPicked([])
      sets.reload()
    } catch (e) {
      setError(apuntesErrorMessage(e, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel
      title={t('manage.wikiAi.evals.sets')}
      actions={!creating && !sets.unavailable ? <button type="button" onClick={() => setCreating(true)} className={BTN}>{t('manage.wikiAi.evals.newSet')}</button> : undefined}
    >
      {creating && (
        <div className="flex flex-col gap-3 mb-4 p-3 rounded-sm border border-border dark:border-night-border">
          <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.evals.frozenHint')}</p>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('manage.wikiAi.evals.setName')} aria-label={t('manage.wikiAi.evals.setName')} className={FIELD} />
          <div className="relative">
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('manage.wikiAi.evals.addSubject')} aria-label={t('manage.wikiAi.evals.addSubject')} className={`${FIELD} w-full`} />
            {options.length > 0 && (
              <ul className="absolute z-20 left-0 right-0 mt-1 max-h-56 overflow-y-auto rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface shadow-card-hover">
                {options.map((s) => (
                  <li key={s.subjectId}>
                    <button type="button" className="w-full text-left px-3 py-2 font-body text-body-sm hover:bg-primary-50 dark:hover:bg-primary-900" onClick={() => { if (!picked.some((p) => p.subjectId === s.subjectId)) setPicked([...picked, s]); setQ(''); setOptions([]) }}>
                      <span className="font-mono text-label text-ink-secondary dark:text-night-muted mr-1.5">{s.subjectId}</span>{s.subjectName}
                      {s.hasWiki === false && <span className="ml-2 text-amber-700 dark:text-amber-300">{t('manage.wikiAi.evals.noWiki')}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {picked.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {picked.map((s) => (
                <li key={s.subjectId} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-border dark:border-night-border font-body text-body-sm">
                  <span className="font-mono text-label">{s.subjectId}</span> {s.subjectName}
                  <button type="button" aria-label={`${t('manage.delete')} ${s.subjectId}`} onClick={() => setPicked(picked.filter((p) => p.subjectId !== s.subjectId))} className="ml-1 opacity-60 hover:opacity-100">×</button>
                </li>
              ))}
            </ul>
          )}
          {error && <p role="alert" className="font-body text-body-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setCreating(false)} className="px-3 py-1.5 font-mono text-label uppercase tracking-widest text-ink-secondary">{t('manage.cancel')}</button>
            <button type="button" onClick={create} disabled={busy || !name.trim() || picked.length === 0} className={BTN_PRI}>{busy ? '…' : t('manage.wikiAi.evals.createSet')}</button>
          </div>
        </div>
      )}
      {!creating && error && <ErrorBanner className="mb-2" onDismiss={() => setError(null)}>{error}</ErrorBanner>}
      {notice && <Notice className="mb-2" onDismiss={() => setNotice(null)}>{notice}</Notice>}
      {refreezing && (
        <ConfirmDialog
          title={t('manage.wikiAi.evals.refreeze')}
          body={t('manage.wikiAi.evals.refreezeBody', { name: refreezing.name })}
          confirmLabel={t('manage.wikiAi.evals.refreeze')}
          busy={busy}
          onConfirm={() => void refreeze()}
          onCancel={() => setRefreezing(null)}
        />
      )}
      <ViewState state={sets} skeleton="rows" empty={(s) => s.length === 0} emptyText={t('manage.wikiAi.evals.noSets')}>
        {(list) => (
          <ul className="flex flex-col divide-y divide-border dark:divide-night-border">
            {list.map((s) => (
              <li key={s.id} className="py-2 flex flex-wrap items-start gap-2">
                <div className="flex-1 min-w-0">
                  <p className="font-body text-body-sm font-semibold">{s.name}</p>
                  <p className="font-mono text-label text-ink-secondary dark:text-night-muted">{s.subjectIds.join(' · ')}</p>
                </div>
                <button type="button" onClick={() => setRefreezing({ id: s.id, name: s.name })} className={BTN}>{t('manage.wikiAi.evals.refreeze')}</button>
              </li>
            ))}
          </ul>
        )}
      </ViewState>
    </Panel>
  )
}

function NewEvalPanel({ sets, models, disabled, onCreated }: {
  sets: { id: string; name: string }[]
  models: KbModel[]
  disabled: boolean
  onCreated: (e: EvalRun | undefined) => void
}) {
  const { t } = useTranslation()
  const [setId, setSetId] = useState('')
  const [configs, setConfigs] = useState<ModelConfig[]>([{ plan: '', write: '' }, { plan: '', write: '' }])
  const [note, setNote] = useState('')
  const [estimate, setEstimate] = useState<{ total?: number; tokens?: number } | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => { if (!setId && sets.length) setSetId(sets[0].id) }, [sets, setId])
  const valid = setId && configs.length >= 2 && configs.every((c) => c.plan && c.write) &&
    new Set(configs.map(configKey)).size === configs.length

  // Re-estimate whenever the selection changes.
  useEffect(() => {
    if (!valid) { setEstimate(undefined); return }
    let cancelled = false
    setEstimate(undefined)
    const id = window.setTimeout(() => {
      estimateEval({ setId, models: configs })
        .then((r) => { if (!cancelled) setEstimate({ total: r.estimatedCostUsd, tokens: (r.estimatedInputTokens ?? 0) + (r.estimatedOutputTokens ?? 0) || undefined }) })
        .catch((e) => { if (!cancelled) setEstimate(isUnavailable(e) ? null : null) })
    }, 300)
    return () => { cancelled = true; window.clearTimeout(id) }
  }, [setId, configs, valid])

  async function launch() {
    setBusy(true); setError(null); setNotice(null)
    try {
      const e = await createEval({ setId, models: configs, note: note.trim() || undefined })
      setNotice(t('manage.wikiAi.evals.launched'))
      onCreated(e)
    } catch (e) {
      setError(apuntesErrorMessage(e, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title={t('manage.wikiAi.evals.newEval')}>
      {disabled ? (
        <p className="py-4 text-center font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.unavailable')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.evals.set')}</span>
            <select value={setId} onChange={(e) => setSetId(e.target.value)} className={FIELD}>
              {sets.length === 0 && <option value="">{t('manage.wikiAi.evals.noSets')}</option>}
              {sets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          {configs.map((c, i) => (
            <fieldset key={i} className="grid grid-cols-1 sm:grid-cols-[auto_1fr_1fr_auto] items-start gap-2 p-2 rounded-sm border border-border dark:border-night-border">
              <legend className="sr-only">{t('manage.wikiAi.evals.config', { n: i + 1 })}</legend>
              <span className="font-display font-bold text-h5 self-center w-6 text-center" aria-hidden="true">{String.fromCharCode(65 + i)}</span>
              {(['plan', 'write'] as const).map((stage) => (
                <div key={stage} className="grid grid-cols-[1fr_7.5rem] gap-2 items-start min-w-0">
                  <ModelSelect
                    label={`${t(`manage.wikiAi.stages.${stage.toUpperCase()}`)} ${i + 1}`}
                    value={c[stage] || null}
                    models={models}
                    allowDefault
                    onChange={(v) => setConfigs(configs.map((x, j) => (j === i ? { ...x, [stage]: v ?? '' } : x)))}
                  />
                  <ReasoningSelect
                    label={`${t(`manage.wikiAi.stages.${stage.toUpperCase()}`)} ${i + 1} · ${t('manage.wikiAi.reasoning.label')}`}
                    model={models.find((m) => m.id === c[stage])}
                    value={c.reasoningEffort?.[stage] ?? null}
                    onChange={(v) => setConfigs(configs.map((x, j) => (j === i ? { ...x, reasoningEffort: { ...(x.reasoningEffort ?? {}), [stage]: v } } : x)))}
                  />
                </div>
              ))}
              <button type="button" disabled={configs.length <= 2} onClick={() => setConfigs(configs.filter((_, j) => j !== i))} aria-label={t('manage.delete')} className="self-center px-2 text-ink-secondary hover:text-red-600 disabled:opacity-30">×</button>
            </fieldset>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={configs.length >= 4} onClick={() => setConfigs([...configs, { plan: '', write: '' }])} className={BTN}>{t('manage.wikiAi.evals.addConfig')}</button>
            <span className="font-body text-[0.75rem] text-ink-secondary dark:text-night-muted">
              {t('manage.wikiAi.evals.configHint')}
              {models.some((m) => m.supportsReasoningEffort) && ` ${t('manage.wikiAi.reasoning.hint')}`}
            </span>
          </div>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('manage.wikiAi.note')} aria-label={t('manage.wikiAi.note')} className={FIELD} />
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border dark:border-night-border">
            <p className="font-body text-body-sm" aria-live="polite">
              {!valid ? <span className="text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.evals.pickConfigs')}</span>
                : estimate === undefined ? <span className="text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.evals.estimating')}</span>
                  : estimate === null || estimate.total == null ? <span className="text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.evals.noEstimate')}</span>
                    : <>{t('manage.wikiAi.evals.estimate')}: <strong>{usd(estimate.total, 2)}</strong>{estimate.tokens ? ` · ${tokens(estimate.tokens)} tokens` : ''}</>}
            </p>
            <button type="button" onClick={launch} disabled={!valid || busy} className={BTN_PRI}>{busy ? '…' : t('manage.wikiAi.evals.launch')}</button>
          </div>
          {error && <ErrorBanner onDismiss={() => setError(null)}>{error}</ErrorBanner>}
          {notice && <Notice onDismiss={() => setNotice(null)}>{notice}</Notice>}
        </div>
      )}
    </Panel>
  )
}

function EvalDetail({ id, setName, onBack }: { id: string; setName: (setId: string) => string | undefined; onBack: () => void }) {
  const { t } = useTranslation()
  const ev = useLoad(() => fetchEval(id), [id])
  const [reviewing, setReviewing] = useState(false)
  const [promoting, setPromoting] = useState<EvalConfigResult | null>(null)

  if (reviewing) {
    return (
      <div className="flex flex-col gap-3">
        <button type="button" onClick={() => setReviewing(false)} className="self-start font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted hover:text-primary">← {t('manage.wikiAi.review.back')}</button>
        <h3 className="font-display font-bold text-h4">{t('manage.wikiAi.review.title')}</h3>
        <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.review.intro')}</p>
        <BlindReview evalId={id} onDone={() => { setReviewing(false); ev.reload() }} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <button type="button" onClick={onBack} className="self-start font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted hover:text-primary">← {t('manage.wikiAi.evals.back')}</button>
      <ViewState state={ev}>
        {(e) => {
          const cfgs = e.configs ?? []
          const reasons = [...new Set(cfgs.flatMap((c) => Object.keys(c.metrics?.rejectReasons ?? {})))]
          return (
            <>
              <Panel
                title={<span className="flex flex-wrap items-center gap-2">{e.setName ?? setName(e.setId) ?? e.setId} <StatusPill status={e.status} /></span>}
                actions={<button type="button" onClick={() => setReviewing(true)} disabled={cfgs.length < 2} className={BTN_PRI}>{t('manage.wikiAi.review.start')}</button>}
              >
                {e.note && <p className="mb-3 font-body text-body-sm text-ink-secondary dark:text-night-muted">“{e.note}”</p>}
                {cfgs.length === 0 ? (
                  <p className="py-4 text-center font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.evals.noResults')}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full font-body text-body-sm">
                      <thead><tr>
                        <th className={TH}>{t('manage.wikiAi.evals.metric')}</th>
                        {cfgs.map((c, i) => (
                          <th key={c.configKey} className={`${TH} text-right normal-case tracking-normal`}>
                            <span className="font-display font-bold text-h5 mr-1">{String.fromCharCode(65 + i)}</span>
                            <span className="block font-mono text-[0.68rem] text-ink-secondary dark:text-night-muted">{modelWithEffort(c.plan, c.reasoningEffort?.plan)} → {modelWithEffort(c.write, c.reasoningEffort?.write)}</span>
                          </th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {METRICS.map((m) => {
                          const vals = cfgs.map((c) => c.metrics?.[m.key] as number | null | undefined)
                          const b = best(vals, m.dir)
                          return (
                            <tr key={m.key} className={`border-t border-border dark:border-night-border ${m.headline ? 'bg-page-bg dark:bg-night-bg' : ''}`}>
                              <td className={`${TD} ${m.headline ? 'font-semibold' : ''}`}>
                                {t(`manage.wikiAi.metrics.${m.key}`)}
                                {m.key === 'unsupportedClaimsRate' && <span className="ml-1 font-mono text-[0.65rem] text-ink-secondary">({t('manage.wikiAi.metrics.heuristic')})</span>}
                              </td>
                              {vals.map((v, i) => {
                                const isBest = b != null && v === b
                                return (
                                  <td key={i} className={`${TD} text-right tabular-nums ${m.headline ? 'font-semibold' : ''} ${isBest ? 'text-emerald-700 dark:text-emerald-300' : ''}`}>
                                    {isBest && <span className="sr-only">{t('manage.wikiAi.evals.best')}: </span>}
                                    {m.fmt(v)}{isBest && <span aria-hidden="true"> ★</span>}
                                  </td>
                                )
                              })}
                            </tr>
                          )
                        })}
                        <tr className="border-t border-border dark:border-night-border">
                          <td className={TD} />
                          {cfgs.map((c) => (
                            <td key={c.configKey} className={`${TD} text-right`}>
                              <button type="button" onClick={() => setPromoting(c)} className={BTN}>{t('manage.wikiAi.evals.promote')}</button>
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>

              {reasons.length > 0 && (
                <Panel title={t('manage.wikiAi.evals.rejectReasons')}>
                  <div className="overflow-x-auto">
                    <table className="w-full font-body text-body-sm">
                      <thead><tr>
                        <th className={TH}>{t('manage.wikiAi.evals.reason')}</th>
                        {cfgs.map((c, i) => <th key={c.configKey} className={`${TH} text-right`}>{String.fromCharCode(65 + i)}</th>)}
                      </tr></thead>
                      <tbody>
                        {reasons.map((r) => {
                          const vals = cfgs.map((c) => c.metrics?.rejectReasons?.[r] ?? 0)
                          const max = Math.max(...vals, 1)
                          return (
                            <tr key={r} className="border-t border-border dark:border-night-border">
                              <td className={`${TD} font-mono text-label`}>{r}</td>
                              {vals.map((v, i) => (
                                <td key={i} className={`${TD} text-right`}>
                                  <span className="inline-flex items-center gap-2">
                                    <span className="w-16 h-1.5 rounded-full bg-border dark:bg-night-border overflow-hidden" aria-hidden="true">
                                      <span className="block h-full bg-amber-500" style={{ width: `${(v / max) * 100}%` }} />
                                    </span>
                                    <span className="tabular-nums w-6">{v}</span>
                                  </span>
                                </td>
                              ))}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              )}

              {promoting && (
                <CostImpactDialog
                  title={t('manage.wikiAi.evals.promoteTitle')}
                  body={t('manage.wikiAi.evals.promoteBody', { plan: modelWithEffort(promoting.plan, promoting.reasoningEffort?.plan), write: modelWithEffort(promoting.write, promoting.reasoningEffort?.write) })}
                  onConfirm={async () => (await promoteEval(id, promoting.configKey))?.costImpact ?? null}
                  onCancel={() => setPromoting(null)}
                />
              )}
            </>
          )
        }}
      </ViewState>
    </div>
  )
}

function Leaderboard({ setId }: { setId: string }) {
  const { t } = useTranslation()
  const lb = useLoad(() => fetchLeaderboard(setId), [setId])
  const sorted = useMemo(() => [...(lb.data ?? [])].sort((a, b) => (b.winRate ?? -1) - (a.winRate ?? -1)), [lb.data])
  return (
    <ViewState state={lb} skeleton="rows" empty={(r) => r.length === 0} emptyText={t('manage.wikiAi.evals.noLeaderboard')}>
      {() => (
        <div className="overflow-x-auto">
          <table className="w-full font-body text-body-sm">
            <thead><tr>
              <th className={TH}>{t('manage.wikiAi.evals.configCol')}</th>
              <th className={`${TH} text-right`}>{t('manage.wikiAi.evals.winRate')}</th>
              <th className={`${TH} text-right`}>{t('manage.wikiAi.review.scores.accuracy')}</th>
              <th className={`${TH} text-right`}>{t('manage.wikiAi.review.scores.clarity')}</th>
              <th className={`${TH} text-right`}>{t('manage.wikiAi.review.scores.usefulness')}</th>
              <th className={`${TH} text-right`}>{t('manage.wikiAi.metrics.firstPassValidRate')}</th>
              <th className={`${TH} text-right`}>{t('manage.wikiAi.metrics.costPerValidPage')}</th>
              <th className={`${TH} text-right`}>{t('manage.wikiAi.evals.ratings')}</th>
            </tr></thead>
            <tbody>
              {sorted.map((r: LeaderboardRow) => (
                <tr key={r.configKey} className="border-t border-border dark:border-night-border">
                  <td className={`${TD} font-mono text-label`}>{modelWithEffort(r.plan, r.reasoningEffort?.plan)} → {modelWithEffort(r.write, r.reasoningEffort?.write)}</td>
                  <td className={`${TD} text-right tabular-nums font-semibold`}>{pct(r.winRate, 0)}</td>
                  <td className={`${TD} text-right tabular-nums`}>{r.avgAccuracy?.toFixed(1) ?? '—'}</td>
                  <td className={`${TD} text-right tabular-nums`}>{r.avgClarity?.toFixed(1) ?? '—'}</td>
                  <td className={`${TD} text-right tabular-nums`}>{r.avgUsefulness?.toFixed(1) ?? '—'}</td>
                  <td className={`${TD} text-right tabular-nums`}>{pct(r.firstPassValidRate, 0)}</td>
                  <td className={`${TD} text-right tabular-nums`}>{usd(r.costPerValidPage)}</td>
                  <td className={`${TD} text-right tabular-nums`}>
                    {r.ratings}
                    {r.ratings < FEW_RATINGS && (
                      <span className="ml-1.5 px-1 rounded-sm bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 font-mono text-[0.65rem]" title={t('manage.wikiAi.evals.fewRatingsHint', { n: FEW_RATINGS })}>
                        {t('manage.wikiAi.evals.fewRatings')}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ViewState>
  )
}
