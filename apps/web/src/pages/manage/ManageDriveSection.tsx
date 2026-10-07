import '../../i18nApuntes'
import { useEffect, useRef, useState, type ReactNode } from 'react'
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
import {
  Alert,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  Modal,
  SkeletonTable,
  Tabs,
  selectClass,
  textareaClass,
  toast,
} from '../../components/ui'
import KindIcon from '../../components/apuntes/KindIcon'
import YearBadge from '../../components/apuntes/YearBadge'
import { PublicationBadge, SourceStatusBadge } from '../../components/apuntes/Badges'
import CommunityBadge from '../../components/apuntes/CommunityBadge'
import { formatDate, formatDateTime } from '../../utils/apuntes'
import { apuntesAdminErrorMessage } from './adminErrors'

const PAGE_SIZE = 20
const SOURCE_STATUSES: (SourceStatus | '')[] = ['PENDING_REVIEW', 'ACTIVE', 'ERROR', 'BLOCKED', 'REVOKED', 'DISCONNECTED', '']
const FILE_QUEUES: StaffFileQueue[] = ['NEEDS_REVIEW', 'HIDDEN_REPORTED']

type View = 'sources' | 'files' | 'wiki' | 'unclaimed'

const TH = 'px-3 py-2 font-mono text-label uppercase tracking-widest'
const TD = 'px-3 py-3'
const TR = 'border-t border-border dark:border-night-border align-top'

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
      <Tabs items={views} active={view} onChange={setView} label={t('manage.drive.viewsAria')} idPrefix="drive" />
      <div role="tabpanel" id={`drive-panel-${view}`} aria-labelledby={`drive-tab-${view}`}>
        {view === 'sources' && <SourcesView />}
        {view === 'files' && <FilesView />}
        {view === 'wiki' && <WikiView />}
        {view === 'unclaimed' && <UnclaimedView />}
      </div>
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
    <div className="flex flex-wrap items-center justify-between gap-2 font-body text-body-sm">
      <span className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
        {t('manage.drive.pageStatus', { page: page + 1, pages: totalPages, total, what: label })}
      </span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 0 || loading} onClick={() => onPage(Math.max(0, page - 1))}>
          {t('manage.drive.prev')}
        </Button>
        <Button variant="outline" size="sm" disabled={page >= totalPages - 1 || loading} onClick={() => onPage(Math.min(totalPages - 1, page + 1))}>
          {t('manage.drive.next')}
        </Button>
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
      .catch((e) => { if (reqRef.current === id) setLoadError(apuntesAdminErrorMessage(e, t)) })
      .finally(() => { if (reqRef.current === id) setLoading(false) })
  }, [page, tick, t, ...deps]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    data, setData, page, setPage, loading, loadError,
    reload: () => setTick((n) => n + 1),
  }
}

// Load error / first-load skeleton / empty state around a table.
function ListBody({ loading, loadError, hasData, isEmpty, cols, onRetry, empty, children }: {
  loading: boolean
  loadError: string | null
  hasData: boolean
  isEmpty: boolean
  cols: number
  onRetry: () => void
  empty: ReactNode
  children: ReactNode
}) {
  const { t } = useTranslation()
  if (loadError) return <ErrorState title={t('manage.errors.loadFailed')} message={loadError} onRetry={onRetry} />
  if (!hasData || (loading && isEmpty)) return <SkeletonTable rows={5} cols={cols} />
  if (isEmpty) return <>{empty}</>
  return (
    <div className="overflow-x-auto rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface">
      <table className="w-full font-body text-body-sm">{children}</table>
    </div>
  )
}

function FilterSelect<T extends string>({ label, value, onChange, options }: {
  label: string
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
}) {
  return (
    <Field label={label} className="max-w-xs">
      {(p) => (
        <select {...p} value={value} onChange={(e) => onChange(e.target.value as T)} className={selectClass()}>
          {options.map((o) => <option key={o.value || 'all'} value={o.value}>{o.label}</option>)}
        </select>
      )}
    </Field>
  )
}

function isConflict(e: unknown) {
  return e instanceof ApiError && e.status === 409
}

// ── Sources ─────────────────────────────────────────────────────────────────

function SourcesView() {
  const { t, i18n } = useTranslation()
  const [status, setStatus] = useState<SourceStatus | ''>('PENDING_REVIEW')
  const { data, setData, page, setPage, loading, loadError, reload } =
    usePaged<StaffSource>((p) => fetchStaffSources({ status, page: p, limit: PAGE_SIZE }), [status])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [blocking, setBlocking] = useState<StaffSource | null>(null)
  const [blockError, setBlockError] = useState<string | null>(null)
  const [comment, setComment] = useState('')

  function replaceRow(updated: StaffSource) {
    setData((d) => d && { ...d, items: d.items.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)) })
  }

  async function approve(s: StaffSource) {
    setBusyId(s.id)
    try {
      replaceRow(await approveSource(s.id))
      toast.success(t('manage.drive.sources.approvedNotice', { name: s.rootName }))
    } catch (e) {
      if (isConflict(e)) { toast.error(t('manage.drive.conflict')); reload() }
      else toast.error(apuntesAdminErrorMessage(e, t))
    } finally {
      setBusyId(null)
    }
  }

  async function confirmBlock() {
    if (!blocking) return
    const s = blocking
    setBlockError(null); setBusyId(s.id)
    try {
      replaceRow(await blockSource(s.id, comment.trim() || undefined))
      toast.success(t('manage.drive.sources.blockedNotice', { name: s.rootName }))
      setBlocking(null)
    } catch (e) {
      if (isConflict(e)) { setBlocking(null); toast.error(t('manage.drive.conflict')); reload() }
      else setBlockError(apuntesAdminErrorMessage(e, t))
    } finally {
      setBusyId(null)
    }
  }

  const rows = data?.items ?? []
  const blockBusy = blocking != null && busyId === blocking.id

  return (
    <div className="flex flex-col gap-4">
      <FilterSelect
        label={t('manage.drive.filterLabel')}
        value={status}
        onChange={setStatus}
        options={SOURCE_STATUSES.map((s) => ({ value: s, label: s ? t(`apuntes.sourceStatus.${s}`) : t('manage.drive.allStatuses') }))}
      />

      <ListBody
        loading={loading}
        loadError={loadError}
        hasData={data != null}
        isEmpty={rows.length === 0}
        cols={5}
        onRetry={reload}
        empty={<EmptyState title={t('manage.drive.sources.empty')} body={t('manage.drive.sources.emptyHint')} />}
      >
        <thead className="bg-page-bg dark:bg-night-raised text-ink-secondary dark:text-night-muted">
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
              <tr key={s.id} className={TR}>
                <td className={TD}>
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
                  {s.lastError && <p className="text-red-600 dark:text-red-400 mt-1">{t('manage.drive.sources.syncFailed')}</p>}
                </td>
                <td className={TD}>
                  {s.community ? (
                    <CommunityBadge />
                  ) : (
                    <>
                      <p className="text-ink-primary dark:text-night-text">{s.ownerName ?? '—'}</p>
                      <p className="font-mono text-label text-ink-secondary dark:text-night-muted break-all">{s.ownerEmail ?? '—'}</p>
                    </>
                  )}
                </td>
                <td className={`${TD} whitespace-nowrap text-ink-secondary dark:text-night-muted`}>
                  {t('manage.drive.sources.counts', { files: s.fileCount, published: s.publishedCount, review: s.needsReviewCount })}
                </td>
                <td className={TD}><SourceStatusBadge status={s.status} /></td>
                <td className={TD}>
                  <div className="flex flex-wrap items-center gap-2">
                    {s.status !== 'ACTIVE' && s.status !== 'DISCONNECTED' && s.status !== 'REVOKED' && (
                      <Button variant="outline" size="sm" loading={busy} onClick={() => approve(s)}
                        aria-label={t('manage.drive.sources.approveAria', { name: s.rootName })}>
                        {t('manage.drive.sources.approve')}
                      </Button>
                    )}
                    {s.status !== 'BLOCKED' && s.status !== 'DISCONNECTED' && (
                      <Button variant="dangerGhost" size="sm" disabled={busy}
                        onClick={() => { setComment(''); setBlockError(null); setBlocking(s) }}
                        aria-label={t('manage.drive.sources.blockAria', { name: s.rootName })}>
                        {t('manage.drive.sources.block')}
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </ListBody>

      {data != null && !loadError && (
        <Pager page={page} total={data.total} loading={loading} onPage={setPage} label={t('manage.drive.sources.unit')} />
      )}

      {blocking && (
        <Modal
          title={t('manage.drive.sources.blockTitle')}
          onClose={() => setBlocking(null)}
          busy={blockBusy}
          footer={
            <>
              <Button variant="ghost" disabled={blockBusy} onClick={() => setBlocking(null)}>
                {t('manage.cancel')}
              </Button>
              <Button variant="danger" loading={blockBusy} onClick={confirmBlock}>
                {t('manage.drive.sources.blockConfirm')}
              </Button>
            </>
          }
        >
          <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">
            {t('manage.drive.sources.blockBody', {
              name: blocking.rootName,
              owner: blocking.community ? t('apuntes.community.label') : (blocking.ownerEmail ?? blocking.ownerName ?? '—'),
            })}
          </p>
          <Field label={t('manage.drive.sources.comment')}>
            {(p) => (
              <textarea {...p} value={comment} onChange={(e) => setComment(e.target.value)} rows={3} maxLength={1000} className={textareaClass()} />
            )}
          </Field>
          {blockError && <Alert tone="error">{blockError}</Alert>}
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
  const { data, setData, page, setPage, loading, loadError, reload } =
    usePaged<StaffFile>((p) => fetchStaffFiles({ publication: queue, page: p, limit: PAGE_SIZE }), [queue])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [removing, setRemoving] = useState<StaffFile | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)

  function replaceRow(updated: StaffFile) {
    setData((d) => d && { ...d, items: d.items.map((f) => (f.id === updated.id ? { ...f, ...updated } : f)) })
  }

  async function act(f: StaffFile, action: FileAction) {
    setBusyId(f.id); setRemoveError(null)
    try {
      const fn = action === 'publish' ? publishStaffFile : action === 'remove' ? removeStaffFile : restoreStaffFile
      replaceRow(await fn(f.id))
      toast.success(t(`manage.drive.files.${action}Notice`, { name: f.name }))
      setRemoving(null)
    } catch (e) {
      if (isConflict(e)) {
        setRemoving(null)
        toast.error(t('manage.drive.conflict'))
        reload()
      } else if (action === 'remove') {
        setRemoveError(apuntesAdminErrorMessage(e, t))
      } else {
        toast.error(apuntesAdminErrorMessage(e, t))
      }
    } finally {
      setBusyId(null)
    }
  }

  const rows = data?.items ?? []

  return (
    <div className="flex flex-col gap-4">
      <FilterSelect
        label={t('manage.drive.filterLabel')}
        value={queue}
        onChange={setQueue}
        options={FILE_QUEUES.map((q) => ({ value: q, label: t(`manage.drive.files.queue.${q}`) }))}
      />

      <ListBody
        loading={loading}
        loadError={loadError}
        hasData={data != null}
        isEmpty={rows.length === 0}
        cols={5}
        onRetry={reload}
        empty={<EmptyState title={t(`manage.drive.files.empty.${queue}`)} body={t(`manage.drive.files.emptyHint.${queue}`)} />}
      >
        <thead className="bg-page-bg dark:bg-night-raised text-ink-secondary dark:text-night-muted">
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
              <tr key={f.id} className={TR}>
                <td className={`${TD} min-w-[14rem]`}>
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
                <td className={`${TD} text-ink-primary dark:text-night-text`}>
                  {f.effectiveSubjectId ? (
                    <>
                      <span className="font-mono text-label text-ink-secondary dark:text-night-muted mr-1">{f.effectiveSubjectId}</span>
                      {f.effectiveSubjectName}
                    </>
                  ) : '—'}
                </td>
                <td className={`${TD} font-mono text-label text-ink-secondary dark:text-night-muted`}>
                  <p>{t('manage.drive.files.sharer', { who: f.sharerName ? `${f.sharerName} <${f.sharerEmail ?? ''}>` : (f.sharerEmail ?? '—') })}</p>
                  <p className="mt-0.5">{t('manage.drive.files.owner', { who: f.ownerEmail ?? '—' })}</p>
                  {f.ownerEmail && f.sharerEmail && f.ownerEmail.toLowerCase() !== f.sharerEmail.toLowerCase() && (
                    <p className="mt-1 text-amber-700 dark:text-amber-300 normal-case">{t('manage.drive.files.ownerDiffers')}</p>
                  )}
                </td>
                <td className={`${TD} min-w-[12rem]`}>
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
                <td className={TD}>
                  <div className="flex flex-wrap items-center gap-2">
                    {f.publication === 'NEEDS_REVIEW' && (
                      <Button variant="outline" size="sm" loading={busy} onClick={() => act(f, 'publish')}>
                        {t('manage.drive.files.publish')}
                      </Button>
                    )}
                    {(f.publication === 'HIDDEN_REPORTED' || f.publication === 'REMOVED_BY_STAFF') && (
                      <Button variant="outline" size="sm" loading={busy} onClick={() => act(f, 'restore')}>
                        {t('manage.drive.files.restore')}
                      </Button>
                    )}
                    {(pending || f.publication === 'PUBLISHED') && (
                      <Button variant="dangerGhost" size="sm" disabled={busy} onClick={() => { setRemoveError(null); setRemoving(f) }}>
                        {t('manage.drive.files.remove')}
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </ListBody>

      {data != null && !loadError && (
        <Pager page={page} total={data.total} loading={loading} onPage={setPage} label={t('manage.drive.files.unit')} />
      )}

      {removing && (
        <ConfirmDialog
          title={t('manage.drive.files.removeTitle')}
          body={t('manage.drive.files.removeBody', { name: removing.name })}
          confirmLabel={t('manage.drive.files.remove')}
          danger
          busy={busyId === removing.id}
          error={removeError}
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
  const { data, setData, page, setPage, loading, loadError, reload } =
    usePaged<StaffKbPage>((p) => fetchStaffKbPages({ status, page: p, limit: PAGE_SIZE }), [status])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [hiding, setHiding] = useState<StaffKbPage | null>(null)
  const [hideError, setHideError] = useState<string | null>(null)

  async function act(p: StaffKbPage, action: 'hide' | 'restore') {
    setBusyId(p.id); setHideError(null)
    try {
      await (action === 'hide' ? hideKbPage(p.id) : restoreKbPage(p.id))
      const next: KbPageStatus = action === 'hide' ? 'HIDDEN' : 'PUBLISHED'
      setData((d) => d && { ...d, items: d.items.map((x) => (x.id === p.id ? { ...x, status: next } : x)) })
      toast.success(t(`manage.drive.wiki.${action}Notice`, { title: p.title }))
      setHiding(null)
    } catch (e) {
      if (isConflict(e)) {
        setHiding(null)
        toast.error(t('manage.drive.conflict'))
        reload()
      } else if (action === 'hide') {
        setHideError(apuntesAdminErrorMessage(e, t))
      } else {
        toast.error(apuntesAdminErrorMessage(e, t))
      }
    } finally {
      setBusyId(null)
    }
  }

  const rows = data?.items ?? []
  const base = import.meta.env.BASE_URL.replace(/\/+$/, '')

  return (
    <div className="flex flex-col gap-4">
      <FilterSelect
        label={t('manage.drive.filterLabel')}
        value={status}
        onChange={setStatus}
        options={KB_STATUSES.map((st) => ({ value: st, label: t(`manage.drive.wiki.status.${st}`) }))}
      />

      <ListBody
        loading={loading}
        loadError={loadError}
        hasData={data != null}
        isEmpty={rows.length === 0}
        cols={4}
        onRetry={reload}
        empty={<EmptyState title={t(`manage.drive.wiki.empty.${status}`)} body={t(`manage.drive.wiki.emptyHint.${status}`)} />}
      >
        <thead className="bg-page-bg dark:bg-night-raised text-ink-secondary dark:text-night-muted">
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
              <tr key={p.id} className={TR}>
                <td className={`${TD} min-w-[16rem]`}>
                  <a
                    href={`${base}${kbPagePath(p.subjectId, p.slug)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-ink-primary dark:text-night-text hover:text-primary hover:underline"
                  >
                    {p.title}
                  </a>
                  <p className="font-mono text-label text-ink-secondary dark:text-night-muted">{p.subjectId}</p>
                  {p.summary && <p className="text-ink-secondary dark:text-night-muted mt-1 line-clamp-2">{p.summary}</p>}
                </td>
                <td className={`${TD} whitespace-nowrap text-ink-primary dark:text-night-text`}>{t(`wiki.types.${p.type}`)}</td>
                <td className={`${TD} whitespace-nowrap text-ink-primary dark:text-night-text`}>
                  {p.reportCount > 0 ? t('manage.drive.files.reportCount', { count: p.reportCount }) : '—'}
                </td>
                <td className={TD}>
                  {p.status === 'HIDDEN' ? (
                    <Button variant="outline" size="sm" loading={busy} onClick={() => act(p, 'restore')}>
                      {t('manage.drive.files.restore')}
                    </Button>
                  ) : p.status === 'PUBLISHED' ? (
                    <Button variant="dangerGhost" size="sm" disabled={busy} onClick={() => { setHideError(null); setHiding(p) }}>
                      {t('manage.drive.wiki.hide')}
                    </Button>
                  ) : <span className="text-ink-secondary dark:text-night-muted">—</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </ListBody>

      {data != null && !loadError && (
        <Pager page={page} total={data.total} loading={loading} onPage={setPage} label={t('manage.drive.wiki.unit')} />
      )}

      {hiding && (
        <ConfirmDialog
          title={t('manage.drive.wiki.hideTitle')}
          body={t('manage.drive.wiki.hideBody', { title: hiding.title })}
          confirmLabel={t('manage.drive.wiki.hide')}
          danger
          busy={busyId === hiding.id}
          error={hideError}
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
    setError(null)
    fetchUnclaimedShares()
      .then((res) => { setRows(res ?? []) })
      .catch((e) => setError(apuntesAdminErrorMessage(e, t)))
      .finally(() => setLoading(false))
  }

  useEffect(load, []) // eslint-disable-line react-hooks/exhaustive-deps

  const list = rows ?? []

  return (
    <div className="flex flex-col gap-4">
      <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('manage.drive.unclaimed.intro')}</p>
      <ListBody
        loading={loading}
        loadError={error}
        hasData={rows != null}
        isEmpty={list.length === 0}
        cols={4}
        onRetry={load}
        empty={<EmptyState title={t('manage.drive.unclaimed.empty')} body={t('manage.drive.unclaimed.emptyHint')} />}
      >
        <thead className="bg-page-bg dark:bg-night-raised text-ink-secondary dark:text-night-muted">
          <tr className="text-left">
            <th className={TH}>{t('manage.drive.unclaimed.col.name')}</th>
            <th className={TH}>{t('manage.drive.unclaimed.col.owner')}</th>
            <th className={TH}>{t('manage.drive.unclaimed.col.firstSeen')}</th>
            <th className={TH}>{t('manage.drive.unclaimed.col.lastSeen')}</th>
          </tr>
        </thead>
        <tbody>
          {list.map((u, i) => (
            <tr key={`${u.name}-${u.ownerEmail}-${i}`} className={TR}>
              <td className={`${TD} text-ink-primary dark:text-night-text break-words`}>{u.name}</td>
              <td className={`${TD} font-mono text-label text-ink-secondary dark:text-night-muted break-all`}>{u.ownerEmail ?? '—'}</td>
              <td className={`${TD} whitespace-nowrap text-ink-primary dark:text-night-text`}>{formatDateTime(u.firstSeenAt, i18n.language)}</td>
              <td className={`${TD} whitespace-nowrap text-ink-primary dark:text-night-text`}>{formatDateTime(u.lastSeenAt, i18n.language)}</td>
            </tr>
          ))}
        </tbody>
      </ListBody>
    </div>
  )
}
