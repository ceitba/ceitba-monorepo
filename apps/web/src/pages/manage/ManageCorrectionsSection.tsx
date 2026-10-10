import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  applyCorrection,
  fetchStaffCorrections,
  rejectCorrection,
  type CorrectionSlot,
  type CorrectionStatus,
  type StaffCorrection,
  type StaffCorrectionsPage,
} from '../../api/corrections'
import { ApiError } from '../../api/client'
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  SkeletonRows,
  selectClass,
  type BadgeTone,
} from '../../components/ui'
import { adminErrorMessage } from './adminErrors'
import { useQueueOptional } from './review/queueContext'

const PAGE_SIZE = 20
const STATUS_TONE: Record<CorrectionStatus, BadgeTone> = {
  PENDING: 'warning',
  APPLIED: 'success',
  REJECTED: 'danger',
  RESOLVED: 'neutral',
  SUPERSEDED: 'neutral',
}
const STATUSES: CorrectionStatus[] = ['PENDING', 'APPLIED', 'REJECTED', 'RESOLVED', 'SUPERSEDED']
const DAY_ORDER = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']

function sortSlots(slots: CorrectionSlot[]): CorrectionSlot[] {
  return [...slots].sort((a, b) =>
    DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day) || a.time_from.localeCompare(b.time_from))
}

// "08:00:00" → "08:00"
function hhmm(time: string): string {
  return time.slice(0, 5)
}

type StatusFilter = CorrectionStatus

export default function ManageCorrectionsSection() {
  const { t, i18n } = useTranslation()
  const queue = useQueueOptional()
  const [page, setPage]       = useState<StaffCorrectionsPage | null>(null)
  // Kept apart: a successful list fetch clears loadError but must not wipe
  // the message of the action that triggered it (e.g. the 409 reload).
  const [error, setError]     = useState<string | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [notice, setNotice]   = useState<string | null>(null)
  const [busyId, setBusyId]   = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [rejecting, setRejecting] = useState<StaffCorrection | null>(null)
  const [rejectError, setRejectError] = useState<string | null>(null)

  const [status, setStatus]   = useState<StatusFilter>('PENDING')
  const [pageNum, setPageNum] = useState(1)
  // The page whose rows are on screen. A failed page change leaves them (and
  // the pager) where they were, with an error above them.
  const [shownPage, setShownPage] = useState(1)

  // Out-of-order guard: only the latest request may write state.
  const reqIdRef = useRef(0)
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    const id = ++reqIdRef.current
    setLoading(true)
    fetchStaffCorrections({ status, page: pageNum, limit: PAGE_SIZE })
      .then((res) => {
        if (reqIdRef.current !== id) return
        setPage(res)
        setLoadFailed(false)
        setShownPage(pageNum)
        const lastPage = Math.max(1, Math.ceil(res.meta.total / PAGE_SIZE))
        if (pageNum > lastPage) setPageNum(lastPage)
      })
      .catch((e) => {
        if (reqIdRef.current !== id) return
        console.error(e)
        setLoadFailed(true)
      })
      .finally(() => {
        if (reqIdRef.current === id) setLoading(false)
      })
  }, [status, pageNum, refreshTick])

  function reload() {
    setRefreshTick((n) => n + 1)
  }

  // Keep the acted-on row visible with its new status (so staff see the
  // outcome and can undo it); it drops out of the list on the next reload.
  function replaceRow(updated: StaffCorrection) {
    setPage((p) => p && { ...p, data: p.data.map((c) => (c.id === updated.id ? updated : c)) })
  }

  // 409: the status changed under us (votes, sync or another staff member).
  function isConflict(e: unknown): boolean {
    return e instanceof ApiError && e.status === 409
  }

  function handleActionError(e: unknown) {
    if (isConflict(e)) {
      setError(t('manage.corrections.conflict'))
      reload()
      return
    }
    setError(adminErrorMessage(e, t))
  }

  async function apply(c: StaffCorrection) {
    setError(null); setNotice(null); setBusyId(c.id)
    try {
      const updated = await applyCorrection(c.id)
      replaceRow(updated)
      queue?.reloadSource('corrections')
      setNotice(t('manage.corrections.appliedNotice', { subject: c.subjectName, commission: c.commissionName }))
    } catch (e) {
      handleActionError(e)
    } finally {
      setBusyId(null)
    }
  }

  async function confirmReject() {
    if (!rejecting) return
    const c = rejecting
    const wasApplied = c.status === 'APPLIED'
    setError(null); setNotice(null); setRejectError(null); setBusyId(c.id)
    try {
      const updated = await rejectCorrection(c.id)
      setRejecting(null)
      replaceRow(updated)
      queue?.reloadSource('corrections')
      setNotice(t(wasApplied ? 'manage.corrections.revertedNotice' : 'manage.corrections.rejectedNotice',
        { subject: c.subjectName, commission: c.commissionName }))
    } catch (e) {
      if (isConflict(e)) {
        setRejecting(null)
        handleActionError(e)
      } else {
        // Keep the dialog open so staff can retry without starting over.
        setRejectError(adminErrorMessage(e, t))
      }
    } finally {
      setBusyId(null)
    }
  }

  function formatSlot(s: CorrectionSlot): string {
    return t('manage.corrections.slot', { day: t(`manage.corrections.days.${s.day}`), from: hhmm(s.time_from), to: hhmm(s.time_to) })
  }

  function formatDate(iso: string): string {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' })
  }

  function statusLabel(c: StaffCorrection): string {
    if (c.status === 'APPLIED') {
      return t(c.reviewedByStaff ? 'manage.corrections.status.appliedByStaff' : 'manage.corrections.status.appliedByVotes')
    }
    if (c.status === 'REJECTED' && c.reviewedByStaff) return t('manage.corrections.status.rejectedByStaff')
    return t(`manage.corrections.status.${c.status}`)
  }

  const rows = page?.data ?? []
  const total = page?.meta.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="flex flex-col gap-4">
      <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">
        {t('manage.corrections.intro')}
      </p>

      {error && <Alert tone="error" onDismiss={() => setError(null)}>{error}</Alert>}
      {notice && <Alert tone="success" onDismiss={() => setNotice(null)}>{notice}</Alert>}

      <Field label={t('manage.corrections.filterLabel')} className="w-full sm:w-64">
        {(p) => (
          <select
            {...p}
            value={status}
            onChange={(e) => {
              // Drop the previous filter's rows (and their action buttons) while
              // the new status loads.
              setPage(null)
              setStatus(e.target.value as StatusFilter); setPageNum(1); setNotice(null)
            }}
            className={selectClass()}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>{t(`manage.corrections.filter.${s}`)}</option>
            ))}
          </select>
        )}
      </Field>

      {loadFailed && rows.length > 0 && (
        <Alert tone="error" action={<Button size="sm" variant="outline" onClick={reload}>{t('errors.retry')}</Button>}>
          {pageNum !== shownPage
            ? t('manage.corrections.pageLoadFailed', { page: pageNum })
            : t('manage.corrections.reloadFailed')}
        </Alert>
      )}

      {loadFailed && rows.length === 0 ? (
        <ErrorState message={t('manage.corrections.loadFailed')} onRetry={reload} />
      ) : !loading && rows.length === 0 ? (
        <EmptyState title={t(`manage.corrections.empty.${status}`)} body={t('manage.corrections.emptyHint')} />
      ) : (
        <div className="overflow-x-auto rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface">
          <table className="w-full font-body text-body-sm text-ink-primary dark:text-night-text">
            <thead className="bg-page-bg dark:bg-night-raised text-ink-secondary dark:text-night-muted">
              <tr className="text-left">
                <th className="px-3 py-2 font-mono text-label uppercase tracking-widest">{t('manage.corrections.col.commission')}</th>
                <th className="px-3 py-2 font-mono text-label uppercase tracking-widest">{t('manage.corrections.col.sga')}</th>
                <th className="px-3 py-2 font-mono text-label uppercase tracking-widest">{t('manage.corrections.col.proposed')}</th>
                <th className="px-3 py-2 font-mono text-label uppercase tracking-widest">{t('manage.corrections.col.votes')}</th>
                <th className="px-3 py-2 font-mono text-label uppercase tracking-widest">{t('manage.corrections.col.status')}</th>
                <th className="px-3 py-2 font-mono text-label uppercase tracking-widest">{t('manage.corrections.col.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const busy = busyId === c.id
                const label = t('manage.corrections.rowLabel', { subject: c.subjectName, commission: c.commissionName })
                return (
                  <tr key={c.id} className="border-t border-border dark:border-night-border align-top">
                    <td className="px-3 py-3">
                      <p className="font-semibold text-ink-primary dark:text-night-text">
                        <span className="font-mono text-label text-ink-secondary dark:text-night-muted mr-1">{c.subjectId}</span>
                        {c.subjectName}
                      </p>
                      <p className="text-ink-secondary dark:text-night-muted">
                        {t('manage.corrections.commission', { name: c.commissionName })}
                      </p>
                      <p className="font-mono text-label text-ink-secondary dark:text-night-muted mt-1">
                        {t('manage.corrections.created', { date: formatDate(c.createdAt) })}
                      </p>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-ink-secondary dark:text-night-muted">
                      <SlotList slots={c.sgaSchedule} format={formatSlot} empty={t('manage.corrections.noSlots')} />
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-ink-primary dark:text-night-text font-semibold">
                      <SlotList slots={c.schedule} format={formatSlot} empty={t('manage.corrections.noSlots')} />
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      {t('manage.corrections.votes', { confirms: c.confirms, rejects: c.rejects })}
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={STATUS_TONE[c.status]} className="whitespace-normal">{statusLabel(c)}</Badge>
                      {c.reviewedAt && (
                        <p className="font-mono text-label text-ink-secondary dark:text-night-muted mt-1">
                          {t('manage.corrections.reviewed', { date: formatDate(c.reviewedAt) })}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {c.status === 'PENDING' && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              loading={busy}
                              onClick={() => apply(c)}
                              aria-label={t('manage.corrections.applyAria', { label })}
                            >
                              {t('manage.corrections.apply')}
                            </Button>
                            <Button
                              variant="dangerGhost"
                              size="sm"
                              disabled={busy}
                              onClick={() => { setRejectError(null); setRejecting(c) }}
                              aria-label={t('manage.corrections.rejectAria', { label })}
                            >
                              {t('manage.corrections.reject')}
                            </Button>
                          </>
                        )}
                        {c.status === 'APPLIED' && (
                          <Button
                            variant="dangerGhost"
                            size="sm"
                            disabled={busy}
                            onClick={() => { setRejectError(null); setRejecting(c) }}
                            aria-label={t('manage.corrections.revertAria', { label })}
                          >
                            {t('manage.corrections.revert')}
                          </Button>
                        )}
                        {c.status !== 'PENDING' && c.status !== 'APPLIED' && (
                          <span className="text-ink-secondary dark:text-night-muted">—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {loading && rows.length === 0 && <SkeletonRows rows={5} cols={6} />}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 font-body text-body-sm">
        <span className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
          {t('manage.corrections.pageStatus', { page: shownPage, pages: totalPages, total })}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={shownPage <= 1 || loading}
            onClick={() => setPageNum(Math.max(1, shownPage - 1))}
          >
            {t('manage.corrections.prev')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={shownPage >= totalPages || loading}
            onClick={() => setPageNum(Math.min(totalPages, shownPage + 1))}
          >
            {t('manage.corrections.next')}
          </Button>
        </div>
      </div>

      {rejecting && (
        <ConfirmDialog
          title={t(rejecting.status === 'APPLIED' ? 'manage.corrections.revertTitle' : 'manage.corrections.rejectTitle')}
          body={t(rejecting.status === 'APPLIED' ? 'manage.corrections.revertBody' : 'manage.corrections.rejectBody', {
            subject: rejecting.subjectName,
            commission: rejecting.commissionName,
          })}
          confirmLabel={t(rejecting.status === 'APPLIED' ? 'manage.corrections.revertConfirm' : 'manage.corrections.rejectConfirm')}
          danger
          busy={busyId === rejecting.id}
          error={rejectError}
          onConfirm={confirmReject}
          onCancel={() => setRejecting(null)}
        />
      )}
    </div>
  )
}

function SlotList({
  slots,
  format,
  empty,
}: {
  slots: CorrectionSlot[]
  format: (s: CorrectionSlot) => string
  empty: string
}) {
  if (!slots || slots.length === 0) return <span>{empty}</span>
  return (
    <ul className="flex flex-col gap-0.5">
      {sortSlots(slots).map((s, i) => (
        <li key={`${s.day}-${s.time_from}-${i}`} className="font-mono text-body-sm">{format(s)}</li>
      ))}
    </ul>
  )
}
