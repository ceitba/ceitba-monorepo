import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  MODEL_STAGES, fetchForecast, fetchStageCost, isSelectable, sortModels, fetchModels, forecastFor, impactFrom, normalizeImpact, fetchSettings, fetchSettingsHistory, previewSettingsImpact, probeOk, restoreSettings, saveSettings,
  type CostImpact, type ExecutionMode, type KbModel, type KbSettings, type ModelStage, type SettingsBody, type SubjectOverride,
} from '../../../api/kbAdmin'
import { fetchApunteSubjects, type ApunteSubject } from '../../../api/drive'
import { useDebounced } from '../../../hooks/useDebounced'
import ReasoningSelect from './ReasoningSelect'
import PriceTag, { priceText } from './PriceTag'
import ConfirmDialog from '../../../components/ConfirmDialog'
import { BTN, BTN_DANGER, BTN_PRI, CostImpactDialog, FIELD, Panel, TD, TH, ViewState, isUnavailable, usd, useLoad } from './shared'

const STAGE_FIELD: Record<ModelStage, 'modelDigest' | 'modelPlan' | 'modelWrite' | 'modelRetry'> = {
  digest: 'modelDigest', plan: 'modelPlan', write: 'modelWrite', retry: 'modelRetry',
}
const DAYS = [0, 1, 2, 3, 4, 5, 6] // cron day-of-week, 0 = Sunday

// Pick from the catalog: enabled + successfully probed models only (the
// current value stays selectable so nothing silently changes).
export function ModelSelect({ value, models, onChange, allowDefault, label, mode, stageCost, estimate }: {
  value: string | null | undefined
  models: KbModel[]
  onChange: (id: string | null) => void
  allowDefault?: boolean
  label: string
  mode?: ExecutionMode
  // Expected weekly cost of this stage per model id (Configuración).
  stageCost?: (id: string) => number | null | undefined
  estimate?: boolean
}) {
  const { t } = useTranslation()
  const current = models.find((m) => m.id === value)
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <select
        aria-label={label}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className={`${FIELD} w-full`}
      >
        {allowDefault && <option value="">{t('manage.wikiAi.settings.useDefault')}</option>}
        {!allowDefault && !current && value && <option value={value}>{value}</option>}
        {sortModels(models).map((m) => {
          const usable = isSelectable(m, mode)
          return (
            <option key={m.id} value={m.id} disabled={!usable && m.id !== value}>
              {m.displayName || m.id} · {priceText(m, mode)}
              {stageCost?.(m.id) != null ? ` · ${t('manage.wikiAi.prices.perWeek', { cost: usd(stageCost(m.id), 2) })}` : ''}
              {!m.enabled ? ` · ${t('manage.wikiAi.models.disabled')}` : !probeOk(m) ? ` · ${t('manage.wikiAi.models.notProbed')}` : ''}
            </option>
          )
        })}
      </select>
      {current && <ModelBadges m={current} mode={mode} estimate={estimate} />}
    </div>
  )
}

export function ModelBadges({ m, mode, estimate }: { m: KbModel; mode?: ExecutionMode; estimate?: boolean }) {
  const { t } = useTranslation()
  const ok = probeOk(m)
  return (
    <span className="flex flex-wrap items-center gap-1.5 font-mono text-[0.68rem] text-ink-secondary dark:text-night-muted">
      <PriceTag m={m} mode={mode} estimate={estimate} />
      <span className={ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}>
        {ok ? `✓ ${t('manage.wikiAi.models.probed')}` : `! ${t('manage.wikiAi.models.notProbed')}`}
      </span>
    </span>
  )
}

// Schedule ⇄ day + time. The API uses Spring's 6-field cron with seconds
// and day names ("0 0 3 * * SUN"); plain 5-field crons ("0 3 * * 0") are
// read too. Anything else is edited raw.
const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

function parseCron(cron: string): { day: number; time: string; seconds: boolean } | null {
  const f = (cron ?? '').trim().split(/\s+/)
  let sec: string, min: string, hour: string, dom: string, mon: string, dow: string
  if (f.length === 6) [sec, min, hour, dom, mon, dow] = f
  else if (f.length === 5) { [min, hour, dom, mon, dow] = f; sec = '0' }
  else return null
  if (sec !== '0' || dom !== '*' || mon !== '*' || !/^\d{1,2}$/.test(min) || !/^\d{1,2}$/.test(hour)) return null
  const d = /^\d$/.test(dow) ? Number(dow) % 7 : DOW.indexOf(dow.toUpperCase())
  if (d < 0) return null
  return { day: d, time: `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`, seconds: f.length === 6 }
}

function toCron(day: number, time: string, seconds = true): string {
  const [h, mi] = time.split(':').map((x) => Number(x) || 0)
  return seconds ? `0 ${mi} ${h} * * ${DOW[day]}` : `${mi} ${h} * * ${day}`
}

export default function SettingsView() {
  const { t, i18n } = useTranslation()
  const settings = useLoad(fetchSettings)
  const models = useLoad(fetchModels)
  const history = useLoad(fetchSettingsHistory)
  const [draft, setDraft] = useState<KbSettings | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [restoring, setRestoring] = useState<string | null>(null)
  const [rawCron, setRawCron] = useState(false)

  useEffect(() => { if (settings.data) { setDraft(settings.data); setRawCron(!parseCron(settings.data.cron)) } }, [settings.data])

  // Expected weekly cost per stage × usable model (GET /models/{id}/
  // stage-cost), shown next to each option. Stops at the first 404.
  const [stageCosts, setStageCosts] = useState<Map<string, number | null>>(new Map())
  const forecast = useLoad(fetchForecast)
  useEffect(() => {
    const list = (models.data ?? []).filter((m) => isSelectable(m))
    if (!list.length) return
    let cancelled = false
    ;(async () => {
      for (const st of MODEL_STAGES) {
        const results = await Promise.all(list.map((m) => fetchStageCost(m.id, st).then(
          (v) => [m.id, v] as const,
          (e) => { if (isUnavailable(e)) throw e; return [m.id, null] as const },
        ))).catch(() => null)
        if (cancelled || !results) return
        setStageCosts((prev) => {
          const next = new Map(prev)
          results.forEach(([id, v]) => next.set(`${st}:${id}`, v))
          return next
        })
      }
    })()
    return () => { cancelled = true }
  }, [models.data])
  const discountIsEstimate = forecast.data?.discountIsEstimate ?? false

  const dirty = useMemo(() => {
    if (!draft || !settings.data) return false
    const strip = (s: KbSettings) => JSON.stringify({ ...s, source: undefined })
    return strip(draft) !== strip(settings.data)
  }, [draft, settings.data])

  const body = useCallback((): SettingsBody => {
    const { source: _source, ...rest } = draft!
    void _source
    return rest
  }, [draft])

  // Current vs proposed forecast (ADMIN doc §7): weekly and monthly with
  // ranges plus the full-rebuild cost. Falls back to /settings/preview.
  const loadImpact = useCallback(async (): Promise<CostImpact | null> => {
    const preview = previewSettingsImpact(body()).catch((e) => {
      if (isUnavailable(e)) return null
      throw e
    })
    const [current, proposed] = await Promise.all([
      fetchForecast().catch(() => null),
      forecastFor(body()).catch(() => null),
    ])
    const p = await preview
    // Validation problems found by the preview are shown in the dialog.
    if (p?.errors?.length) throw new Error(p.errors.join(' · '))
    if (proposed) return impactFrom(current, proposed)
    return normalizeImpact(p?.costImpact)
  }, [body])

  async function save(note: string) {
    const saved = await saveSettings({ ...body(), note: note || undefined })
    settings.setData(() => saved)
    history.reload()
    return normalizeImpact(saved.costImpact)
  }

  async function restore(id: string) {
    const restored = await restoreSettings(id)
    settings.setData(() => restored)
    history.reload()
    setRestoring(null)
  }

  const set = <K extends keyof KbSettings>(k: K, v: KbSettings[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d))
  const catalog = models.data ?? []

  return (
    <div className="flex flex-col gap-4">
      <ViewState state={settings}>
        {() => draft && (
          <>
            <Panel title={t('manage.wikiAi.settings.stageModels')}>
              {models.unavailable && <p className="mb-2 font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.settings.noCatalog')}</p>}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {MODEL_STAGES.map((st) => (
                  <div key={st} className="flex flex-col gap-1 min-w-0">
                    <span className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
                      {t(`manage.wikiAi.stages.${st.toUpperCase()}`)}
                      {draft.source?.[STAGE_FIELD[st]] && <span className="ml-2 normal-case tracking-normal">({t(`manage.wikiAi.settings.source.${draft.source[STAGE_FIELD[st]]}`)})</span>}
                    </span>
                    <div className="grid grid-cols-[1fr_8.5rem] gap-2 items-start">
                      <ModelSelect
                        label={t(`manage.wikiAi.stages.${st.toUpperCase()}`)}
                        value={draft[STAGE_FIELD[st]]}
                        models={catalog}
                        mode={draft.executionMode}
                        stageCost={(id) => stageCosts.get(`${st}:${id}`)}
                        estimate={discountIsEstimate}
                        onChange={(id) => id && set(STAGE_FIELD[st], id)}
                      />
                      <ReasoningSelect
                        label={`${t(`manage.wikiAi.stages.${st.toUpperCase()}`)} · ${t('manage.wikiAi.reasoning.label')}`}
                        model={catalog.find((m) => m.id === draft[STAGE_FIELD[st]])}
                        value={draft.reasoningEffort?.[st] ?? null}
                        onChange={(v) => set('reasoningEffort', { ...(draft.reasoningEffort ?? {}), [st]: v })}
                      />
                    </div>
                  </div>
                ))}
              </div>
              {catalog.some((m) => m.supportsReasoningEffort) && (
                <p className="mt-3 font-body text-[0.75rem] text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.reasoning.hint')}</p>
              )}
            </Panel>

            <Panel title={t('manage.wikiAi.settings.pipeline')}>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <label className="flex flex-col gap-1">
                  <span className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.settings.mode')}</span>
                  <select value={draft.executionMode} onChange={(e) => set('executionMode', e.target.value as ExecutionMode)} className={FIELD}>
                    {(['auto', 'batch', 'sync'] as const).map((m) => <option key={m} value={m}>{t(`manage.wikiAi.settings.modes.${m}`)}</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-2 self-end min-h-[40px] cursor-pointer font-body text-body-sm">
                  <input type="checkbox" checked={draft.enabled} onChange={(e) => set('enabled', e.target.checked)} className="h-4 w-4 accent-primary" />
                  {t('manage.wikiAi.settings.weeklyOn')}
                </label>
                <label className="flex items-center gap-2 self-end min-h-[40px] cursor-pointer font-body text-body-sm">
                  <input type="checkbox" checked={draft.retryRejected} onChange={(e) => set('retryRejected', e.target.checked)} className="h-4 w-4 accent-primary" />
                  {t('manage.wikiAi.settings.retryRejected')}
                </label>
                <div className="flex flex-col gap-1">
                  <span className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.settings.schedule')}</span>
                  {rawCron ? (
                    <input value={draft.cron} onChange={(e) => set('cron', e.target.value)} className={`${FIELD} font-mono`} aria-label={t('manage.wikiAi.settings.cron')} />
                  ) : (
                    <div className="flex gap-2">
                      <select
                        aria-label={t('manage.wikiAi.settings.day')}
                        value={parseCron(draft.cron)?.day ?? 0}
                        onChange={(e) => set('cron', toCron(Number(e.target.value), parseCron(draft.cron)?.time ?? '03:00', parseCron(draft.cron)?.seconds ?? true))}
                        className={`${FIELD} flex-1`}
                      >
                        {DAYS.map((d) => (
                          <option key={d} value={d}>
                            {new Date(Date.UTC(2024, 0, 7 + d)).toLocaleDateString(i18n.language, { weekday: 'long', timeZone: 'UTC' })}
                          </option>
                        ))}
                      </select>
                      <input
                        type="time"
                        aria-label={t('manage.wikiAi.settings.time')}
                        value={parseCron(draft.cron)?.time ?? '03:00'}
                        onChange={(e) => set('cron', toCron(parseCron(draft.cron)?.day ?? 0, e.target.value || '03:00', parseCron(draft.cron)?.seconds ?? true))}
                        className={FIELD}
                      />
                    </div>
                  )}
                  <span className="font-body text-[0.75rem] text-ink-secondary dark:text-night-muted">
                    {t('manage.wikiAi.settings.tz')} · <code className="font-mono">{draft.cron}</code> ·{' '}
                    <button type="button" className="underline" onClick={() => setRawCron((v) => !v)}>
                      {rawCron ? t('manage.wikiAi.settings.simpleCron') : t('manage.wikiAi.settings.rawCron')}
                    </button>
                  </span>
                </div>
                <label className="flex flex-col gap-1">
                  <span className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.settings.budget')}</span>
                  <input type="number" min={0} step={10000} value={draft.runTokenBudget ?? ''} onChange={(e) => set('runTokenBudget', Number(e.target.value) || 0)} className={FIELD} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.settings.costLimit')}</span>
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={draft.weeklyCostLimitUsd ?? ''}
                    placeholder={t('manage.wikiAi.settings.noLimit')}
                    onChange={(e) => set('weeklyCostLimitUsd', e.target.value === '' ? null : Number(e.target.value))}
                    className={FIELD}
                  />
                </label>
              </div>
            </Panel>

            <Overrides
              overrides={draft.subjectOverrides ?? {}}
              models={catalog}
              onChange={(o) => set('subjectOverrides', o)}
            />

            <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-3 py-3 bg-page-bg/95 dark:bg-night-bg/95 border-t border-border dark:border-night-border">
              {dirty && <span className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.settings.unsaved')}</span>}
              <button type="button" disabled={!dirty} onClick={() => setDraft(settings.data)} className={BTN}>{t('manage.wikiAi.settings.discard')}</button>
              <button type="button" disabled={!dirty} onClick={() => setConfirming(true)} className={BTN_PRI}>{t('manage.save')}</button>
            </div>
          </>
        )}
      </ViewState>

      <Panel title={t('manage.wikiAi.settings.history')}>
        <ViewState state={history} skeleton="rows" empty={(h) => h.length === 0} emptyText={t('manage.wikiAi.settings.noHistory')}>
          {(h) => (
            <ul className="flex flex-col divide-y divide-border dark:divide-night-border">
              {h.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-3 py-2 font-body text-body-sm">
                  <span className="font-mono text-label text-ink-secondary dark:text-night-muted">{new Date(e.changedAt).toLocaleString(i18n.language)}</span>
                  <span className="font-mono text-label text-ink-secondary dark:text-night-muted" title={e.changedBy ?? undefined}>{e.changedByName ?? (e.changedBy ? e.changedBy.slice(0, 8) : '—')}</span>
                  <span className="flex-1 min-w-0 text-ink-secondary dark:text-night-muted truncate">
                    {e.note ? `“${e.note}”` : ''} {e.settings.modelWrite && <code className="font-mono text-[0.7rem]">write={e.settings.modelWrite}</code>}
                  </span>
                  <button type="button" onClick={() => setRestoring(e.id)} className={BTN}>{t('manage.wikiAi.settings.restore')}</button>
                </li>
              ))}
            </ul>
          )}
        </ViewState>
      </Panel>

      {confirming && draft && (
        <CostImpactDialog
          title={t('manage.wikiAi.settings.confirmTitle')}
          body={t('manage.wikiAi.settings.confirmBody')}
          loadImpact={loadImpact}
          onConfirm={save}
          onCancel={() => setConfirming(false)}
        />
      )}
      {restoring && (
        <ConfirmDialog
          title={t('manage.wikiAi.settings.restoreTitle')}
          body={t('manage.wikiAi.settings.restoreBody')}
          confirmLabel={t('manage.wikiAi.settings.restore')}
          danger={false}
          onConfirm={() => void restore(restoring)}
          onCancel={() => setRestoring(null)}
        />
      )}
    </div>
  )
}

function Overrides({ overrides, models, onChange }: {
  overrides: Record<string, SubjectOverride>
  models: KbModel[]
  onChange: (o: Record<string, SubjectOverride>) => void
}) {
  const { t } = useTranslation()
  const [filter, setFilter] = useState('')
  const [adding, setAdding] = useState('')
  const debounced = useDebounced(adding, 250)
  const [suggestions, setSuggestions] = useState<ApunteSubject[]>([])

  useEffect(() => {
    if (!debounced.trim()) { setSuggestions([]); return }
    let cancelled = false
    fetchApunteSubjects(debounced, 8).then((s) => { if (!cancelled) setSuggestions(s) }).catch(() => {})
    return () => { cancelled = true }
  }, [debounced])

  const rows = Object.entries(overrides).filter(([id]) => id.toLowerCase().includes(filter.toLowerCase()))
  const update = (id: string, patch: Partial<SubjectOverride>) => onChange({ ...overrides, [id]: { ...overrides[id], ...patch } })
  const remove = (id: string) => { const n = { ...overrides }; delete n[id]; onChange(n) }

  return (
    <Panel title={t('manage.wikiAi.settings.overrides')}>
      <div className="flex flex-col sm:flex-row gap-3 mb-3">
        <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('manage.wikiAi.settings.filterOverrides')} aria-label={t('manage.wikiAi.settings.filterOverrides')} className={`${FIELD} sm:w-64`} />
        <div className="relative sm:w-80">
          <input type="search" value={adding} onChange={(e) => setAdding(e.target.value)} placeholder={t('manage.wikiAi.settings.addOverride')} aria-label={t('manage.wikiAi.settings.addOverride')} className={`${FIELD} w-full`} />
          {suggestions.length > 0 && (
            <ul className="absolute z-20 left-0 right-0 mt-1 max-h-56 overflow-y-auto rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface shadow-card-hover">
              {suggestions.map((s) => (
                <li key={s.subjectId}>
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 font-body text-body-sm hover:bg-primary-50 dark:hover:bg-primary-900"
                    onClick={() => { onChange({ ...overrides, [s.subjectId]: overrides[s.subjectId] ?? {} }); setAdding(''); setSuggestions([]) }}
                  >
                    <span className="font-mono text-label text-ink-secondary dark:text-night-muted mr-1.5">{s.subjectId}</span>{s.subjectName}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="py-4 text-center font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.settings.noOverrides')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full font-body text-body-sm">
            <thead><tr>
              <th className={TH}>{t('manage.wikiAi.settings.subject')}</th>
              <th className={TH}>{t('manage.wikiAi.stages.PLAN')}</th>
              <th className={TH}>{t('manage.wikiAi.stages.WRITE')}</th>
              <th className={TH}>{t('manage.wikiAi.settings.paused')}</th>
              <th className={TH} />
            </tr></thead>
            <tbody>
              {rows.map(([id, o]) => (
                <tr key={id} className="border-t border-border dark:border-night-border">
                  <td className={`${TD} font-mono`}>{id}</td>
                  <td className={`${TD} min-w-[14rem]`}>
                    <ModelSelect allowDefault label={`${id} ${t('manage.wikiAi.stages.PLAN')}`} value={o.modelPlan ?? null} models={models} onChange={(v) => update(id, { modelPlan: v })} />
                  </td>
                  <td className={`${TD} min-w-[14rem]`}>
                    <ModelSelect allowDefault label={`${id} ${t('manage.wikiAi.stages.WRITE')}`} value={o.modelWrite ?? null} models={models} onChange={(v) => update(id, { modelWrite: v })} />
                  </td>
                  <td className={TD}>
                    <input type="checkbox" aria-label={`${id} ${t('manage.wikiAi.settings.paused')}`} checked={!!o.paused} onChange={(e) => update(id, { paused: e.target.checked })} className="h-4 w-4 accent-primary" />
                  </td>
                  <td className={TD}><button type="button" onClick={() => remove(id)} className={BTN_DANGER}>{t('manage.delete')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 font-body text-[0.75rem] text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.settings.overridesHint')}</p>
    </Panel>
  )
}
