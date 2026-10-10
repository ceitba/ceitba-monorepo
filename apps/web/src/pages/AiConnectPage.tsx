import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../hooks/useAuth'
import { startGoogleSignIn } from '../store/authStore'
import { fetchApiKeys, revokeApiKey, type ApiKey } from '../api/apiKeys'
import { formatDate } from '../utils/apuntes'
import { Alert, Badge, Button, ConfirmDialog, EmptyState, ErrorState, SkeletonText, Tabs, toast } from '../components/ui'

// How to connect an AI assistant to CEITBA's MCP server (apps/mcp, served at
// <origin>/mcp; opening that URL in a browser redirects here). Assistants
// sign in with OAuth; signed-in users see their connected assistants here and
// can disconnect them.

type Client = 'claude' | 'chatgpt' | 'claudeCode' | 'cursor' | 'vscode' | 'kiro'
const CLIENTS: Client[] = ['claude', 'chatgpt', 'claudeCode', 'cursor', 'vscode', 'kiro']

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

// MCP sign-ins are API keys the MCP server mints per login, named
// "MCP · <client>" (apps/mcp/src/oauth/provider.ts). Other keys are not shown.
const MCP_KEY_PREFIX = 'MCP · '

function ConnectedAssistants() {
  const { t, i18n } = useTranslation()
  const [connections, setConnections] = useState<ApiKey[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [revoking, setRevoking] = useState<ApiKey | null>(null)
  const [revokeBusy, setRevokeBusy] = useState(false)

  const load = useCallback(() => {
    setLoadFailed(false)
    fetchApiKeys()
      .then((keys) => setConnections(keys.filter((k) => k.name.startsWith(MCP_KEY_PREFIX))))
      .catch((e) => { console.error(e); setLoadFailed(true) })
  }, [])

  useEffect(() => { load() }, [load])

  async function revoke() {
    if (!revoking) return
    setRevokeBusy(true)
    try {
      await revokeApiKey(revoking.id)
      toast.success(t('ai.connections.revoked'))
      setRevoking(null)
      load()
    } catch (e) {
      console.error(e)
      toast.error(t('ai.connections.revokeError'))
    } finally {
      setRevokeBusy(false)
    }
  }

  return (
    <>
      <p className="font-body text-body text-ink-secondary dark:text-night-muted mb-4 max-w-prose">{t('ai.connections.body')}</p>

      {loadFailed ? (
        <ErrorState compact message={t('ai.connections.loadError')} onRetry={load} />
      ) : connections == null ? (
        <SkeletonText lines={2} />
      ) : connections.length === 0 ? (
        <EmptyState compact title={t('ai.connections.empty')} />
      ) : (
        <ul className="divide-y divide-border dark:divide-night-border border border-border dark:border-night-border rounded-card bg-white dark:bg-night-surface">
          {connections.map((k) => (
            <li key={k.id} className="flex flex-col sm:flex-row sm:items-center gap-3 p-4">
              <div className="flex-1 min-w-0">
                <p className="font-body text-body text-ink-primary dark:text-night-text truncate">
                  {k.name.slice(MCP_KEY_PREFIX.length)}
                </p>
                <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">
                  {t('ai.connections.meta', {
                    created: formatDate(k.createdAt, i18n.language),
                    expires: formatDate(k.expiresAt, i18n.language),
                    used: k.lastUsedAt ? formatDate(k.lastUsedAt, i18n.language) : t('ai.connections.never'),
                  })}
                </p>
                <div className="flex flex-wrap gap-1 mt-2">
                  {(k.scopes ?? []).map((s) => <Badge key={s}>{t(`ai.scopes.${s}`)}</Badge>)}
                </div>
              </div>
              <Button size="sm" variant="dangerGhost" onClick={() => setRevoking(k)}>
                {t('ai.connections.revoke')}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {revoking && (
        <ConfirmDialog
          title={t('ai.connections.revokeTitle')}
          body={t('ai.connections.revokeBody', { name: revoking.name.slice(MCP_KEY_PREFIX.length) })}
          confirmLabel={t('ai.connections.revoke')}
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
        <div role="tabpanel" id={`ai-client-panel-${client}`} aria-labelledby={`ai-client-tab-${client}`} className="flex flex-col gap-4">
          <ol className="list-decimal pl-5 flex flex-col gap-2 font-body text-body text-ink-primary dark:text-night-text max-w-prose">
            {Array.from({ length: STEP_COUNT[client] }, (_, i) => (
              <li key={i}>{t(`ai.clients.${client}.step${i + 1}`, { url })}</li>
            ))}
          </ol>
          {code && <CopyBlock text={code} label={t('ai.copySnippet')} />}
          {client === 'chatgpt' && <Alert tone="info">{t('ai.clients.chatgpt.note')}</Alert>}
        </div>
      </section>

      <section className="mb-10">
        <SectionTitle>{t('ai.connections.title')}</SectionTitle>
        {loading ? (
          <SkeletonText lines={2} />
        ) : profile ? (
          <ConnectedAssistants />
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <p className="flex-1 font-body text-body text-ink-secondary dark:text-night-muted">{t('ai.connections.signInHint')}</p>
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
