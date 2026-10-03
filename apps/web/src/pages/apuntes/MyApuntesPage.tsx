import '../../i18nApuntes'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import {
  deleteSource,
  fetchDriveInfo,
  fetchMySources,
  patchSource,
  syncSource,
  type DriveInfo,
  type DriveSource,
} from '../../api/drive'
import { ApiError } from '../../api/client'
import { apuntesErrorMessage, formatDateTime } from '../../utils/apuntes'
import ConfirmDialog from '../../components/ConfirmDialog'
import ErrorBanner from '../../components/ErrorBanner'
import Notice from '../../components/Notice'
import ConnectWizard from '../../components/apuntes/ConnectWizard'
import EmptyState from '../../components/apuntes/EmptyState'
import SourceTreeView from '../../components/apuntes/SourceTreeView'
import { SourceStatusBadge } from '../../components/apuntes/Badges'
import { BTN_DANGER_LINK, BTN_OUTLINE, BTN_PRIMARY } from '../../components/apuntes/buttons'

// /apuntes/mis-apuntes — the student's connected Drive folders ("sources"):
// connect a new one, sync, toggle anonymous, disconnect, and assign subjects
// per file in the selected source's tree (?fuente=<id>).
export default function MyApuntesPage() {
  const { t, i18n } = useTranslation()
  const [params, setParams] = useSearchParams()
  const selectedId = params.get('fuente')

  const [info, setInfo] = useState<DriveInfo | null>(null)
  const [unconfigured, setUnconfigured] = useState(false)
  const [sources, setSources] = useState<DriveSource[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null) // `${action}:${sourceId}`
  const [wizardOpen, setWizardOpen] = useState(false)
  const [disconnecting, setDisconnecting] = useState<DriveSource | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    const [infoRes, sourcesRes] = await Promise.allSettled([fetchDriveInfo(), fetchMySources()])
    if (infoRes.status === 'fulfilled') {
      setInfo(infoRes.value)
      setUnconfigured(false)
    } else if (infoRes.reason instanceof ApiError && infoRes.reason.code === 'DRIVE_SYNC_UNCONFIGURED') {
      setUnconfigured(true)
    }
    if (sourcesRes.status === 'fulfilled') {
      setSources(sourcesRes.value)
    } else if (sourcesRes.reason instanceof ApiError && sourcesRes.reason.code === 'DRIVE_SYNC_UNCONFIGURED') {
      setUnconfigured(true)
      setSources([])
    } else {
      setLoadError(apuntesErrorMessage(sourcesRes.reason, t))
    }
    if (infoRes.status === 'rejected' && sourcesRes.status === 'fulfilled' &&
        !(infoRes.reason instanceof ApiError && infoRes.reason.code === 'DRIVE_SYNC_UNCONFIGURED')) {
      setLoadError(apuntesErrorMessage(infoRes.reason, t))
    }
    setLoading(false)
  }, [t])

  useEffect(() => { void load() }, [load])

  function select(id: string | null) {
    const next = new URLSearchParams(params)
    if (id) next.set('fuente', id)
    else next.delete('fuente')
    setParams(next, { replace: true })
  }

  function replaceSource(updated: DriveSource) {
    setSources((list) => list && list.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)))
  }

  async function sync(s: DriveSource) {
    setError(null); setNotice(null); setBusy(`sync:${s.id}`)
    try {
      await syncSource(s.id)
      setNotice(t('apuntes.mine.syncQueued', { name: s.rootName }))
    } catch (e) {
      setError(apuntesErrorMessage(e, t))
    } finally {
      setBusy(null)
    }
  }

  async function toggleAnonymous(s: DriveSource) {
    setError(null); setNotice(null); setBusy(`anon:${s.id}`)
    try {
      replaceSource(await patchSource(s.id, { anonymous: !s.anonymous }))
    } catch (e) {
      setError(apuntesErrorMessage(e, t))
    } finally {
      setBusy(null)
    }
  }

  async function confirmDisconnect() {
    if (!disconnecting) return
    const s = disconnecting
    setError(null); setNotice(null); setBusy(`delete:${s.id}`)
    try {
      await deleteSource(s.id)
      setSources((list) => list && list.filter((x) => x.id !== s.id))
      if (selectedId === s.id) select(null)
      setNotice(t('apuntes.mine.disconnected', { name: s.rootName }))
    } catch (e) {
      setError(apuntesErrorMessage(e, t))
    } finally {
      setDisconnecting(null)
      setBusy(null)
    }
  }

  function onConnected(source: DriveSource) {
    setWizardOpen(false)
    setSources((list) => [source, ...(list ?? []).filter((s) => s.id !== source.id)])
    setNotice(t('apuntes.mine.connected', { name: source.rootName }))
    select(source.id)
  }

  const list = sources ?? []
  const selected = list.find((s) => s.id === selectedId) ?? null

  return (
    <main id="main-content" tabIndex={-1} className="outline-none container-content py-section-mobile lg:py-section">
      <nav aria-label={t('apuntes.breadcrumbAria')} className="mb-4 font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
        <Link to="/apuntes" className="hover:text-primary">{t('apuntes.title')}</Link>
        <span aria-hidden="true" className="mx-2">/</span>
        <span>{t('apuntes.mine.title')}</span>
      </nav>

      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
        <div className="max-w-2xl">
          <h1 className="font-display font-bold text-h3 lg:text-h2 text-ink-primary dark:text-night-text">
            {t('apuntes.mine.title')}
          </h1>
          <p className="font-body text-body text-ink-secondary dark:text-night-muted mt-2">
            {t('apuntes.mine.subtitle')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setWizardOpen(true)}
          disabled={!info || unconfigured}
          className={BTN_PRIMARY}
        >
          {t('apuntes.mine.connect')}
        </button>
      </header>

      <div className="flex flex-col gap-3 mb-6 empty:hidden">
        {unconfigured && <ErrorBanner>{t('apuntes.errors.DRIVE_SYNC_UNCONFIGURED')}</ErrorBanner>}
        {loadError && (
          <ErrorBanner>
            {loadError}{' '}
            <button type="button" onClick={() => void load()} className="underline font-semibold">{t('errors.retry')}</button>
          </ErrorBanner>
        )}
        {error && <ErrorBanner onDismiss={() => setError(null)}>{error}</ErrorBanner>}
        {notice && <Notice onDismiss={() => setNotice(null)}>{notice}</Notice>}
      </div>

      {loading && sources == null && (
        <div className="flex flex-col gap-3" aria-busy="true" aria-hidden="true">
          {Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-32 rounded-card skeleton" />)}
        </div>
      )}

      {!loading && sources != null && list.length === 0 && !unconfigured && (
        <EmptyState
          title={t('apuntes.mine.emptyTitle')}
          body={t('apuntes.mine.emptyBody')}
          action={info ? (
            <button type="button" onClick={() => setWizardOpen(true)} className={BTN_PRIMARY}>
              {t('apuntes.mine.connect')}
            </button>
          ) : undefined}
        />
      )}

      {list.length > 0 && (
        <ul className="flex flex-col gap-4">
          {list.map((s) => {
            const isSelected = s.id === selectedId
            return (
              <li
                key={s.id}
                className={`rounded-card border bg-white dark:bg-night-surface ${isSelected ? 'border-primary shadow-card' : 'border-border dark:border-night-border'}`}
              >
                <div className="p-5 flex flex-col gap-4">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-display font-bold text-h5 text-ink-primary dark:text-night-text break-words">
                          {s.rootName}
                        </h2>
                        <SourceStatusBadge status={s.status} />
                        {s.anonymous && (
                          <span className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
                            {t('apuntes.mine.anonymousOn')}
                          </span>
                        )}
                      </div>
                      <p className="font-mono text-label text-ink-secondary dark:text-night-muted mt-1">
                        {s.lastSyncedAt
                          ? t('apuntes.mine.lastSync', { date: formatDateTime(s.lastSyncedAt, i18n.language) })
                          : t('apuntes.mine.neverSynced')}
                      </p>
                      {s.status !== 'ACTIVE' && (
                        <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted mt-2 max-w-2xl">
                          {t(`apuntes.mine.statusHint.${s.status}`, { defaultValue: '' })}
                        </p>
                      )}
                      {s.lastError && (
                        <p className="font-body text-body-sm text-red-600 dark:text-red-400 mt-2">
                          {t('apuntes.mine.lastError', { error: s.lastError })}
                        </p>
                      )}
                    </div>
                    <dl className="grid grid-cols-3 gap-4 text-center sm:text-right flex-shrink-0">
                      <Stat label={t('apuntes.mine.files')} value={s.fileCount} />
                      <Stat label={t('apuntes.mine.published')} value={s.publishedCount} />
                      <Stat label={t('apuntes.mine.inReview')} value={s.needsReviewCount} />
                    </dl>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-border dark:border-night-border">
                    <button
                      type="button"
                      onClick={() => select(isSelected ? null : s.id)}
                      aria-expanded={isSelected}
                      className={isSelected ? BTN_PRIMARY : BTN_OUTLINE}
                    >
                      {isSelected ? t('apuntes.mine.hideFiles') : t('apuntes.mine.showFiles')}
                    </button>
                    <button
                      type="button"
                      onClick={() => sync(s)}
                      disabled={busy === `sync:${s.id}`}
                      className={BTN_OUTLINE}
                    >
                      {busy === `sync:${s.id}` ? '…' : t('apuntes.mine.syncNow')}
                    </button>
                    <label className="inline-flex items-center gap-2 min-h-[40px] px-2 cursor-pointer font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
                      <input
                        type="checkbox"
                        checked={s.anonymous}
                        disabled={busy === `anon:${s.id}`}
                        onChange={() => toggleAnonymous(s)}
                        className="h-4 w-4 accent-primary"
                      />
                      {t('apuntes.mine.anonymousToggle')}
                    </label>
                    <button
                      type="button"
                      onClick={() => setDisconnecting(s)}
                      disabled={busy === `delete:${s.id}`}
                      className={`${BTN_DANGER_LINK} sm:ml-auto`}
                    >
                      {t('apuntes.mine.disconnect')}
                    </button>
                  </div>
                </div>

                {isSelected && (
                  <div className="px-2 sm:px-5 pb-5">
                    <SourceTreeView sourceId={s.id} onSourceLoaded={replaceSource} />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {selectedId && sources != null && !selected && !loading && (
        <p className="mt-4 font-body text-body-sm text-ink-secondary dark:text-night-muted">
          {t('apuntes.mine.sourceMissing')}
        </p>
      )}

      {wizardOpen && info && (
        <ConnectWizard info={info} onClose={() => setWizardOpen(false)} onConnected={onConnected} />
      )}

      {disconnecting && (
        <ConfirmDialog
          title={t('apuntes.mine.disconnectTitle')}
          body={t('apuntes.mine.disconnectBody', { name: disconnecting.rootName })}
          confirmLabel={t('apuntes.mine.disconnectConfirm')}
          danger
          busy={busy === `delete:${disconnecting.id}`}
          onConfirm={confirmDisconnect}
          onCancel={() => setDisconnecting(null)}
        />
      )}
    </main>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">{label}</dt>
      <dd className="font-display font-bold text-h4 text-ink-primary dark:text-night-text">{value ?? 0}</dd>
    </div>
  )
}
