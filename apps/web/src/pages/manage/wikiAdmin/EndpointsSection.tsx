import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  deleteEndpoint, discoverEndpointModels, fetchEndpoints, testEndpoint,
  type EndpointDiscoverResult, type EndpointTestResult, type KbEndpoint,
} from '../../../api/kbAdmin'
import { Alert, Badge, Button, ConfirmDialog, EmptyState, ErrorState, LoadingRegion, Skeleton } from '@/components/ui'
import { apuntesAdminErrorMessage } from '../adminErrors'
import EndpointForm from './EndpointForm'
import EndpointStats from './EndpointStats'
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
      setError(apuntesAdminErrorMessage(err, t))
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
      setError(apuntesAdminErrorMessage(err, t))
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
      setToDelete(null)
      list.reload()
      onModelsChanged()
    } catch (err) {
      setError(apuntesAdminErrorMessage(err, t))
    } finally {
      setBusy(null)
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
        <Button size="sm" onClick={() => setForm('new')}>{t('manage.wikiAi.endpoints.add')}</Button>
      </div>
      {error && !toDelete && <Alert tone="error" onDismiss={() => setError(null)}>{error}</Alert>}
      {list.loading && list.data == null ? (
        <LoadingRegion><Skeleton className="h-24 rounded-card" /></LoadingRegion>
      ) : list.error && list.data == null ? (
        <ErrorState compact title={t('manage.errors.loadFailed')} message={list.error} onRetry={list.reload} />
      ) : items.length === 0 ? (
        <EmptyState compact title={t('manage.wikiAi.endpoints.empty')} body={t('manage.wikiAi.endpoints.emptyBody')} />
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((e) => {
            const o = outcomes[e.id]
            return (
              <li key={e.id} className="rounded-card border border-border dark:border-night-border p-4 flex flex-col gap-3">
                <div className="flex flex-col gap-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-ink-primary dark:text-night-text break-all">{e.name}</p>
                    <Badge tone={e.hasKey ? 'success' : 'neutral'}>
                      {e.hasKey ? t('manage.wikiAi.endpoints.tokenSaved') : t('manage.wikiAi.endpoints.noToken')}
                    </Badge>
                    <Badge tone={e.enabled ? 'success' : 'warning'}>
                      {e.enabled ? t('manage.wikiAi.endpoints.enabled') : t('manage.wikiAi.endpoints.disabled')}
                    </Badge>
                  </div>
                  {e.hasKey && e.keyReadable === false && (
                    <Alert tone="warning" title={t('manage.wikiAi.endpoints.tokenUnreadable')}>{t('manage.wikiAi.endpoints.tokenUnreadableHint')}</Alert>
                  )}
                  <p className="font-mono text-label text-ink-secondary dark:text-night-muted break-all">{e.baseUrl}</p>
                  <p className="font-body text-label text-ink-secondary dark:text-night-muted">
                    {t('manage.wikiAi.endpoints.concurrency')}: {e.maxConcurrency} · {t('manage.wikiAi.endpoints.timeout')}: {e.timeoutSec}s · {t('manage.wikiAi.endpoints.models', { count: e.modelCount })}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => test(e)} disabled={busy !== null} loading={busy === `test:${e.id}`} loadingLabel={t('manage.wikiAi.endpoints.testing')}>
                    {t('manage.wikiAi.endpoints.test')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => discover(e)} disabled={busy !== null} loading={busy === `discover:${e.id}`} loadingLabel={t('manage.wikiAi.endpoints.discovering')}>
                    {t('manage.wikiAi.endpoints.discover')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setForm(e)} disabled={busy !== null}>{t('manage.wikiAi.endpoints.edit')}</Button>
                  <Button variant="dangerGhost" size="sm" onClick={() => { setError(null); setToDelete(e) }} disabled={busy !== null}>
                    {t('manage.wikiAi.endpoints.delete')}
                  </Button>
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
          error={error}
          onConfirm={remove}
          onCancel={() => { setToDelete(null); setError(null) }}
        />
      )}
    </section>
  )
}

function Result({ ok, onClose, children }: { ok: boolean; onClose: () => void; children: ReactNode }) {
  return (
    <Alert tone={ok ? 'success' : 'error'} onDismiss={onClose}>
      <div className="min-w-0 flex flex-col gap-1">{children}</div>
    </Alert>
  )
}

function TestOutcome({ r, onClose }: { r: EndpointTestResult; onClose: () => void }) {
  const { t } = useTranslation()
  return (
    <Result ok={r.ok} onClose={onClose}>
      <p className="font-semibold">
        {r.ok ? t('manage.wikiAi.endpoints.testOk', { ms: Math.round(r.latencyMs ?? 0) }) : t('manage.wikiAi.endpoints.testFail')}
      </p>
      {r.error && <p className="font-mono text-label break-words">{r.error}</p>}
      {r.ok && (r.models.length > 0 ? (
        <>
          <p>{t('manage.wikiAi.endpoints.testModels', { count: r.models.length })}</p>
          <p className="font-mono text-label break-all">{r.models.join(' · ')}</p>
        </>
      ) : <p>{t('manage.wikiAi.endpoints.noModels')}</p>)}
    </Result>
  )
}

function DiscoverOutcome({ r, onClose }: { r: EndpointDiscoverResult; onClose: () => void }) {
  const { t } = useTranslation()
  return (
    <Result ok onClose={onClose}>
      <p className="font-semibold">{t('manage.wikiAi.endpoints.discoverResult', { added: r.added.length, existing: r.existing.length })}</p>
      {r.added.length > 0 && <p className="font-mono text-label break-all">{r.added.join(' · ')}</p>}
      <p className="text-label">{t('manage.wikiAi.endpoints.discoverHint')}</p>
    </Result>
  )
}
