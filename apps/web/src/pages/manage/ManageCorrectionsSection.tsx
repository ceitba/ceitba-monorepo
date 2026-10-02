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
import ConfirmDialog from '../../components/ConfirmDialog'
import ErrorBanner from '../../components/ErrorBanner'

const PAGE_SIZE = 20
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
  const [page, setPage]       = useState<StaffCorrectionsPage | null>(null)
  const [error, setError]     = useState<string | null>(null)
  const [notice, setNotice]   = useState<string | null>(null)
  const [busyId, setBusyId]   = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [rejecting, setRejecting] = useState<StaffCorrection | null>(null)

  const [status, setStatus]   = useState<StatusFilter>('PENDING')
  const [pageNum, setPageNum] = useState(1)

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
        setError(null)
        const lastPage = Math.max(1, Math.ceil(res.meta.total / PAGE_SIZE))
        if (pageNum > lastPage) setPageNum(lastPage)
      })
      .catch((e: Error) => {
        if (reqIdRef.current !== id) return
        setError(e.message)
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

  function handleActionError(e: unknown) {
    setError((e as Error).message)
    // 409: the status changed under us (votes, sync or another staff member).
    if (e instanceof ApiError && e.status === 409) reload()
  }

  async function apply(c: StaffCorrection) {
    setError(null); setNotice(null); setBusyId(c.id)
    try {
      const updated = await applyCorrection(c.id)
      replaceRow(updated)
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
    setError(null); setNotice(null); setBusyId(c.id)
    try {
      const updated = await rejectCorrection(c.id)
      setRejecting(null)
      replaceRow(updated)
      setNotice(t(wasApplied ? 'manage.corrections.revertedNotice' : 'manage.corrections.rejectedNotice',
        { subject: c.subjectName, commission: c.commissionName }))
    } catch (e) {
      setRejecting(null)
      handleActionError(e)
    } finally {
      setBusyId(null)
    }
  }

  function formatSlot(s: CorrectionSlot): string {
    return `${t(`manage.corrections.days.${s.day}`)} ${hhmm(s.time_from)}–${hhmm(s.time_to)}`
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

      {error && <ErrorBanner onDismiss={() => setError(null)}>{error}</ErrorBanner>}
      {notice && (
        <div
          role="status"
          className="flex items-start gap-3 px-3 py-2 rounded-sm border font-body text-body-sm bg-green-50 text-green-800 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-900"
        >
          <p className="flex-1">{notice}</p>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label={t('errors.dismiss')}
            className="flex-shrink-0 leading-none text-h5 opacity-70 hover:opacity-100"
          >
            ×
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="corrections-status" className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
          {t('manage.corrections.filterLabel')}
        </label>
        <select
          id="corrections-status"
          value={status}
          onChange={(e) => { setStatus(e.target.value as StatusFilter); setPageNum(1); setNotice(null) }}
          className="px-3 py-2 rounded-sm border border-border dark:border-night-border bg-white dark:bg-night-surface font-body text-body-sm"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>{t(`manage.corrections.filter.${s}`)}</option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-card border border-border dark:border-night-border">
        <table className="w-full font-body text-body-sm">
          <thead className="bg-page-bg dark:bg-night-bg">
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
              const label = `${c.subjectName} · ${t('manage.corrections.commission', { name: c.commissionName })}`
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
                    <span className="inline-block px-2 py-0.5 rounded-sm border border-border dark:border-night-border font-mono text-label uppercase tracking-widest">
                      {statusLabel(c)}
                    </span>
                    {c.reviewedAt && (
                      <p className="font-mono text-label text-ink-secondary dark:text-night-muted mt-1">
                        {t('manage.corrections.reviewed', { date: formatDate(c.reviewedAt) })}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap items-center gap-3">
                      {c.status === 'PENDING' && (
                        <>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => apply(c)}
                            aria-label={t('manage.corrections.applyAria', { label })}
                            className="px-3 py-1 rounded-sm font-mono text-label uppercase tracking-widest border border-border dark:border-night-border hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
                          >
                            {busy ? '…' : t('manage.corrections.apply')}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setRejecting(c)}
                            aria-label={t('manage.corrections.rejectAria', { label })}
                            className="text-red-600 dark:text-red-400 font-mono text-label uppercase tracking-widest hover:underline disabled:opacity-50"
                          >
                            {t('manage.corrections.reject')}
                          </button>
                        </>
                      )}
                      {c.status === 'APPLIED' && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setRejecting(c)}
                          aria-label={t('manage.corrections.revertAria', { label })}
                          className="text-red-600 dark:text-red-400 font-mono text-label uppercase tracking-widest hover:underline disabled:opacity-50"
                        >
                          {t('manage.corrections.revert')}
                        </button>
                      )}
                      {c.status !== 'PENDING' && c.status !== 'APPLIED' && (
                        <span className="text-ink-secondary dark:text-night-muted">—</span>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
            {loading && rows.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-ink-secondary">{t('manage.loading')}</td></tr>
            )}
            {!loading && !error && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center">
                  <p className="font-semibold text-ink-primary dark:text-night-text">
                    {t(`manage.corrections.empty.${status}`)}
                  </p>
                  <p className="mt-1 max-w-prose mx-auto text-ink-secondary dark:text-night-muted">
                    {t('manage.corrections.emptyHint')}
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-2 font-body text-body-sm">
        <span className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
          {t('manage.corrections.pageStatus', { page: pageNum, pages: totalPages, total })}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={pageNum <= 1 || loading}
            onClick={() => setPageNum((n) => Math.max(1, n - 1))}
            className="px-3 py-1 rounded-sm border border-border dark:border-night-border font-mono text-label uppercase tracking-widest disabled:opacity-40 hover:border-primary hover:text-primary transition-colors"
          >
            {t('manage.users.prev')}
          </button>
          <button
            type="button"
            disabled={pageNum >= totalPages || loading}
            onClick={() => setPageNum((n) => Math.min(totalPages, n + 1))}
            className="px-3 py-1 rounded-sm border border-border dark:border-night-border font-mono text-label uppercase tracking-widest disabled:opacity-40 hover:border-primary hover:text-primary transition-colors"
          >
            {t('manage.users.next')}
          </button>
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
