import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { connectCeitbaSender, disconnectSenderAccount, listSenderAccounts } from '../../api/digests'
import { formatArtDateTime } from '../../utils/digest'
import ConfirmDialog from './ConfirmDialog'

const btnBase = 'min-h-[44px] px-5 inline-flex items-center justify-center font-body text-body-sm font-semibold rounded-sm transition-colors duration-150 disabled:opacity-60 disabled:cursor-not-allowed'
const primaryBtn = `${btnBase} bg-primary text-surface hover:bg-primary-600`
const accentBtn = `${btnBase} bg-accent text-ink-primary hover:bg-accent-500`
const dangerBtn = `${btnBase} bg-white border border-border text-red-600 hover:bg-red-50 hover:border-red-300`

// The Gmail account the weekly digest is sent from. Missing → prominent
// notice + connect button; broken → warning + reconnect; connected → details
// + disconnect. `refreshKey` re-fetches (after returning from Google).
export default function DigestSenderCard({ refreshKey = 0, onChanged }) {
  const { t, i18n } = useTranslation()
  const [accounts, setAccounts] = useState(null)
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
      .catch(() => { if (req === reqRef.current) setFailed(true) })
  }, [])

  useEffect(() => { load() }, [load, refreshKey])

  async function handleConnect() {
    setConnecting(true)
    setError('')
    try {
      const { authorizationUrl } = await connectCeitbaSender()
      // Whole-window navigation; the button stays disabled until we leave.
      window.location.assign(authorizationUrl)
    } catch {
      setError(t('admin.digests.sender.connectError'))
      setConnecting(false)
    }
  }

  async function handleDisconnect(id) {
    setDisconnecting(true)
    setError('')
    try {
      await disconnectSenderAccount(id)
      setConfirming(false)
      await load()
      onChanged?.()
    } catch {
      setConfirming(false)
      setError(t('admin.digests.sender.disconnectError'))
    } finally {
      setDisconnecting(false)
    }
  }

  if (failed && !accounts) {
    return (
      <p className="font-body text-body-sm text-ink-secondary">
        {t('admin.digests.sender.loadError')}{' '}
        <button type="button" onClick={load} className="text-primary underline underline-offset-2">{t('admin.common.retry')}</button>
      </p>
    )
  }
  if (!accounts) return null

  const account = accounts.find((a) => a.ownerType === 'ceitba' && a.status !== 'revoked')
  const state = account ? account.status : 'missing' // 'connected' | 'broken' | 'missing'
  const when = (iso) => formatArtDateTime(iso, i18n.language)

  const errorBox = error && (
    <p role="alert" className="font-body text-body-sm text-red-600 bg-red-50 px-3 py-2 rounded-sm">{error}</p>
  )

  if (state === 'missing') {
    return (
      <section
        className="bg-accent-50 rounded-card border border-accent shadow-card p-4 sm:p-5 flex flex-col gap-3"
        aria-label={t('admin.digests.sender.title')}
      >
        <h2 className="font-display text-h5 font-bold text-ink-primary">{t('admin.digests.sender.missingTitle')}</h2>
        <p className="font-body text-body-sm text-ink-primary max-w-2xl">{t('admin.digests.sender.missingBody')}</p>
        <p className="font-body text-body-sm text-ink-secondary max-w-2xl">{t('admin.digests.sender.help')}</p>
        {errorBox}
        <div>
          <button type="button" onClick={handleConnect} disabled={connecting} className={`${accentBtn} w-full sm:w-auto`}>
            {connecting ? t('admin.digests.sender.connecting') : t('admin.digests.sender.connect')}
          </button>
        </div>
      </section>
    )
  }

  const broken = state === 'broken'

  return (
    <section
      className={`bg-white rounded-card border shadow-card p-4 sm:p-5 flex flex-col gap-3 ${broken ? 'border-accent' : 'border-border'}`}
      aria-label={t('admin.digests.sender.title')}
    >
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="min-w-0 flex flex-col gap-1">
          <p className="font-mono text-label text-ink-secondary uppercase tracking-widest">{t('admin.digests.sender.title')}</p>
          <p className="font-body text-body font-semibold text-ink-primary break-all">{account.email}</p>
          <p className={`font-body text-body-sm font-semibold ${broken ? 'text-accent-700' : 'text-emerald-700'}`}>
            {t(`admin.digests.sender.status.${state}`)}
          </p>
          {account.connectedAt && (
            <p className="font-body text-body-sm text-ink-secondary">
              {t('admin.digests.sender.connectedAt', { when: when(account.connectedAt) })}
            </p>
          )}
          <p className="font-body text-body-sm text-ink-secondary">
            {account.lastUsedAt
              ? t('admin.digests.sender.lastUsedAt', { when: when(account.lastUsedAt) })
              : t('admin.digests.sender.neverUsed')}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 sm:flex-shrink-0">
          {broken && (
            <button type="button" onClick={handleConnect} disabled={connecting} className={primaryBtn}>
              {connecting ? t('admin.digests.sender.connecting') : t('admin.digests.sender.reconnect')}
            </button>
          )}
          <button type="button" onClick={() => setConfirming(true)} disabled={connecting || disconnecting} className={dangerBtn}>
            {t('admin.digests.sender.disconnect')}
          </button>
        </div>
      </div>
      {broken && (
        <div role="status" className="font-body text-body-sm text-accent-700 bg-accent-50 px-3 py-2 rounded-sm">
          <p>{t('admin.digests.sender.brokenBody')}</p>
          {account.lastError && (
            <p className="mt-1 font-mono text-label break-words">{t('admin.digests.sender.lastError', { error: account.lastError })}</p>
          )}
          <p className="mt-1">{t('admin.digests.sender.help')}</p>
        </div>
      )}
      {errorBox}
      {confirming && (
        <ConfirmDialog
          tone="danger"
          title={t('admin.digests.sender.disconnectDialog.title')}
          confirmLabel={disconnecting ? t('admin.digests.sender.disconnecting') : t('admin.digests.sender.disconnectDialog.confirm')}
          cancelLabel={t('admin.common.cancel')}
          busy={disconnecting}
          onConfirm={() => handleDisconnect(account.id)}
          onClose={() => setConfirming(false)}
        >
          {t('admin.digests.sender.disconnectDialog.body', { email: account.email })}
        </ConfirmDialog>
      )}
    </section>
  )
}
