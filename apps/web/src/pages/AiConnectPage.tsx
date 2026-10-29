import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../hooks/useAuth'
import { fetchApiKeys, revokeApiKey, type ApiKey } from '../api/apiKeys'
import { formatDate } from '../utils/apuntes'
import { Button, ConfirmDialog, ToggleGroup, toast } from '../components/ui'

// How to connect an AI assistant to CEITBA's MCP server (apps/mcp, served at
// <origin>/mcp; opening that URL in a browser redirects here). Assistants
// sign in with OAuth; a signed-in user also sees their connected assistants
// and can disconnect them. Linked from the navbar, the home page and wiki pages.

type Client = 'claude' | 'chatgpt' | 'claudeCode' | 'cursor' | 'vscode'
const CLIENTS: Client[] = ['claude', 'chatgpt', 'claudeCode', 'cursor', 'vscode']

const EXAMPLES = ['schedule', 'classrooms', 'wiki', 'events'] as const

// MCP sign-ins are API keys the MCP server mints per login, named
// "MCP · <client>" (apps/mcp/src/oauth/provider.ts). Other keys are not shown.
const MCP_KEY_PREFIX = 'MCP · '

const serverUrl = () => `${window.location.origin}/mcp`

function snippet(client: Client, url: string): string | null {
  switch (client) {
    case 'claudeCode':
      return `claude mcp add --transport http ceitba ${url}`
    case 'cursor':
      return JSON.stringify({ mcpServers: { ceitba: { url } } }, null, 2)
    case 'vscode':
      return JSON.stringify({ servers: { ceitba: { type: 'http', url } } }, null, 2)
    default:
      return null
  }
}

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
    <div className="flex items-center gap-2 rounded-xs border border-border dark:border-night-border bg-white dark:bg-night-surface p-2 pl-3">
      <pre className="flex-1 min-w-0 overflow-x-auto font-mono text-body-sm text-ink-primary dark:text-night-text whitespace-pre">{text}</pre>
      <Button size="sm" variant="outline" onClick={() => void copy()} aria-label={label}>
        {t('ai.copy')}
      </Button>
    </div>
  )
}

function Step({ n, title, children }: { n: number; title: string; children?: ReactNode }) {
  return (
    <li className="grid grid-cols-[2.5rem_1fr] gap-x-4">
      <span className="font-display font-bold text-h3 leading-none text-primary" aria-hidden="true">{n}</span>
      <div className="flex flex-col gap-3 min-w-0 pb-8">
        <h2 className="font-display font-bold text-h4 text-ink-primary dark:text-night-text leading-tight">{title}</h2>
        {children}
      </div>
    </li>
  )
}

function ConnectedAssistants() {
  const { t, i18n } = useTranslation()
  const [connections, setConnections] = useState<ApiKey[]>([])
  const [revoking, setRevoking] = useState<ApiKey | null>(null)
  const [revokeBusy, setRevokeBusy] = useState(false)

  const load = useCallback(() => {
    fetchApiKeys()
      .then((keys) => setConnections(keys.filter((k) => k.name.startsWith(MCP_KEY_PREFIX))))
      .catch((e) => console.error(e))
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

  // Nothing to manage until an assistant is connected.
  if (connections.length === 0) return null
  const name = (k: ApiKey) => k.name.slice(MCP_KEY_PREFIX.length)

  return (
    <section className="mt-12 lg:mt-4 max-w-2xl" aria-labelledby="ai-connections">
      <h2 id="ai-connections" className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted mb-3">
        {t('ai.connections.title')}
      </h2>
      <ul className="divide-y divide-border dark:divide-night-border border-y border-border dark:border-night-border">
        {connections.map((k) => (
          <li key={k.id} className="flex items-center gap-3 py-3">
            <div className="flex-1 min-w-0">
              <p className="font-body text-body text-ink-primary dark:text-night-text truncate">{name(k)}</p>
              <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">
                {k.lastUsedAt
                  ? t('ai.connections.lastUsed', { date: formatDate(k.lastUsedAt, i18n.language) })
                  : t('ai.connections.connected', { date: formatDate(k.createdAt, i18n.language) })}
              </p>
            </div>
            <Button size="sm" variant="dangerGhost" onClick={() => setRevoking(k)}>
              {t('ai.connections.revoke')}
            </Button>
          </li>
        ))}
      </ul>

      {revoking && (
        <ConfirmDialog
          title={t('ai.connections.revokeTitle', { name: name(revoking) })}
          body={t('ai.connections.revokeBody')}
          confirmLabel={t('ai.connections.revoke')}
          danger
          busy={revokeBusy}
          onConfirm={() => void revoke()}
          onCancel={() => setRevoking(null)}
        />
      )}
    </section>
  )
}

export default function AiConnectPage() {
  const { t } = useTranslation()
  const { profile } = useAuth()
  const [client, setClient] = useState<Client>('claude')
  const url = serverUrl()
  const code = snippet(client, url)

  return (
    <main id="main-content" tabIndex={-1} className="outline-hidden container-content py-section-mobile lg:py-section">
      <header className="mb-10 max-w-2xl">
        <h1 className="font-display font-bold text-h2 text-ink-primary dark:text-night-text">{t('ai.title')}</h1>
        <p className="font-body text-body-lg text-ink-secondary dark:text-night-muted mt-2">{t('ai.subtitle')}</p>
      </header>

      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <ol className="max-w-2xl">
          <Step n={1} title={t('ai.step1')}>
            <CopyBlock text={url} label={t('ai.copyUrl')} />
          </Step>
          <Step n={2} title={t('ai.step2')}>
            <ToggleGroup
              options={CLIENTS.map((c) => ({ value: c, label: t(`ai.clients.${c}.name`) }))}
              value={client}
              onChange={setClient}
              label={t('ai.step2')}
            />
            <p className="font-body text-body text-ink-primary dark:text-night-text" aria-live="polite">{t(`ai.clients.${client}.how`)}</p>
            {code && <CopyBlock text={code} label={t('ai.copy')} />}
          </Step>
          <Step n={3} title={t('ai.step3')}>
            <p className="font-body text-body text-ink-secondary dark:text-night-muted">{t('ai.step3Body')}</p>
          </Step>
        </ol>

        <aside aria-labelledby="ai-examples" className="lg:pt-1">
          <h2 id="ai-examples" className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted mb-3">
            {t('ai.examplesTitle')}
          </h2>
          <ul className="flex flex-col gap-2">
            {EXAMPLES.map((e) => (
              <li key={e} className="rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface px-4 py-3 font-body text-body-sm text-ink-primary dark:text-night-text">
                “{t(`ai.examples.${e}`)}”
              </li>
            ))}
          </ul>
        </aside>
      </div>

      {profile && <ConnectedAssistants />}

      <p className="mt-10 max-w-2xl font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('ai.privacy')}</p>
    </main>
  )
}
