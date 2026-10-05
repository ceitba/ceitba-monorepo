import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { createEndpoint, updateEndpoint, type KbEndpoint, type KbEndpointInput } from '../../../api/kbAdmin'
import ErrorBanner from '../../../components/ErrorBanner'
import Modal from '../../../components/Modal'
import { apuntesErrorMessage } from '../../../utils/apuntes'
import { BTN_PRI, FIELD } from './styles'

// Create / edit form for an own LLM endpoint. The stored token is never
// shown: on edit, blank keeps it and "quitar token" removes it.
export default function EndpointForm({ endpoint, onSaved, onClose }: {
  endpoint: KbEndpoint | null
  onSaved: (e: KbEndpoint) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(endpoint?.name ?? '')
  const [baseUrl, setBaseUrl] = useState(endpoint?.baseUrl ?? '')
  const [apiKey, setApiKey] = useState('')
  const [removeKey, setRemoveKey] = useState(false)
  const [maxConcurrency, setMaxConcurrency] = useState(String(endpoint?.maxConcurrency ?? 4))
  const [timeoutSec, setTimeoutSec] = useState(String(endpoint?.timeoutSec ?? 120))
  const [enabled, setEnabled] = useState(endpoint?.enabled ?? true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(ev: FormEvent) {
    ev.preventDefault()
    setBusy(true); setError(null)
    const body: KbEndpointInput = {
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      maxConcurrency: Math.min(64, Math.max(1, Math.round(Number(maxConcurrency) || 1))),
      timeoutSec: Math.max(1, Math.round(Number(timeoutSec) || 1)),
      enabled,
    }
    if (removeKey) body.apiKey = ''
    else if (apiKey.trim()) body.apiKey = apiKey.trim()
    try {
      onSaved(endpoint ? await updateEndpoint(endpoint.id, body) : await createEndpoint(body))
    } catch (e) {
      setError(apuntesErrorMessage(e, t))
      setBusy(false)
    }
  }

  const label = 'flex flex-col gap-1 font-body text-body-sm'
  const span = 'font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted'
  return (
    <Modal
      title={endpoint ? t('manage.wikiAi.endpoints.formEdit') : t('manage.wikiAi.endpoints.formCreate')}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className="px-3 py-1.5 font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">{t('manage.cancel')}</button>
          <button type="submit" form="endpoint-form" disabled={busy} className={BTN_PRI}>{busy ? '…' : t('manage.wikiAi.endpoints.save')}</button>
        </>
      }
    >
      <form id="endpoint-form" onSubmit={submit} className="flex flex-col gap-3">
        {error && <ErrorBanner onDismiss={() => setError(null)}>{error}</ErrorBanner>}
        <label className={label}>
          <span className={span}>{t('manage.wikiAi.endpoints.name')}</span>
          <input required value={name} onChange={(e) => setName(e.target.value)} className={FIELD} autoComplete="off" />
        </label>
        <label className={label}>
          <span className={span}>{t('manage.wikiAi.endpoints.baseUrl')}</span>
          <input required type="url" inputMode="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={t('manage.wikiAi.endpoints.baseUrlPlaceholder')} className={`${FIELD} font-mono`} autoComplete="off" />
        </label>
        <div className="flex flex-col gap-1 font-body text-body-sm">
          <label className={label}>
            <span className={span}>{t('manage.wikiAi.endpoints.token')}</span>
            <input type="password" value={apiKey} onChange={(e) => { setApiKey(e.target.value); if (e.target.value) setRemoveKey(false) }} disabled={removeKey} autoComplete="new-password" className={FIELD} />
          </label>
          {endpoint?.hasKey && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[0.75rem] text-ink-secondary dark:text-night-muted">
                {removeKey ? t('manage.wikiAi.endpoints.tokenWillRemove') : t('manage.wikiAi.endpoints.tokenKeep')}
              </span>
              <label className="inline-flex items-center gap-1.5 cursor-pointer text-[0.78rem]">
                <input type="checkbox" checked={removeKey} onChange={(e) => { setRemoveKey(e.target.checked); if (e.target.checked) setApiKey('') }} className="h-4 w-4 accent-primary" />
                {t('manage.wikiAi.endpoints.tokenRemove')}
              </label>
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className={label}>
            <span className={span}>{t('manage.wikiAi.endpoints.maxConcurrency')}</span>
            <input type="number" min={1} max={64} required value={maxConcurrency} onChange={(e) => setMaxConcurrency(e.target.value)} className={`${FIELD} tabular-nums`} />
          </label>
          <label className={label}>
            <span className={span}>{t('manage.wikiAi.endpoints.timeoutSec')}</span>
            <input type="number" min={1} required value={timeoutSec} onChange={(e) => setTimeoutSec(e.target.value)} className={`${FIELD} tabular-nums`} />
          </label>
        </div>
        <label className="inline-flex items-center gap-2 cursor-pointer font-body text-body-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 accent-primary" />
          {t('manage.wikiAi.endpoints.enabledField')}
        </label>
        <p className="px-3 py-2 rounded-sm bg-page-bg dark:bg-night-bg font-body text-[0.78rem] text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.endpoints.formNote')}</p>
      </form>
    </Modal>
  )
}
