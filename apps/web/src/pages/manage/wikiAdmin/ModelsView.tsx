import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchModels, probeModel, probeOk, syncModels, updateModel, type KbModel } from '../../../api/kbAdmin'
import { apuntesErrorMessage } from '../../../utils/apuntes'
import ErrorBanner from '../../../components/ErrorBanner'
import Notice from '../../../components/Notice'
import { BTN, FIELD, TD, TH, ViewState, pct, useLoad } from './shared'

// Modelos: the catalog with editable prices, enable toggle, batch flag and
// probe result; "Probar" per model and "Sincronizar con DigitalOcean".
export default function ModelsView() {
  const { t, i18n } = useTranslation()
  const models = useLoad(fetchModels)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  function replace(m: KbModel) {
    models.setData((list) => list && list.map((x) => (x.id === m.id ? { ...x, ...m } : x)))
  }

  async function patch(m: KbModel, body: Partial<KbModel>) {
    setError(null); setBusy(`save:${m.id}`)
    replace({ ...m, ...body })
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
      const added = Array.isArray(r) ? null : r?.added
      setNotice(added ? t('manage.wikiAi.models.synced', { count: added.length }) : t('manage.wikiAi.models.syncedPlain'))
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
      <ViewState state={models} skeleton="rows" empty={(m) => m.length === 0} emptyText={t('manage.wikiAi.models.empty')}>
        {(list) => (
          <div className="overflow-x-auto rounded-card border border-border dark:border-night-border">
            <table className="w-full font-body text-body-sm">
              <thead className="bg-page-bg dark:bg-night-bg"><tr>
                <th className={TH}>{t('manage.wikiAi.models.model')}</th>
                <th className={TH}>{t('manage.wikiAi.models.input')}</th>
                <th className={TH}>{t('manage.wikiAi.models.output')}</th>
                <th className={TH}>{t('manage.wikiAi.models.cache')}</th>
                <th className={TH}>{t('manage.wikiAi.models.batch')}</th>
                <th className={TH}>{t('manage.wikiAi.models.enabled')}</th>
                <th className={TH}>{t('manage.wikiAi.models.probe')}</th>
              </tr></thead>
              <tbody>
                {list.map((m) => (
                  <tr key={m.id} className="border-t border-border dark:border-night-border">
                    <td className={TD}>
                      <p className="font-semibold text-ink-primary dark:text-night-text">{m.displayName || m.id}</p>
                      <p className="font-mono text-label text-ink-secondary dark:text-night-muted break-all">{m.id}{m.provider ? ` · ${m.provider}` : ''}</p>
                      {m.contextWindow && <p className="font-mono text-label text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.models.context', { k: Math.round(m.contextWindow / 1000) })}</p>}
                      {m.pricesUpdatedAt && <p className="font-mono text-label text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.models.pricesAt', { date: new Date(m.pricesUpdatedAt).toLocaleDateString(i18n.language) })}</p>}
                    </td>
                    {(['inputPerM', 'outputPerM', 'cacheReadPerM'] as const).map((f) => (
                      <td key={f} className={TD}>
                        <PriceInput value={m[f]} label={`${m.id} ${f}`} onCommit={(v) => patch(m, { [f]: v })} />
                      </td>
                    ))}
                    <td className={TD}>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input type="checkbox" checked={m.batchSupported} onChange={(e) => patch(m, { batchSupported: e.target.checked })} className="h-4 w-4 accent-primary" />
                        {m.batchSupported && m.batchDiscount ? <span className="font-mono text-label">−{Math.round(m.batchDiscount * 100)}%</span> : null}
                      </label>
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
