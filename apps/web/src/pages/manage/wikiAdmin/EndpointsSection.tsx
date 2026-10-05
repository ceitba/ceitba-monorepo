import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  deleteEndpoint, discoverEndpointModels, fetchEndpoints, testEndpoint,
  type EndpointDiscoverResult, type EndpointTestResult, type KbEndpoint,
} from '../../../api/kbAdmin'
import ConfirmDialog from '../../../components/ConfirmDialog'
import ErrorBanner from '../../../components/ErrorBanner'
import { apuntesErrorMessage } from '../../../utils/apuntes'
import EndpointForm from './EndpointForm'
import EndpointStats from './EndpointStats'
import { BTN, BTN_PRI } from './styles'
import { useLoad } from './useLoad'

type Outcome = { test?: EndpointTestResult; discover?: EndpointDiscoverResult }

// "Endpoints propios": staff-registered OpenAI-compatible servers (e.g. a
// GPU running llama.cpp). Hidden quietly while the API doesn't have them.
export default function EndpointsSection({ onModelsChanged }: { onModelsChanged: () => void }) {
  const { t } = useTranslation()
  const list = useLoad(fetchEndpoints)
  const [form, setForm] = useState<KbEndpoint | 'new' | null>(null)
  const [toDelete, setToDelete] = useState<KbEndpoint | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({})

  if (list.unavailable) return null

  function setOutcome(id: string, o: Outcome | null) {
    setOutcomes((all) => {
      const next = { ...all }
      if (o) next[id] = o
      else delete next[id]
      return next
    })
  }

  async function test(e: KbEndpoint) {
    setError(null); setBusy(`test:${e.id}`)
    try {
      setOutcome(e.id, { test: await testEndpoint(e.id) })
    } catch (err) {
      setError(apuntesErrorMessage(err, t))
    } finally {
      setBusy(null)
    }
  }

  async function discover(e: KbEndpoint) {
    setError(null); setBusy(`discover:${e.id}`)
    try {
      setOutcome(e.id, { discover: await discoverEndpointModels(e.id) })
      list.reload()
      onModelsChanged()
    } catch (err) {
      setError(apuntesErrorMessage(err, t))
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    if (!toDelete) return
    setError(null); setBusy(`delete:${toDelete.id}`)
    try {
      await deleteEndpoint(toDelete.id)
      setOutcome(toDelete.id, null)
      list.reload()
      onModelsChanged()
    } catch (err) {
      setError(apuntesErrorMessage(err, t))
    } finally {
      setBusy(null)
      setToDelete(null)
    }
  }

  const items = list.data ?? []
  return (
    <section className="flex flex-col gap-3 mt-4" aria-labelledby="own-endpoints-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="max-w-2xl">
          <h3 id="own-endpoints-title" className="font-display text-h5 text-ink-primary dark:text-night-text">{t('manage.wikiAi.endpoints.title')}</h3>
          <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.endpoints.intro')}</p>
        </div>
        <button type="button" onClick={() => setForm('new')} className={BTN_PRI}>{t('manage.wikiAi.endpoints.add')}</button>
      </div>
      {(error || list.error) && <ErrorBanner onDismiss={() => setError(null)}>{error ?? list.error}</ErrorBanner>}
      {list.loading && list.data == null ? (
        <div aria-busy="true" className="h-24 rounded-card skeleton" />
      ) : items.length === 0 ? (
        <p className="px-4 py-6 rounded-card border border-border dark:border-night-border text-center font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.endpoints.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((e) => {
            const o = outcomes[e.id]
            return (
              <li key={e.id} className="rounded-card border border-border dark:border-night-border p-4 flex flex-col gap-3">
                <div className="flex flex-col gap-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-ink-primary dark:text-night-text break-all">{e.name}</p>
                    <span className={`px-2 py-0.5 rounded-sm font-mono text-[0.68rem] uppercase tracking-widest ${e.hasKey ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-page-bg dark:bg-night-bg text-ink-secondary dark:text-night-muted'}`}>
                      {e.hasKey ? t('manage.wikiAi.endpoints.tokenSaved') : t('manage.wikiAi.endpoints.noToken')}
                    </span>
                    <span className={`px-2 py-0.5 rounded-sm font-mono text-[0.68rem] uppercase tracking-widest ${e.enabled ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'}`}>
                      {e.enabled ? t('manage.wikiAi.endpoints.enabled') : t('manage.wikiAi.endpoints.disabled')}
                    </span>
                  </div>
                  <p className="font-mono text-label text-ink-secondary dark:text-night-muted break-all">{e.baseUrl}</p>
                  <p className="font-body text-[0.78rem] text-ink-secondary dark:text-night-muted">
                    {t('manage.wikiAi.endpoints.concurrency')}: {e.maxConcurrency} · {t('manage.wikiAi.endpoints.timeout')}: {e.timeoutSec}s · {t('manage.wikiAi.endpoints.models', { count: e.modelCount })}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => test(e)} disabled={busy !== null} className={BTN}>
                    {busy === `test:${e.id}` ? t('manage.wikiAi.endpoints.testing') : t('manage.wikiAi.endpoints.test')}
                  </button>
                  <button type="button" onClick={() => discover(e)} disabled={busy !== null} className={BTN}>
                    {busy === `discover:${e.id}` ? t('manage.wikiAi.endpoints.discovering') : t('manage.wikiAi.endpoints.discover')}
                  </button>
                  <button type="button" onClick={() => setForm(e)} disabled={busy !== null} className={BTN}>{t('manage.wikiAi.endpoints.edit')}</button>
                  <button type="button" onClick={() => setToDelete(e)} disabled={busy !== null} className="px-3 py-1.5 rounded-sm font-mono text-label uppercase tracking-widest text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50">
                    {t('manage.wikiAi.endpoints.delete')}
                  </button>
                </div>
                {o?.test && <TestOutcome r={o.test} onClose={() => setOutcome(e.id, null)} />}
                {o?.discover && <DiscoverOutcome r={o.discover} onClose={() => setOutcome(e.id, null)} />}
                <EndpointStats id={e.id} />
              </li>
            )
          })}
        </ul>
      )}
      {form && (
        <EndpointForm
          endpoint={form === 'new' ? null : form}
          onClose={() => setForm(null)}
          onSaved={() => { setForm(null); list.reload() }}
        />
      )}
      {toDelete && (
        <ConfirmDialog
          title={t('manage.wikiAi.endpoints.deleteTitle')}
          body={t('manage.wikiAi.endpoints.deleteBody', { name: toDelete.name })}
          confirmLabel={t('manage.wikiAi.endpoints.deleteConfirm')}
          busy={busy === `delete:${toDelete.id}`}
          onConfirm={remove}
          onCancel={() => setToDelete(null)}
        />
      )}
    </section>
  )
}

function Result({ ok, onClose, children }: { ok: boolean; onClose: () => void; children: React.ReactNode }) {
  const { t } = useTranslation()
  return (
    <div role="status" className={`rounded-sm border p-3 flex items-start justify-between gap-3 font-body text-body-sm ${ok ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50/60 dark:bg-emerald-950/30' : 'border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40'}`}>
      <div className="min-w-0 flex flex-col gap-1">{children}</div>
      <button type="button" onClick={onClose} aria-label={t('manage.wikiAi.endpoints.close')} className="leading-none text-h5 opacity-60 hover:opacity-100">×</button>
    </div>
  )
}

function TestOutcome({ r, onClose }: { r: EndpointTestResult; onClose: () => void }) {
  const { t } = useTranslation()
  return (
    <Result ok={r.ok} onClose={onClose}>
      <p className={`font-semibold ${r.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600 dark:text-red-400'}`}>
        {r.ok ? `✓ ${t('manage.wikiAi.endpoints.testOk', { ms: Math.round(r.latencyMs ?? 0) })}` : `✕ ${t('manage.wikiAi.endpoints.testFail')}`}
      </p>
      {r.error && <p className="text-red-600 dark:text-red-400 break-words">{r.error}</p>}
      {r.ok && (r.models.length > 0 ? (
        <>
          <p className="text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.endpoints.testModels', { count: r.models.length })}</p>
          <p className="font-mono text-label break-all">{r.models.join(' · ')}</p>
        </>
      ) : <p className="text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.endpoints.noModels')}</p>)}
    </Result>
  )
}

function DiscoverOutcome({ r, onClose }: { r: EndpointDiscoverResult; onClose: () => void }) {
  const { t } = useTranslation()
  return (
    <Result ok onClose={onClose}>
      <p className="font-semibold">{t('manage.wikiAi.endpoints.discoverResult', { added: r.added.length, existing: r.existing.length })}</p>
      {r.added.length > 0 && <p className="font-mono text-label break-all">{r.added.join(' · ')}</p>}
      <p className="text-[0.78rem] text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.endpoints.discoverHint')}</p>
    </Result>
  )
}
