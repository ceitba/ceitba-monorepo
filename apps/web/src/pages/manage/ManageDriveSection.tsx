import '../../i18nApuntes'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  approveSource,
  blockSource,
  fetchStaffFiles,
  fetchStaffSources,
  fetchUnclaimedShares,
  publishStaffFile,
  removeStaffFile,
  restoreStaffFile,
  type Paged,
  type SourceStatus,
  type StaffFile,
  type StaffFileQueue,
  type StaffSource,
  type UnclaimedShare,
} from '../../api/drive'
import { ApiError } from '../../api/client'
import { fetchStaffKbPages, hideKbPage, kbPagePath, restoreKbPage, type KbPageStatus, type StaffKbPage } from '../../api/kb'
import Modal from '../../components/Modal'
import ConfirmDialog from '../../components/ConfirmDialog'
import ErrorBanner from '../../components/ErrorBanner'
import Notice from '../../components/Notice'
import KindIcon from '../../components/apuntes/KindIcon'
import YearBadge from '../../components/apuntes/YearBadge'
import { PublicationBadge, SourceStatusBadge } from '../../components/apuntes/Badges'
import { apuntesErrorMessage, formatDate, formatDateTime } from '../../utils/apuntes'
import CommunityBadge from '../../components/apuntes/CommunityBadge'

const PAGE_SIZE = 20
const SOURCE_STATUSES: (SourceStatus | '')[] = ['PENDING_REVIEW', 'ACTIVE', 'ERROR', 'BLOCKED', 'REVOKED', 'DISCONNECTED', '']
const FILE_QUEUES: StaffFileQueue[] = ['NEEDS_REVIEW', 'HIDDEN_REPORTED']

type View = 'sources' | 'files' | 'wiki' | 'unclaimed'

const TH = 'px-3 py-2 font-mono text-label uppercase tracking-widest'
const ACTION_BTN = 'px-3 py-1 rounded-sm font-mono text-label uppercase tracking-widest border border-border dark:border-night-border hover:border-primary hover:text-primary transition-colors disabled:opacity-50'
const DANGER_BTN = 'text-red-600 dark:text-red-400 font-mono text-label uppercase tracking-widest hover:underline disabled:opacity-50'
const SELECT = 'px-3 py-2 rounded-sm border border-border dark:border-night-border bg-white dark:bg-night-surface font-body text-body-sm'

// STAFF moderation of "Apuntes" (Drive-synced student notes): approve or
// block newly connected folders, review files that need a decision (shared
// by someone other than the owner, or hidden by reports) and see Drive shares
// nobody has claimed yet.
export default function ManageDriveSection() {
  const { t } = useTranslation()
  const [view, setView] = useState<View>('sources')

  const views: { id: View; label: string }[] = [
    { id: 'sources', label: t('manage.drive.views.sources') },
    { id: 'files', label: t('manage.drive.views.files') },
    { id: 'wiki', label: t('manage.drive.views.wiki') },
    { id: 'unclaimed', label: t('manage.drive.views.unclaimed') },
  ]

  return (
    <div className="flex flex-col gap-4">
      <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('manage.drive.intro')}</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('manage.drive.viewsAria')}>
        {views.map((v) => (
          <button
            key={v.id}
            type="button"
            aria-pressed={view === v.id}
            onClick={() => setView(v.id)}
            className={`px-3 py-1.5 rounded-sm font-mono text-label uppercase tracking-widest border transition-colors ${
              view === v.id
                ? 'bg-primary text-white border-primary'
                : 'border-border dark:border-night-border text-ink-secondary dark:text-night-muted hover:text-primary hover:border-primary'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>
      {view === 'sources' && <SourcesView />}
      {view === 'files' && <FilesView />}
      {view === 'wiki' && <WikiView />}
      {view === 'unclaimed' && <UnclaimedView />}
    </div>
  )
}

function Pager({ page, total, loading, onPage, label }: {
  page: number
  total: number
  loading: boolean
  onPage: (p: number) => void
  label: string
}) {
  const { t } = useTranslation()
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  return (
    <div className="flex items-center justify-between gap-2 font-body text-body-sm">
      <span className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
        {t('manage.drive.pageStatus', { page: page + 1, pages: totalPages, total, what: label })}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={page <= 0 || loading}
          onClick={() => onPage(Math.max(0, page - 1))}
          className="px-3 py-1 rounded-sm border border-border dark:border-night-border font-mono text-label uppercase tracking-widest disabled:opacity-40 hover:border-primary hover:text-primary transition-colors"
        >
          {t('manage.users.prev')}
        </button>
        <button
          type="button"
          disabled={page >= totalPages - 1 || loading}
          onClick={() => onPage(Math.min(totalPages - 1, page + 1))}
          className="px-3 py-1 rounded-sm border border-border dark:border-night-border font-mono text-label uppercase tracking-widest disabled:opacity-40 hover:border-primary hover:text-primary transition-colors"
        >
          {t('manage.users.next')}
        </button>
      </div>
    </div>
  )
}

// Generic paged loader with an out-of-order guard (only the latest request
// may write state), like ManageCorrectionsSection.
function usePaged<T>(fetcher: (page: number) => Promise<Paged<T>>, deps: unknown[]) {
  const { t } = useTranslation()
  const [data, setData] = useState<Paged<T> | null>(null)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const reqRef = useRef(0)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  useEffect(() => { setPage(0); setData(null) }, deps) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const id = ++reqRef.current
    setLoading(true)
    fetcherRef.current(page)
      .then((res) => {
        if (reqRef.current !== id) return
        setData({ items: res.items ?? [], total: res.total ?? 0 })
        setLoadError(null)
        const lastPage = Math.max(0, Math.ceil((res.total ?? 0) / PAGE_SIZE) - 1)
        if (page > lastPage) setPage(lastPage)
      })
      .catch((e) => { if (reqRef.current === id) setLoadError(apuntesErrorMessage(e, t)) })
      .finally(() => { if (reqRef.current === id) setLoading(false) })
  }, [page, tick, t, ...deps]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    data, setData, page, setPage, loading, loadError, setLoadError,
    reload: () => setTick((n) => n + 1),
  }
}

// ── Sources ─────────────────────────────────────────────────────────────────

function SourcesView() {
  const { t, i18n } = useTranslation()
  const [status, setStatus] = useState<SourceStatus | ''>('PENDING_REVIEW')
  const { data, setData, page, setPage, loading, loadError, setLoadError, reload } =
    usePaged<StaffSource>((p) => fetchStaffSources({ status, page: p, limit: PAGE_SIZE }), [status])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [blocking, setBlocking] = useState<StaffSource | null>(null)
  const [comment, setComment] = useState('')

  function replaceRow(updated: StaffSource) {
    setData((d) => d && { ...d, items: d.items.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)) })
  }

  function handleError(e: unknown) {
    if (e instanceof ApiError && e.status === 409) {
      setError(t('manage.drive.conflict'))
      reload()
      return
    }
    setError(apuntesErrorMessage(e, t))
  }

  async function approve(s: StaffSource) {
    setError(null); setNotice(null); setBusyId(s.id)
    try {
      replaceRow(await approveSource(s.id))
      setNotice(t('manage.drive.sources.approvedNotice', { name: s.rootName }))
    } catch (e) {
      handleError(e)
    } finally {
      setBusyId(null)
    }
  }

  async function confirmBlock() {
    if (!blocking) return
    const s = blocking
    setError(null); setNotice(null); setBusyId(s.id)
    try {
      replaceRow(await blockSource(s.id, comment.trim() || undefined))
      setNotice(t('manage.drive.sources.blockedNotice', { name: s.rootName }))
      setBlocking(null)
    } catch (e) {
      setBlocking(null)
      handleError(e)
    } finally {
      setBusyId(null)
    }
  }

  const rows = data?.items ?? []

  return (
    <div className="flex flex-col gap-4">
      {error && <ErrorBanner onDismiss={() => setError(null)}>{error}</ErrorBanner>}
      {loadError && <ErrorBanner onDismiss={() => setLoadError(null)}>{loadError}</ErrorBanner>}
      {notice && <Notice onDismiss={() => setNotice(null)}>{notice}</Notice>}

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="drive-source-status" className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
          {t('manage.drive.filterLabel')}
        </label>
        <select
          id="drive-source-status"
          value={status}
          onChange={(e) => { setStatus(e.target.value as SourceStatus | ''); setNotice(null) }}
          className={SELECT}
        >
          {SOURCE_STATUSES.map((s) => (
            <option key={s || 'all'} value={s}>
              {s ? t(`apuntes.sourceStatus.${s}`) : t('manage.drive.allStatuses')}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-card border border-border dark:border-night-border">
        <table className="w-full font-body text-body-sm">
          <thead className="bg-page-bg dark:bg-night-bg">
            <tr className="text-left">
              <th className={TH}>{t('manage.drive.sources.col.folder')}</th>
              <th className={TH}>{t('manage.drive.sources.col.owner')}</th>
              <th className={TH}>{t('manage.drive.sources.col.files')}</th>
              <th className={TH}>{t('manage.drive.sources.col.status')}</th>
              <th className={TH}>{t('manage.drive.col.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const busy = busyId === s.id
              return (
                <tr key={s.id} className="border-t border-border dark:border-night-border align-top">
                  <td className="px-3 py-3">
                    <p className="font-semibold text-ink-primary dark:text-night-text">{s.rootName}</p>
                    <p className="font-mono text-label text-ink-secondary dark:text-night-muted mt-1">
                      {t('manage.drive.sources.connected', { date: formatDate(s.createdAt, i18n.language) })}
                      {s.anonymous && ` · ${t('apuntes.mine.anonymousOn')}`}
                    </p>
                    <p className="font-mono text-label text-ink-secondary dark:text-night-muted">
                      {s.lastSyncedAt
                        ? t('apuntes.mine.lastSync', { date: formatDateTime(s.lastSyncedAt, i18n.language) })
                        : t('apuntes.mine.neverSynced')}
                    </p>
                    {s.lastError && <p className="text-red-600 dark:text-red-400 mt-1">{s.lastError}</p>}
                  </td>
                  <td className="px-3 py-3">
                    {s.community ? (
                      <CommunityBadge />
                    ) : (
                      <>
                        <p className="text-ink-primary dark:text-night-text">{s.ownerName ?? '—'}</p>
                        <p className="font-mono text-label text-ink-secondary dark:text-night-muted break-all">{s.ownerEmail ?? '—'}</p>
                      </>
                    )}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-ink-secondary dark:text-night-muted">
                    {t('manage.drive.sources.counts', { files: s.fileCount, published: s.publishedCount, review: s.needsReviewCount })}
                  </td>
                  <td className="px-3 py-3"><SourceStatusBadge status={s.status} /></td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap items-center gap-3">
                      {s.status !== 'ACTIVE' && s.status !== 'DISCONNECTED' && s.status !== 'REVOKED' && (
                        <button type="button" disabled={busy} onClick={() => approve(s)} className={ACTION_BTN}
                          aria-label={t('manage.drive.sources.approveAria', { name: s.rootName })}>
                          {busy ? '…' : t('manage.drive.sources.approve')}
                        </button>
                      )}
                      {s.status !== 'BLOCKED' && s.status !== 'DISCONNECTED' && (
                        <button type="button" disabled={busy} onClick={() => { setComment(''); setBlocking(s) }} className={DANGER_BTN}
                          aria-label={t('manage.drive.sources.blockAria', { name: s.rootName })}>
                          {t('manage.drive.sources.block')}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
            {loading && rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-ink-secondary dark:text-night-muted">{t('manage.loading')}</td></tr>
            )}
            {!loading && !loadError && rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-ink-secondary dark:text-night-muted">{t('manage.drive.sources.empty')}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Pager page={page} total={data?.total ?? 0} loading={loading} onPage={setPage} label={t('manage.drive.sources.unit')} />

      {blocking && (
        <Modal
          title={t('manage.drive.sources.blockTitle')}
          onClose={() => setBlocking(null)}
          busy={busyId === blocking.id}
          footer={
            <>
              <button type="button" disabled={busyId === blocking.id} onClick={() => setBlocking(null)}
                className="px-3 py-1.5 font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted disabled:opacity-50">
                {t('manage.cancel')}
              </button>
              <button type="button" disabled={busyId === blocking.id} onClick={confirmBlock}
                className="px-3 py-1.5 rounded-sm text-white font-mono text-label uppercase tracking-widest bg-red-600 hover:bg-red-700 disabled:opacity-50">
                {busyId === blocking.id ? '…' : t('manage.drive.sources.blockConfirm')}
              </button>
            </>
          }
        >
          <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">
            {t('manage.drive.sources.blockBody', {
              name: blocking.rootName,
              owner: blocking.community ? t('apuntes.community.label') : (blocking.ownerEmail ?? blocking.ownerName ?? '—'),
            })}
          </p>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
              {t('manage.drive.sources.comment')}
            </span>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              maxLength={1000}
              className="px-3 py-2 rounded-sm border border-border dark:border-night-border bg-white dark:bg-night-surface font-body text-body-sm"
            />
          </label>
        </Modal>
      )}
    </div>
  )
}

// ── Files ───────────────────────────────────────────────────────────────────

type FileAction = 'publish' | 'remove' | 'restore'

function FilesView() {
  const { t, i18n } = useTranslation()
  const [queue, setQueue] = useState<StaffFileQueue>('NEEDS_REVIEW')
  const { data, setData, page, setPage, loading, loadError, setLoadError, reload } =
    usePaged<StaffFile>((p) => fetchStaffFiles({ publication: queue, page: p, limit: PAGE_SIZE }), [queue])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [removing, setRemoving] = useState<StaffFile | null>(null)

  function replaceRow(updated: StaffFile) {
    setData((d) => d && { ...d, items: d.items.map((f) => (f.id === updated.id ? { ...f, ...updated } : f)) })
  }

  async function act(f: StaffFile, action: FileAction) {
    setError(null); setNotice(null); setBusyId(f.id)
    try {
      const fn = action === 'publish' ? publishStaffFile : action === 'remove' ? removeStaffFile : restoreStaffFile
      replaceRow(await fn(f.id))
      setNotice(t(`manage.drive.files.${action}Notice`, { name: f.name }))
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError(t('manage.drive.conflict'))
        reload()
      } else {
        setError(apuntesErrorMessage(e, t))
      }
    } finally {
      setBusyId(null)
      setRemoving(null)
    }
  }

  const rows = data?.items ?? []

  return (
    <div className="flex flex-col gap-4">
      {error && <ErrorBanner onDismiss={() => setError(null)}>{error}</ErrorBanner>}
      {loadError && <ErrorBanner onDismiss={() => setLoadError(null)}>{loadError}</ErrorBanner>}
      {notice && <Notice onDismiss={() => setNotice(null)}>{notice}</Notice>}

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="drive-file-queue" className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
          {t('manage.drive.filterLabel')}
        </label>
        <select
          id="drive-file-queue"
          value={queue}
          onChange={(e) => { setQueue(e.target.value as StaffFileQueue); setNotice(null) }}
          className={SELECT}
        >
          {FILE_QUEUES.map((q) => <option key={q} value={q}>{t(`manage.drive.files.queue.${q}`)}</option>)}
        </select>
      </div>

      <div className="overflow-x-auto rounded-card border border-border dark:border-night-border">
        <table className="w-full font-body text-body-sm">
          <thead className="bg-page-bg dark:bg-night-bg">
            <tr className="text-left">
              <th className={TH}>{t('manage.drive.files.col.file')}</th>
              <th className={TH}>{t('manage.drive.files.col.subject')}</th>
              <th className={TH}>{t('manage.drive.files.col.people')}</th>
              <th className={TH}>{t('manage.drive.files.col.reports')}</th>
              <th className={TH}>{t('manage.drive.col.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => {
              const busy = busyId === f.id
              const pending = f.publication === 'NEEDS_REVIEW' || f.publication === 'HIDDEN_REPORTED'
              return (
                <tr key={f.id} className="border-t border-border dark:border-night-border align-top">
                  <td className="px-3 py-3 min-w-[14rem]">
                    <div className="flex items-start gap-2">
                      <KindIcon kind={f.kind} className="mt-0.5" />
                      <div className="min-w-0">
                        <a
                          href={`${import.meta.env.BASE_URL.replace(/\/+$/, '')}/apuntes/archivo/${encodeURIComponent(f.id)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-semibold text-ink-primary dark:text-night-text hover:text-primary hover:underline break-words"
                        >
                          {f.name}
                        </a>
                        <p className="font-mono text-label text-ink-secondary dark:text-night-muted">
                          {f.sourceRootName}{f.driveModifiedAt && ` · ${formatDate(f.driveModifiedAt, i18n.language)}`}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <PublicationBadge publication={f.publication} />
                          <YearBadge year={f.academicYear} source={f.academicYearSource} />
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    {f.effectiveSubjectId ? (
                      <>
                        <span className="font-mono text-label text-ink-secondary dark:text-night-muted mr-1">{f.effectiveSubjectId}</span>
                        {f.effectiveSubjectName}
                      </>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-3 font-mono text-label text-ink-secondary dark:text-night-muted">
                    <p>{t('manage.drive.files.sharer', { who: f.sharerName ? `${f.sharerName} <${f.sharerEmail ?? ''}>` : (f.sharerEmail ?? '—') })}</p>
                    <p className="mt-0.5">{t('manage.drive.files.owner', { who: f.ownerEmail ?? '—' })}</p>
                    {f.ownerEmail && f.sharerEmail && f.ownerEmail.toLowerCase() !== f.sharerEmail.toLowerCase() && (
                      <p className="mt-1 text-amber-700 dark:text-amber-300 normal-case">{t('manage.drive.files.ownerDiffers')}</p>
                    )}
                  </td>
                  <td className="px-3 py-3 min-w-[12rem]">
                    {f.reportCount > 0 ? (
                      <>
                        <p className="font-semibold text-ink-primary dark:text-night-text">
                          {t('manage.drive.files.reportCount', { count: f.reportCount })}
                        </p>
                        <ul className="mt-1 flex flex-col gap-1">
                          {(f.reports ?? []).map((r, i) => (
                            <li key={i} className="text-ink-secondary dark:text-night-muted">
                              <span className="font-mono text-label uppercase tracking-widest">{t(`apuntes.report.reasons.${r.reason}`)}</span>
                              <span className="font-mono text-label"> · {formatDate(r.createdAt, i18n.language)}</span>
                              {r.comment && <p className="italic break-words">“{r.comment}”</p>}
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : <span className="text-ink-secondary dark:text-night-muted">—</span>}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap items-center gap-3">
                      {f.publication === 'NEEDS_REVIEW' && (
                        <button type="button" disabled={busy} onClick={() => act(f, 'publish')} className={ACTION_BTN}>
                          {busy ? '…' : t('manage.drive.files.publish')}
                        </button>
                      )}
                      {(f.publication === 'HIDDEN_REPORTED' || f.publication === 'REMOVED_BY_STAFF') && (
                        <button type="button" disabled={busy} onClick={() => act(f, 'restore')} className={ACTION_BTN}>
                          {busy ? '…' : t('manage.drive.files.restore')}
                        </button>
                      )}
                      {(pending || f.publication === 'PUBLISHED') && (
                        <button type="button" disabled={busy} onClick={() => setRemoving(f)} className={DANGER_BTN}>
                          {t('manage.drive.files.remove')}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
            {loading && rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-ink-secondary dark:text-night-muted">{t('manage.loading')}</td></tr>
            )}
            {!loading && !loadError && rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-ink-secondary dark:text-night-muted">{t(`manage.drive.files.empty.${queue}`)}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Pager page={page} total={data?.total ?? 0} loading={loading} onPage={setPage} label={t('manage.drive.files.unit')} />

      {removing && (
        <ConfirmDialog
          title={t('manage.drive.files.removeTitle')}
          body={t('manage.drive.files.removeBody', { name: removing.name })}
          confirmLabel={t('manage.drive.files.remove')}
          danger
          busy={busyId === removing.id}
          onConfirm={() => act(removing, 'remove')}
          onCancel={() => setRemoving(null)}
        />
      )}
    </div>
  )
}

// ── Wiki pages ──────────────────────────────────────────────────────────────

const KB_STATUSES: KbPageStatus[] = ['HIDDEN', 'PUBLISHED']

// Hidden pages (by staff, or automatically when a cited file is taken down)
// and published ones with their report counts; hide / restore.
function WikiView() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<KbPageStatus>('HIDDEN')
  const { data, setData, page, setPage, loading, loadError, setLoadError, reload } =
    usePaged<StaffKbPage>((p) => fetchStaffKbPages({ status, page: p, limit: PAGE_SIZE }), [status])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [hiding, setHiding] = useState<StaffKbPage | null>(null)

  async function act(p: StaffKbPage, action: 'hide' | 'restore') {
    setError(null); setNotice(null); setBusyId(p.id)
    try {
      await (action === 'hide' ? hideKbPage(p.id) : restoreKbPage(p.id))
      const next: KbPageStatus = action === 'hide' ? 'HIDDEN' : 'PUBLISHED'
      setData((d) => d && { ...d, items: d.items.map((x) => (x.id === p.id ? { ...x, status: next } : x)) })
      setNotice(t(`manage.drive.wiki.${action}Notice`, { title: p.title }))
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError(t('manage.drive.conflict'))
        reload()
      } else {
        setError(apuntesErrorMessage(e, t))
      }
    } finally {
      setBusyId(null)
      setHiding(null)
    }
  }

  const rows = data?.items ?? []
  const base = import.meta.env.BASE_URL.replace(/\/+$/, '')

  return (
    <div className="flex flex-col gap-4">
      {error && <ErrorBanner onDismiss={() => setError(null)}>{error}</ErrorBanner>}
      {loadError && <ErrorBanner onDismiss={() => setLoadError(null)}>{loadError}</ErrorBanner>}
      {notice && <Notice onDismiss={() => setNotice(null)}>{notice}</Notice>}

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="drive-kb-status" className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
          {t('manage.drive.filterLabel')}
        </label>
        <select
          id="drive-kb-status"
          value={status}
          onChange={(e) => { setStatus(e.target.value as KbPageStatus); setNotice(null) }}
          className={SELECT}
        >
          {KB_STATUSES.map((st) => <option key={st} value={st}>{t(`manage.drive.wiki.status.${st}`)}</option>)}
        </select>
      </div>

      <div className="overflow-x-auto rounded-card border border-border dark:border-night-border">
        <table className="w-full font-body text-body-sm">
          <thead className="bg-page-bg dark:bg-night-bg">
            <tr className="text-left">
              <th className={TH}>{t('manage.drive.wiki.col.page')}</th>
              <th className={TH}>{t('manage.drive.wiki.col.type')}</th>
              <th className={TH}>{t('manage.drive.files.col.reports')}</th>
              <th className={TH}>{t('manage.drive.col.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const busy = busyId === p.id
              return (
                <tr key={p.id} className="border-t border-border dark:border-night-border align-top">
                  <td className="px-3 py-3 min-w-[16rem]">
                    <a
                      href={`${base}${kbPagePath(p.subjectId, p.slug)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-ink-primary dark:text-night-text hover:text-primary hover:underline"
                    >
                      {p.title}
                    </a>
                    <p className="font-mono text-label text-ink-secondary dark:text-night-muted">{p.subjectId} · {p.slug}</p>
                    {p.summary && <p className="text-ink-secondary dark:text-night-muted mt-1 line-clamp-2">{p.summary}</p>}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">{t(`wiki.types.${p.type}`)}</td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    {p.reportCount > 0 ? t('manage.drive.files.reportCount', { count: p.reportCount }) : '—'}
                  </td>
                  <td className="px-3 py-3">
                    {p.status === 'HIDDEN' ? (
                      <button type="button" disabled={busy} onClick={() => act(p, 'restore')} className={ACTION_BTN}>
                        {busy ? '…' : t('manage.drive.files.restore')}
                      </button>
                    ) : p.status === 'PUBLISHED' ? (
                      <button type="button" disabled={busy} onClick={() => setHiding(p)} className={DANGER_BTN}>
                        {t('manage.drive.wiki.hide')}
                      </button>
                    ) : <span className="text-ink-secondary dark:text-night-muted">—</span>}
                  </td>
                </tr>
              )
            })}
            {loading && rows.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-ink-secondary dark:text-night-muted">{t('manage.loading')}</td></tr>
            )}
            {!loading && !loadError && rows.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-8 text-center text-ink-secondary dark:text-night-muted">{t(`manage.drive.wiki.empty.${status}`)}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Pager page={page} total={data?.total ?? 0} loading={loading} onPage={setPage} label={t('manage.drive.wiki.unit')} />

      {hiding && (
        <ConfirmDialog
          title={t('manage.drive.wiki.hideTitle')}
          body={t('manage.drive.wiki.hideBody', { title: hiding.title })}
          confirmLabel={t('manage.drive.wiki.hide')}
          danger
          busy={busyId === hiding.id}
          onConfirm={() => act(hiding, 'hide')}
          onCancel={() => setHiding(null)}
        />
      )}
    </div>
  )
}

// ── Unclaimed shares ────────────────────────────────────────────────────────

function UnclaimedView() {
  const { t, i18n } = useTranslation()
  const [rows, setRows] = useState<UnclaimedShare[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  function load() {
    setLoading(true)
    fetchUnclaimedShares()
      .then((res) => { setRows(res ?? []); setError(null) })
      .catch((e) => setError(apuntesErrorMessage(e, t)))
      .finally(() => setLoading(false))
  }

  useEffect(load, []) // eslint-disable-line react-hooks/exhaustive-deps

  const list = rows ?? []

  return (
    <div className="flex flex-col gap-4">
      <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('manage.drive.unclaimed.intro')}</p>
      {error && (
        <ErrorBanner onDismiss={() => setError(null)}>
          {error}{' '}
          <button type="button" onClick={load} className="underline font-semibold">{t('errors.retry')}</button>
        </ErrorBanner>
      )}
      <div className="overflow-x-auto rounded-card border border-border dark:border-night-border">
        <table className="w-full font-body text-body-sm">
          <thead className="bg-page-bg dark:bg-night-bg">
            <tr className="text-left">
              <th className={TH}>{t('manage.drive.unclaimed.col.name')}</th>
              <th className={TH}>{t('manage.drive.unclaimed.col.owner')}</th>
              <th className={TH}>{t('manage.drive.unclaimed.col.firstSeen')}</th>
              <th className={TH}>{t('manage.drive.unclaimed.col.lastSeen')}</th>
            </tr>
          </thead>
          <tbody>
            {list.map((u, i) => (
              <tr key={`${u.name}-${u.ownerEmail}-${i}`} className="border-t border-border dark:border-night-border">
                <td className="px-3 py-3 text-ink-primary dark:text-night-text break-words">{u.name}</td>
                <td className="px-3 py-3 font-mono text-label text-ink-secondary dark:text-night-muted break-all">{u.ownerEmail ?? '—'}</td>
                <td className="px-3 py-3 whitespace-nowrap">{formatDateTime(u.firstSeenAt, i18n.language)}</td>
                <td className="px-3 py-3 whitespace-nowrap">{formatDateTime(u.lastSeenAt, i18n.language)}</td>
              </tr>
            ))}
            {loading && list.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-ink-secondary dark:text-night-muted">{t('manage.loading')}</td></tr>
            )}
            {!loading && !error && list.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-8 text-center text-ink-secondary dark:text-night-muted">{t('manage.drive.unclaimed.empty')}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
