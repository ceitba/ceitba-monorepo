import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  MODEL_STAGES, fetchModels, fetchSettings, fetchSettingsHistory, previewSettingsImpact, probeOk, restoreSettings, saveSettings,
  type CostImpact, type ExecutionMode, type KbModel, type KbSettings, type ModelStage, type SettingsBody, type SubjectOverride,
} from '../../../api/kbAdmin'
import { fetchApunteSubjects, type ApunteSubject } from '../../../api/drive'
import { useDebounced } from '../../../hooks/useDebounced'
import ConfirmDialog from '../../../components/ConfirmDialog'
import { BTN, BTN_DANGER, BTN_PRI, CostImpactDialog, FIELD, Panel, TD, TH, ViewState, isUnavailable, useLoad } from './shared'

const STAGE_FIELD: Record<ModelStage, 'modelDigest' | 'modelPlan' | 'modelWrite' | 'modelRetry'> = {
  digest: 'modelDigest', plan: 'modelPlan', write: 'modelWrite', retry: 'modelRetry',
}
const DAYS = [0, 1, 2, 3, 4, 5, 6] // cron day-of-week, 0 = Sunday

// "batch −50%" from the model's own batch discount.
function batchLabel(m: KbModel, t: (k: string, o?: Record<string, unknown>) => string): string {
  return m.batchDiscount ? t('manage.wikiAi.models.batchBadge', { pct: Math.round(m.batchDiscount * 100) }) : t('manage.wikiAi.models.batchPlain')
}

function priceLabel(m: KbModel): string {
  const p = m.inputPerM != null && m.outputPerM != null ? `$${m.inputPerM}/$${m.outputPerM}` : '$?'
  return p
}

// Pick from the catalog: enabled + successfully probed models only (the
// current value stays selectable so nothing silently changes).
export function ModelSelect({ value, models, onChange, allowDefault, label, mode }: {
  value: string | null | undefined
  models: KbModel[]
  onChange: (id: string | null) => void
  allowDefault?: boolean
  label: string
  mode?: ExecutionMode
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
        {models.map((m) => {
          const usable = m.enabled && probeOk(m) && !(mode === 'batch' && !m.batchSupported)
          return (
            <option key={m.id} value={m.id} disabled={!usable && m.id !== value}>
              {m.displayName || m.id} · {priceLabel(m)} · {m.batchSupported ? batchLabel(m, t) : t('manage.wikiAi.models.syncBadge')}
              {!m.enabled ? ` · ${t('manage.wikiAi.models.disabled')}` : !probeOk(m) ? ` · ${t('manage.wikiAi.models.notProbed')}` : ''}
            </option>
          )
        })}
      </select>
      {current && <ModelBadges m={current} />}
    </div>
  )
}

export function ModelBadges({ m }: { m: KbModel }) {
  const { t } = useTranslation()
  const ok = probeOk(m)
  return (
    <span className="flex flex-wrap items-center gap-1.5 font-mono text-[0.68rem] text-ink-secondary dark:text-night-muted">
      <span>{t('manage.wikiAi.models.pricePer', { input: m.inputPerM ?? '?', output: m.outputPerM ?? '?' })}</span>
      <span className={`px-1 rounded-sm ${m.batchSupported ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-border dark:bg-night-border'}`}>
        {m.batchSupported ? batchLabel(m, t) : t('manage.wikiAi.models.syncBadge')}
      </span>
      <span className={ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}>
        {ok ? `✓ ${t('manage.wikiAi.models.probed')}` : `! ${t('manage.wikiAi.models.notProbed')}`}
      </span>
    </span>
  )
}

// cron "m h * * d" ⇄ day + time; anything else is edited raw.
function parseCron(cron: string): { day: number; time: string } | null {
  const m = /^\s*(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+([0-7])\s*$/.exec(cron ?? '')
  if (!m) return null
  return { day: Number(m[3]) % 7, time: `${m[2].padStart(2, '0')}:${m[1].padStart(2, '0')}` }
}

function toCron(day: number, time: string): string {
  const [h, mi] = time.split(':').map((x) => Number(x) || 0)
  return `${mi} ${h} * * ${day}`
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

  const loadImpact = useCallback(async (): Promise<CostImpact | null> => {
    try {
      const r = await previewSettingsImpact(body())
      return r.costImpact ?? (r.previousWeeklyAvgUsd !== undefined ? { previousWeeklyAvgUsd: r.previousWeeklyAvgUsd ?? null, projectedWeeklyAvgUsd: r.projectedWeeklyAvgUsd ?? null } : null)
    } catch (e) {
      if (isUnavailable(e)) return null
      throw e
    }
  }, [body])

  async function save(note: string) {
    const saved = await saveSettings({ ...body(), note: note || undefined })
    settings.setData(() => saved)
    history.reload()
    return saved.costImpact ?? null
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
                  <label key={st} className="flex flex-col gap-1 min-w-0">
                    <span className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
                      {t(`manage.wikiAi.stages.${st.toUpperCase()}`)}
                      {draft.source?.[STAGE_FIELD[st]] && <span className="ml-2 normal-case tracking-normal">({t(`manage.wikiAi.settings.source.${draft.source[STAGE_FIELD[st]]}`)})</span>}
                    </span>
                    <ModelSelect
                      label={t(`manage.wikiAi.stages.${st.toUpperCase()}`)}
                      value={draft[STAGE_FIELD[st]]}
                      models={catalog}
                      mode={draft.executionMode}
                      onChange={(id) => id && set(STAGE_FIELD[st], id)}
                    />
                  </label>
                ))}
              </div>
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
                        onChange={(e) => set('cron', toCron(Number(e.target.value), parseCron(draft.cron)?.time ?? '03:00'))}
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
                        onChange={(e) => set('cron', toCron(parseCron(draft.cron)?.day ?? 0, e.target.value || '03:00'))}
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
                  <span>{e.changedByName ?? e.changedBy ?? '—'}</span>
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
