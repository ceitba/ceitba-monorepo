import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { effectivePrices, fetchForecast, fetchModels, parseCustomModel, probeModel, probeOk, syncModels, updateModel, sortModels, type KbModel, type ModelSyncResult } from '../../../api/kbAdmin'
import { apuntesErrorMessage } from '../../../utils/apuntes'
import ErrorBanner from '../../../components/ErrorBanner'
import Notice from '../../../components/Notice'
import { ViewState } from './shared'
import EndpointsSection from './EndpointsSection'
import { pct } from './format'
import { BTN, FIELD, TD, TH } from './styles'
import { useLoad } from './useLoad'

// Modelos: the catalog with editable prices, enable toggle, batch flag and
// probe result; "Probar" per model and "Sincronizar con DigitalOcean".
export default function ModelsView() {
  const { t } = useTranslation()
  const models = useLoad(fetchModels)
  const forecast = useLoad(fetchForecast)
  const estimateFlag = forecast.data?.discountIsEstimate ?? false
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [syncResult, setSyncResult] = useState<ModelSyncResult | null>(null)

  function replace(m: KbModel) {
    models.setData((list) => list && list.map((x) => (x.id === m.id ? { ...x, ...m } : x)))
  }

  async function patch(m: KbModel, body: Partial<KbModel>) {
    setError(null); setBusy(`save:${m.id}`)
    // A hand-edited price becomes "manual" (the API marks it; show it now).
    const priceEdit = ['inputPerM', 'outputPerM', 'cacheReadPerM'].some((k) => k in body)
    replace({ ...m, ...body, ...(priceEdit ? { priceSource: 'manual' as const, pricesUpdatedAt: new Date().toISOString() } : {}) })
    try {
      replace(await updateModel(m.id, body))
    } catch (e) {
      replace(m)
      setError(apuntesErrorMessage(e, t))
    } finally {
      setBusy(null)
    }
  }

  async function probe(m: KbModel) {
    setError(null); setNotice(null); setBusy(`probe:${m.id}`)
    try {
      const r = await probeModel(m.id)
      if ((r as KbModel).id) replace(r as KbModel)
      else replace({ ...m, lastProbe: r as KbModel['lastProbe'] })
      models.reload()
    } catch (e) {
      setError(apuntesErrorMessage(e, t))
    } finally {
      setBusy(null)
    }
  }

  async function sync() {
    setError(null); setNotice(null); setBusy('sync')
    try {
      const r = await syncModels()
      setSyncResult(r ?? {})
      models.reload()
    } catch (e) {
      setError(apuntesErrorMessage(e, t))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted max-w-2xl">{t('manage.wikiAi.models.intro')}</p>
        <button type="button" onClick={sync} disabled={busy === 'sync' || models.unavailable} className={BTN}>
          {busy === 'sync' ? '…' : t('manage.wikiAi.models.sync')}
        </button>
      </div>
      {error && <ErrorBanner onDismiss={() => setError(null)}>{error}</ErrorBanner>}
      {notice && <Notice onDismiss={() => setNotice(null)}>{notice}</Notice>}
      {syncResult && <SyncResult r={syncResult} names={new Map((models.data ?? []).map((m) => [m.id, m.displayName || m.id]))} onClose={() => setSyncResult(null)} />}
      <ViewState state={models} skeleton="rows" empty={(m) => m.length === 0} emptyText={t('manage.wikiAi.models.empty')}>
        {(list) => (
          <div className="overflow-x-auto rounded-card border border-border dark:border-night-border">
            <table className="w-full font-body text-body-sm">
              <thead className="bg-page-bg dark:bg-night-bg"><tr>
                <th className={TH}>{t('manage.wikiAi.models.model')}</th>
                <th className={TH} colSpan={3}>{t('manage.wikiAi.prices.list')}<span className="block normal-case tracking-normal font-body text-[0.7rem]">{t('manage.wikiAi.prices.inOutCache')}</span></th>
                <th className={TH}>{t('manage.wikiAi.prices.batch')}<span className="block normal-case tracking-normal font-body text-[0.7rem]">{t('manage.wikiAi.prices.effective')}</span></th>
                <th className={TH}>{t('manage.wikiAi.models.enabled')}</th>
                <th className={TH}>{t('manage.wikiAi.models.probe')}</th>
              </tr></thead>
              <tbody>
                {sortModels(list).map((m) => (
                  <tr key={m.id} className="border-t border-border dark:border-night-border">
                    <td className={`${TD} min-w-[13rem]`}>
                      <p className="font-semibold text-ink-primary dark:text-night-text">{m.displayName || m.id}</p>
                      <p className="font-mono text-label text-ink-secondary dark:text-night-muted break-all">{m.id} · {parseCustomModel(m.id) ? t('manage.wikiAi.endpoints.providerOwn') : m.provider}</p>
                      {parseCustomModel(m.id) && <p className="font-body text-[0.72rem] text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.endpoints.endpointName', { name: parseCustomModel(m.id)!.endpoint })}</p>}
                      {m.remoteModelId && <p className="font-mono text-label text-ink-secondary dark:text-night-muted break-all">{t('manage.wikiAi.endpoints.remoteId', { id: m.remoteModelId })}</p>}
                      {m.contextWindow && <p className="font-mono text-label text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.models.context', { k: Math.round(m.contextWindow / 1000) })}</p>}
                      <PriceSourceLine m={m} />
                    </td>
                    {(['inputPerM', 'outputPerM', 'cacheReadPerM'] as const).map((f) => (
                      <td key={f} className={TD}>
                        <PriceInput value={m[f]} label={`${m.id} ${f}`} onCommit={(v) => patch(m, { [f]: v })} />
                      </td>
                    ))}
                    <td className={`${TD} min-w-[11rem]`}>
                      <BatchCell m={m} estimate={estimateFlag} onToggle={(v) => patch(m, { batchSupported: v })} onDiscount={(d) => patch(m, { batchDiscount: d })} />
                    </td>
                    <td className={TD}>
                      <input type="checkbox" aria-label={`${m.id} ${t('manage.wikiAi.models.enabled')}`} checked={m.enabled} onChange={(e) => patch(m, { enabled: e.target.checked })} className="h-4 w-4 accent-primary" />
                    </td>
                    <td className={`${TD} min-w-[12rem]`}>
                      <ProbeResult m={m} />
                      {m.emptyToolCallRate != null && (
                        <p
                          className={`font-body text-[0.78rem] ${m.emptyToolCallRate > 0.05 ? 'text-amber-700 dark:text-amber-300' : 'text-ink-secondary dark:text-night-muted'}`}
                          title={t('manage.wikiAi.metrics.emptyToolCallHint')}
                        >
                          {t('manage.wikiAi.metrics.emptyToolCallRate')}: {pct(m.emptyToolCallRate, 1)}
                        </p>
                      )}
                      {m.supportsReasoningEffort && (
                        <p className="font-mono text-[0.68rem] text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.reasoning.supported')}</p>
                      )}
                      <button type="button" onClick={() => probe(m)} disabled={busy === `probe:${m.id}`} className={`${BTN} mt-1`}>
                        {busy === `probe:${m.id}` ? t('manage.wikiAi.models.probing') : t('manage.wikiAi.models.probeBtn')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ViewState>
      <EndpointsSection onModelsChanged={models.reload} />
    </div>
  )
}

function PriceInput({ value, label, onCommit }: { value: number | null; label: string; onCommit: (v: number | null) => void }) {
  const [text, setText] = useState(value == null ? '' : String(value))
  return (
    <input
      type="number"
      min={0}
      step={0.01}
      aria-label={label}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const next = text === '' ? null : Number(text)
        if (next !== value && (next == null || Number.isFinite(next))) onCommit(next)
      }}
      className={`${FIELD} w-24 tabular-nums`}
    />
  )
}

function ProbeResult({ m }: { m: KbModel }) {
  const { t, i18n } = useTranslation()
  const p = m.lastProbe
  if (!p) return <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.models.neverProbed')}</p>
  const ok = probeOk(m)
  return (
    <div className="font-body text-[0.78rem] text-ink-secondary dark:text-night-muted">
      <p className={ok ? 'text-emerald-700 dark:text-emerald-300 font-semibold' : 'text-red-600 dark:text-red-400 font-semibold'}>
        {ok ? `✓ ${t('manage.wikiAi.models.probeOk')}` : `✕ ${t('manage.wikiAi.models.probeFail')}`}
      </p>
      <p>
        {[p.mode, p.toolCalling != null ? `tools: ${String(p.toolCalling)}` : null, p.latencyMs != null ? `${Math.round(p.latencyMs)} ms` : null]
          .filter(Boolean).join(' · ')}
      </p>
      {p.error && <p className="text-red-600 dark:text-red-400 break-words">{p.error}</p>}
      {p.at && <p className="font-mono text-label">{new Date(p.at).toLocaleString(i18n.language)}</p>}
    </div>
  )
}

// Batch column: support toggle, editable discount, the effective batch
// prices and where support came from (default rule or verified by probe).
function BatchCell({ m, estimate, onToggle, onDiscount }: {
  m: KbModel
  estimate: boolean
  onToggle: (v: boolean) => void
  onDiscount: (d: number | null) => void
}) {
  const { t, i18n } = useTranslation()
  const { prices } = effectivePrices(m, 'batch')
  const pctNow = Math.round((m.batchDiscount ?? 0.5) * 100)
  const [text, setText] = useState(String(pctNow))
  const isEstimate = m.batchDiscountVerified === true ? false : m.batchDiscountVerified === false || estimate
  return (
    <div className="flex flex-col gap-1">
      <label className="inline-flex items-center gap-1.5 cursor-pointer">
        <input type="checkbox" aria-label={`${m.id} batch`} checked={m.batchSupported} onChange={(e) => onToggle(e.target.checked)} className="h-4 w-4 accent-primary" />
        {m.batchSupported ? (
          <span className="inline-flex items-center gap-1 font-mono text-label">
            −
            <input
              type="number"
              min={0}
              max={90}
              aria-label={`${m.id} ${t('manage.wikiAi.prices.discount')}`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => { const v = Number(text); if (Number.isFinite(v) && v !== pctNow) onDiscount(v / 100) }}
              className="w-12 px-1 py-0.5 rounded-sm border border-border dark:border-night-border bg-white dark:bg-night-surface tabular-nums"
            />
            %{isEstimate && <span title={t('manage.wikiAi.prices.upTo', { pct: pctNow })}>*</span>}
          </span>
        ) : <span className="font-mono text-label text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.models.syncBadge')}</span>}
      </label>
      {m.batchSupported && (
        <span className="font-mono text-[0.7rem] text-ink-primary dark:text-night-text tabular-nums">
          US$ {prices.inputPerM ?? '?'} / {prices.outputPerM ?? '?'}{prices.cacheReadPerM != null ? ` / ${prices.cacheReadPerM}` : ''}
        </span>
      )}
      {m.batchSource && (
        <span className="font-body text-[0.7rem] text-ink-secondary dark:text-night-muted">
          {m.batchSource === 'probe'
            ? t('manage.wikiAi.prices.sourceProbe', { date: m.batchVerifiedAt ? new Date(m.batchVerifiedAt).toLocaleDateString(i18n.language) : '—' })
            : t('manage.wikiAi.prices.sourceRule')}
        </span>
      )}
    </div>
  )
}

function PriceSourceLine({ m }: { m: KbModel }) {
  const { t, i18n } = useTranslation()
  const date = m.pricesUpdatedAt ? new Date(m.pricesUpdatedAt).toLocaleDateString(i18n.language) : null
  if (m.priceSource === 'do-catalog') {
    return <p className="font-body text-[0.72rem] text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.priceSync.fromDo', { date: date ?? '—' })}</p>
  }
  if (m.priceSource === 'manual') {
    return <p className="font-body text-[0.72rem] text-amber-700 dark:text-amber-300">{t('manage.wikiAi.priceSync.manual', { date: date ?? '—' })}</p>
  }
  return date ? <p className="font-mono text-label text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.models.pricesAt', { date })}</p> : null
}

const FIELD_LABEL: Record<string, string> = { inputPerM: 'input', outputPerM: 'output', cacheReadPerM: 'cache', batchSupported: 'batch', batchDiscount: 'batch −%' }

// Result of "Sincronizar con DigitalOcean": price changes per model
// (old → new), new models, unchanged and not-in-catalog counts.
function SyncResult({ r, names, onClose }: { r: ModelSyncResult; names: Map<string, string>; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const updated = r.updated ?? []
  const unchanged = Array.isArray(r.unchanged) ? r.unchanged.length : r.unchanged ?? null
  return (
    <section role="status" className="rounded-card border border-emerald-200 dark:border-emerald-900 bg-emerald-50/60 dark:bg-emerald-950/30 p-4 flex flex-col gap-3 font-body text-body-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-ink-primary dark:text-night-text">{t('manage.wikiAi.priceSync.title')}</p>
          {r.fetchedAt && (
            <p className="font-mono text-[0.72rem] text-ink-secondary dark:text-night-muted">
              {t('manage.wikiAi.priceSync.fetched', { date: new Date(r.fetchedAt).toLocaleString(i18n.language), source: r.source ?? 'DigitalOcean' })}
            </p>
          )}
        </div>
        <button type="button" onClick={onClose} aria-label={t('errors.dismiss')} className="leading-none text-h5 opacity-60 hover:opacity-100">×</button>
      </div>
      {updated.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {updated.map((u) => (
            <li key={u.id}>
              <span className="font-semibold">{names.get(u.id) ?? u.id}</span>
              <span className="ml-2 font-mono text-[0.72rem] text-ink-secondary dark:text-night-muted">
                {u.changes.map((c) => `${FIELD_LABEL[c.field] ?? c.field}: ${c.old ?? '—'} → ${c.new ?? '—'}`).join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.priceSync.noChanges')}</p>
      )}
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-ink-secondary dark:text-night-muted">
        {(r.added?.length ?? 0) > 0 && <span>{t('manage.wikiAi.priceSync.added', { count: r.added!.length })}</span>}
        {unchanged != null && <span>{t('manage.wikiAi.priceSync.unchanged', { count: unchanged })}</span>}
        {(r.notInCatalog?.length ?? 0) > 0 && <span title={r.notInCatalog!.join(', ')}>{t('manage.wikiAi.priceSync.notInCatalog', { count: r.notInCatalog!.length })}</span>}
      </p>
      <p className="font-body text-[0.75rem] text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.priceSync.historyNote')}</p>
    </section>
  )
}
