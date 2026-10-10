import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../hooks/useAuth'
import { startGoogleSignIn } from '../store/authStore'
import { createApiKey, fetchApiKeys, revokeApiKey, type ApiKey, type CreatedApiKey } from '../api/apiKeys'
import { formatDate } from '../utils/apuntes'
import { Alert, Badge, Button, ConfirmDialog, EmptyState, ErrorState, Modal, SkeletonText, Tabs, toast } from '../components/ui'

// How to connect an AI assistant to CEITBA's MCP server (apps/mcp, served at
// <origin>/mcp; opening that URL in a browser redirects here), plus the
// user's API keys: manual keys for clients without OAuth, and the MCP
// sign-ins ("MCP · <client>"), which can be revoked from here.

type Client = 'claude' | 'chatgpt' | 'claudeCode' | 'cursor' | 'vscode' | 'kiro'
const CLIENTS: Client[] = ['claude', 'chatgpt', 'claudeCode', 'cursor', 'vscode', 'kiro']

const MANUAL_KEY_TTL_DAYS = 90

const serverUrl = () => `${window.location.origin}/mcp`

function snippet(client: Client, url: string): string | null {
  switch (client) {
    case 'claudeCode':
      return `claude mcp add --transport http ceitba ${url}`
    case 'cursor':
    case 'kiro':
      return JSON.stringify({ mcpServers: { ceitba: { url } } }, null, 2)
    case 'vscode':
      return JSON.stringify({ servers: { ceitba: { type: 'http', url } } }, null, 2)
    default:
      return null
  }
}

const STEP_COUNT: Record<Client, number> = { claude: 3, chatgpt: 3, claudeCode: 2, cursor: 1, vscode: 1, kiro: 1 }

function CopyBlock({ text, label }: { text: string; label: string }) {
  const { t } = useTranslation()
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(t('ai.copied'))
    } catch {
      toast.error(t('ai.copyFailed'))
    }
  }
  return (
    <div className="flex items-start gap-2 rounded-sm border border-border dark:border-night-border bg-surface dark:bg-night-bg p-3">
      <pre className="flex-1 min-w-0 overflow-x-auto font-mono text-body-sm text-ink-primary dark:text-night-text whitespace-pre">{text}</pre>
      <Button size="sm" variant="outline" onClick={() => void copy()} aria-label={label}>
        {t('ai.copy')}
      </Button>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="font-display font-bold text-h4 text-ink-primary dark:text-night-text mb-3">{children}</h2>
}

function ApiKeys() {
  const { t, i18n } = useTranslation()
  const [keys, setKeys] = useState<ApiKey[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<CreatedApiKey | null>(null)
  const [revoking, setRevoking] = useState<ApiKey | null>(null)
  const [revokeBusy, setRevokeBusy] = useState(false)

  const load = useCallback(() => {
    setLoadFailed(false)
    fetchApiKeys()
      .then(setKeys)
      .catch((e) => { console.error(e); setLoadFailed(true) })
  }, [])

  useEffect(() => { load() }, [load])

  async function create() {
    setCreating(true)
    try {
      const key = await createApiKey({ name: t('ai.keys.manualName'), ttlDays: MANUAL_KEY_TTL_DAYS, scopes: ['read', 'report'] })
      setCreated(key)
      load()
    } catch (e) {
      console.error(e)
      toast.error(t('ai.keys.createError'))
    } finally {
      setCreating(false)
    }
  }

  async function revoke() {
    if (!revoking) return
    setRevokeBusy(true)
    try {
      await revokeApiKey(revoking.id)
      toast.success(t('ai.keys.revoked'))
      setRevoking(null)
      load()
    } catch (e) {
      console.error(e)
      toast.error(t('ai.keys.revokeError'))
    } finally {
      setRevokeBusy(false)
    }
  }

  const headerSnippet = created
    ? JSON.stringify({ mcpServers: { ceitba: { url: serverUrl(), headers: { Authorization: `Bearer ${created.key}` } } } }, null, 2)
    : ''

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        <p className="flex-1 font-body text-body text-ink-secondary dark:text-night-muted">
          {t('ai.keys.body', { days: MANUAL_KEY_TTL_DAYS })}
        </p>
        <Button onClick={() => void create()} loading={creating} loadingLabel={t('ai.keys.creating')}>
          {t('ai.keys.create')}
        </Button>
      </div>

      {loadFailed ? (
        <ErrorState compact message={t('ai.keys.loadError')} onRetry={load} />
      ) : keys == null ? (
        <SkeletonText lines={2} />
      ) : keys.length === 0 ? (
        <EmptyState compact title={t('ai.keys.empty')} />
      ) : (
        <ul className="divide-y divide-border dark:divide-night-border border border-border dark:border-night-border rounded-card bg-white dark:bg-night-surface">
          {keys.map((k) => (
            <li key={k.id} className="flex flex-col sm:flex-row sm:items-center gap-3 p-4">
              <div className="flex-1 min-w-0">
                <p className="font-body text-body text-ink-primary dark:text-night-text truncate">{k.name}</p>
                <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">
                  {t('ai.keys.meta', {
                    created: formatDate(k.createdAt, i18n.language),
                    expires: formatDate(k.expiresAt, i18n.language),
                    used: k.lastUsedAt ? formatDate(k.lastUsedAt, i18n.language) : t('ai.keys.never'),
                  })}
                </p>
                <div className="flex flex-wrap gap-1 mt-2">
                  {k.scopes.map((s) => <Badge key={s}>{t(`ai.scopes.${s}`)}</Badge>)}
                </div>
              </div>
              <Button size="sm" variant="dangerGhost" onClick={() => setRevoking(k)}>
                {t('ai.keys.revoke')}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {created && (
        <Modal
          title={t('ai.keys.createdTitle')}
          onClose={() => setCreated(null)}
          size="lg"
          footer={<Button onClick={() => setCreated(null)}>{t('ai.keys.done')}</Button>}
        >
          <div className="flex flex-col gap-4">
            <Alert tone="warning">{t('ai.keys.createdWarning')}</Alert>
            <CopyBlock text={created.key} label={t('ai.keys.copyKey')} />
            <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('ai.keys.headerHint')}</p>
            <CopyBlock text={headerSnippet} label={t('ai.copySnippet')} />
          </div>
        </Modal>
      )}

      {revoking && (
        <ConfirmDialog
          title={t('ai.keys.revokeTitle')}
          body={t('ai.keys.revokeBody', { name: revoking.name })}
          confirmLabel={t('ai.keys.revoke')}
          danger
          busy={revokeBusy}
          onConfirm={() => void revoke()}
          onCancel={() => setRevoking(null)}
        />
      )}
    </>
  )
}

export default function AiConnectPage() {
  const { t } = useTranslation()
  const { profile, loading } = useAuth()
  const [client, setClient] = useState<Client>('claude')
  const url = serverUrl()
  const code = snippet(client, url)

  return (
    <main id="main-content" tabIndex={-1} className="outline-none container-content py-section-mobile lg:py-section">
      <header className="mb-8">
        <h1 className="font-display font-bold text-h2 text-ink-primary dark:text-night-text">{t('ai.title')}</h1>
        <p className="font-body text-body text-ink-secondary dark:text-night-muted mt-1 max-w-prose">{t('ai.subtitle')}</p>
      </header>

      <section className="mb-10">
        <SectionTitle>{t('ai.serverTitle')}</SectionTitle>
        <CopyBlock text={url} label={t('ai.copyUrl')} />
        <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted mt-3 max-w-prose">{t('ai.consentNote')}</p>
      </section>

      <section className="mb-10">
        <SectionTitle>{t('ai.whatTitle')}</SectionTitle>
        <ul className="list-disc pl-5 flex flex-col gap-2 font-body text-body text-ink-primary dark:text-night-text max-w-prose">
          <li>{t('ai.what.public')}</li>
          <li>{t('ai.what.signedIn')}</li>
          <li>{t('ai.what.apuntes')}</li>
          <li>{t('ai.what.report')}</li>
          <li>{t('ai.what.staff')}</li>
        </ul>
      </section>

      <section className="mb-10">
        <SectionTitle>{t('ai.clientsTitle')}</SectionTitle>
        <Tabs
          items={CLIENTS.map((c) => ({ id: c, label: t(`ai.clients.${c}.name`) }))}
          active={client}
          onChange={setClient}
          label={t('ai.clientsTitle')}
          idPrefix="ai-client"
          className="mb-4"
        />
        <div role="tabpanel" id={`ai-client-panel-${client}`} aria-labelledby={`ai-client-tab-${client}`} className="flex flex-col gap-4 max-w-prose">
          <ol className="list-decimal pl-5 flex flex-col gap-2 font-body text-body text-ink-primary dark:text-night-text">
            {Array.from({ length: STEP_COUNT[client] }, (_, i) => (
              <li key={i}>{t(`ai.clients.${client}.step${i + 1}`, { url })}</li>
            ))}
          </ol>
          {code && <CopyBlock text={code} label={t('ai.copySnippet')} />}
          {client === 'chatgpt' && <Alert tone="info">{t('ai.clients.chatgpt.note')}</Alert>}
        </div>
      </section>

      <section className="mb-10">
        <SectionTitle>{t('ai.keys.title')}</SectionTitle>
        {loading ? (
          <SkeletonText lines={2} />
        ) : profile ? (
          <ApiKeys />
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <p className="flex-1 font-body text-body text-ink-secondary dark:text-night-muted">{t('ai.keys.signInHint')}</p>
            <Button onClick={() => startGoogleSignIn('/ia')}>{t('auth.signIn')}</Button>
          </div>
        )}
      </section>

      <section>
        <SectionTitle>{t('ai.privacyTitle')}</SectionTitle>
        <p className="font-body text-body text-ink-secondary dark:text-night-muted max-w-prose">{t('ai.privacy')}</p>
      </section>
    </main>
  )
}
