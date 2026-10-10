import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { connectCeitbaSender, disconnectSenderAccount, listSenderAccounts } from '../../api/digests'
import { formatArtDateTime } from '../../utils/digest'
import { Alert, Button, ConfirmDialog, LoadingRegion, Skeleton } from '@/components/ui'
import type { IsoDateTime, SenderAccount } from '../../types'

interface DigestSenderCardProps {
  refreshKey?: number
  onChanged?: () => void
}

// The Gmail account the weekly digest is sent from. Missing → prominent
// notice + connect button; broken → warning + reconnect; connected → details
// + disconnect. `refreshKey` re-fetches (after returning from Google).
export default function DigestSenderCard({ refreshKey = 0, onChanged }: DigestSenderCardProps) {
  const { t, i18n } = useTranslation()
  const [accounts, setAccounts] = useState<SenderAccount[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [error, setError] = useState('')

  const reqRef = useRef(0)
  const load = useCallback(() => {
    const req = ++reqRef.current
    return listSenderAccounts()
      .then((list) => { if (req === reqRef.current) { setAccounts(list ?? []); setFailed(false) } })
      .catch((err: unknown) => {
        console.error('newsletter admin: sender accounts', err)
        if (req === reqRef.current) setFailed(true)
      })
  }, [])

  useEffect(() => { load() }, [load, refreshKey])

  async function handleConnect() {
    setConnecting(true)
    setError('')
    try {
      const { authorizationUrl } = await connectCeitbaSender()
      // Whole-window navigation; the button stays disabled until we leave.
      window.location.assign(authorizationUrl)
    } catch (err) {
      console.error('newsletter admin: connect sender', err)
      setError(t('admin.digests.sender.connectError'))
      setConnecting(false)
    }
  }

  async function handleDisconnect(id: number) {
    setDisconnecting(true)
    setError('')
    try {
      await disconnectSenderAccount(id)
      setConfirming(false)
      await load()
      onChanged?.()
    } catch (err) {
      console.error('newsletter admin: disconnect sender', err)
      setError(t('admin.digests.sender.disconnectError'))
    } finally {
      setDisconnecting(false)
    }
  }

  if (failed && !accounts) {
    return (
      <Alert tone="error" action={<Button variant="outline" size="sm" onClick={load}>{t('admin.common.retry')}</Button>}>
        {t('admin.digests.sender.loadError')}
      </Alert>
    )
  }
  if (!accounts) {
    return (
      <LoadingRegion>
        <Skeleton className="h-28 w-full rounded-card" />
      </LoadingRegion>
    )
  }

  const account = accounts.find((a) => a.ownerType === 'ceitba' && a.status !== 'revoked')
  const state = account ? account.status : 'missing' // 'connected' | 'broken' | 'missing'
  const when = (iso: IsoDateTime) => formatArtDateTime(iso, i18n.language)

  // Disconnect errors show inside the confirmation dialog instead.
  const errorBox = error && !confirming && <Alert tone="error" onDismiss={() => setError('')}>{error}</Alert>

  if (!account) { // state === 'missing'
    return (
      <section
        className="bg-amber-50 dark:bg-amber-950/40 rounded-card border border-amber-200 dark:border-amber-900 shadow-card p-4 sm:p-5 flex flex-col gap-3"
        aria-label={t('admin.digests.sender.title')}
      >
        <h3 className="font-display text-h5 font-bold text-ink-primary dark:text-night-text">{t('admin.digests.sender.missingTitle')}</h3>
        <p className="font-body text-body-sm text-ink-primary dark:text-night-text max-w-2xl">{t('admin.digests.sender.missingBody')}</p>
        <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted max-w-2xl">{t('admin.digests.sender.help')}</p>
        {errorBox}
        <div>
          <Button variant="accent" onClick={handleConnect} loading={connecting} loadingLabel={t('admin.digests.sender.connecting')} className="w-full sm:w-auto">
            {t('admin.digests.sender.connect')}
          </Button>
        </div>
      </section>
    )
  }

  const broken = state === 'broken'

  return (
    <section
      className={`bg-white dark:bg-night-surface rounded-card border shadow-card p-4 sm:p-5 flex flex-col gap-3 ${broken ? 'border-amber-300 dark:border-amber-800' : 'border-border dark:border-night-border'}`}
      aria-label={t('admin.digests.sender.title')}
    >
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="min-w-0 flex flex-col gap-1">
          <h3 className="font-mono text-label text-ink-secondary dark:text-night-muted uppercase tracking-widest">{t('admin.digests.sender.title')}</h3>
          <p className="font-body text-body font-semibold text-ink-primary dark:text-night-text break-all">{account.email}</p>
          <p className={`font-body text-body-sm font-semibold ${broken ? 'text-amber-800 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
            {t(`admin.digests.sender.status.${state}`)}
          </p>
          {account.connectedAt && (
            <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">
              {t('admin.digests.sender.connectedAt', { when: when(account.connectedAt) })}
            </p>
          )}
          <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">
            {account.lastUsedAt
              ? t('admin.digests.sender.lastUsedAt', { when: when(account.lastUsedAt) })
              : t('admin.digests.sender.neverUsed')}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 sm:flex-shrink-0">
          {broken && (
            <Button variant="accent" onClick={handleConnect} loading={connecting} loadingLabel={t('admin.digests.sender.connecting')}>
              {t('admin.digests.sender.reconnect')}
            </Button>
          )}
          <Button variant="dangerGhost" onClick={() => { setError(''); setConfirming(true) }} disabled={connecting || disconnecting}>
            {t('admin.digests.sender.disconnect')}
          </Button>
        </div>
      </div>
      {broken && (
        <Alert tone="warning">
          <p>{t('admin.digests.sender.brokenBody')}</p>
          <p className="mt-1">{t('admin.digests.sender.help')}</p>
        </Alert>
      )}
      {errorBox}
      {confirming && (
        <ConfirmDialog
          title={t('admin.digests.sender.disconnectDialog.title')}
          body={t('admin.digests.sender.disconnectDialog.body', { email: account.email })}
          confirmLabel={t('admin.digests.sender.disconnectDialog.confirm')}
          busy={disconnecting}
          error={error || undefined}
          onConfirm={() => handleDisconnect(account.id)}
          onCancel={() => { setConfirming(false); setError('') }}
        />
      )}
    </section>
  )
}
