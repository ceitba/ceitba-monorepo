import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { createEndpoint, updateEndpoint, type KbEndpoint, type KbEndpointInput } from '../../../api/kbAdmin'
import { Alert, Button, Field, Modal, inputClass } from '@/components/ui'
import { apuntesAdminErrorMessage } from '../adminErrors'

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
      setError(apuntesAdminErrorMessage(e, t))
      setBusy(false)
    }
  }

  return (
    <Modal
      title={endpoint ? t('manage.wikiAi.endpoints.formEdit') : t('manage.wikiAi.endpoints.formCreate')}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{t('manage.cancel')}</Button>
          <Button type="submit" form="endpoint-form" loading={busy}>{t('manage.wikiAi.endpoints.save')}</Button>
        </>
      }
    >
      <form id="endpoint-form" onSubmit={submit} className="flex flex-col gap-3">
        {error && <Alert tone="error" onDismiss={() => setError(null)}>{error}</Alert>}
        <Field label={t('manage.wikiAi.endpoints.name')} required>
          {(p) => <input {...p} value={name} onChange={(e) => setName(e.target.value)} className={inputClass()} autoComplete="off" />}
        </Field>
        <Field label={t('manage.wikiAi.endpoints.baseUrl')} required>
          {(p) => <input {...p} type="url" inputMode="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={t('manage.wikiAi.endpoints.baseUrlPlaceholder')} className={inputClass({ className: 'font-mono' })} autoComplete="off" />}
        </Field>
        <div className="flex flex-col gap-1 font-body text-body-sm">
          <Field label={t('manage.wikiAi.endpoints.token')} hint={endpoint?.hasKey ? (removeKey ? t('manage.wikiAi.endpoints.tokenWillRemove') : t('manage.wikiAi.endpoints.tokenKeep')) : undefined}>
            {(p) => <input {...p} type="password" value={apiKey} onChange={(e) => { setApiKey(e.target.value); if (e.target.value) setRemoveKey(false) }} disabled={removeKey} autoComplete="new-password" className={inputClass()} />}
          </Field>
          {endpoint?.hasKey && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-2 min-h-[44px] cursor-pointer text-body-sm text-ink-primary dark:text-night-text">
                <input type="checkbox" checked={removeKey} onChange={(e) => { setRemoveKey(e.target.checked); if (e.target.checked) setApiKey('') }} className="h-4 w-4 accent-primary" />
                {t('manage.wikiAi.endpoints.tokenRemove')}
              </label>
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={t('manage.wikiAi.endpoints.maxConcurrency')} required>
            {(p) => <input {...p} type="number" min={1} max={64} value={maxConcurrency} onChange={(e) => setMaxConcurrency(e.target.value)} className={inputClass({ className: 'tabular-nums' })} />}
          </Field>
          <Field label={t('manage.wikiAi.endpoints.timeoutSec')} required>
            {(p) => <input {...p} type="number" min={1} value={timeoutSec} onChange={(e) => setTimeoutSec(e.target.value)} className={inputClass({ className: 'tabular-nums' })} />}
          </Field>
        </div>
        <label className="inline-flex items-center gap-2 min-h-[44px] cursor-pointer font-body text-body-sm text-ink-primary dark:text-night-text">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 accent-primary" />
          {t('manage.wikiAi.endpoints.enabledField')}
        </label>
        <p className="px-3 py-2 rounded-sm bg-page-bg dark:bg-night-bg font-body text-label text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.endpoints.formNote')}</p>
      </form>
    </Modal>
  )
}
