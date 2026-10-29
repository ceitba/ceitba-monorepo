import '../../i18nApuntes'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { deleteHiddenReview, fetchHiddenReviews, restoreHiddenReview, type StaffReview } from '../../api/reviews'
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, LoadingRegion, Skeleton, toast } from '../../components/ui'
import { joinNames } from '../../components/apuntes/reviews/logic'
import { formatDate } from '../../utils/apuntes'
import { apuntesAdminErrorMessage } from './adminErrors'
import { useQueueOptional } from './review/queueContext'

const LABEL = 'font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted'

// Opiniones ocultas: subject reviews that hid themselves after piling up
// reports. Staff restore them (visible again) or delete them for good.
export default function ManageHiddenReviews() {
  const { t, i18n } = useTranslation()
  const queue = useQueueOptional()
  const [rows, setRows] = useState<StaffReview[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [tick, setTick] = useState(0)
  const reqRef = useRef(0)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<StaffReview | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    const id = ++reqRef.current
    setLoadFailed(false)
    fetchHiddenReviews()
      .then((res) => { if (reqRef.current === id) setRows(res) })
      .catch((e) => { if (reqRef.current === id) { console.error(e); setLoadFailed(true) } })
  }, [tick])

  const term = (r: StaffReview) => t('apuntes.reviews.term', { period: r.period, year: r.year })
  const drop = (id: string) => setRows((rs) => rs && rs.filter((r) => r.id !== id))

  async function restore(r: StaffReview) {
    setBusyId(r.id)
    try {
      await restoreHiddenReview(r.id)
      drop(r.id)
      queue?.reloadSource('hiddenReviews')
      toast.success(t('manage.drive.reviews.restored', { subject: r.subjectName }))
    } catch (e) {
      toast.error(apuntesAdminErrorMessage(e, t))
    } finally {
      setBusyId(null)
    }
  }

  async function confirmDelete() {
    if (!deleting) return
    const r = deleting
    setBusyId(r.id); setDeleteError(null)
    try {
      await deleteHiddenReview(r.id)
      drop(r.id)
      setDeleting(null)
      queue?.reloadSource('hiddenReviews')
      toast.success(t('manage.drive.reviews.deleted', { subject: r.subjectName }))
    } catch (e) {
      setDeleteError(apuntesAdminErrorMessage(e, t))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('manage.drive.reviews.intro')}</p>

      {loadFailed && <ErrorState message={t('manage.errors.generic')} onRetry={() => setTick((n) => n + 1)} />}

      {!loadFailed && rows == null && (
        <LoadingRegion className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-card!" />)}
        </LoadingRegion>
      )}

      {!loadFailed && rows?.length === 0 && (
        <EmptyState title={t('manage.drive.reviews.empty')} body={t('manage.drive.reviews.emptyHint')} />
      )}

      {!loadFailed && rows && rows.length > 0 && (
        <ul className="flex flex-col gap-3">
          {rows.map((r) => {
            const busy = busyId === r.id
            const profs = joinNames(r.professors.map((p) => p.name), i18n.language)
            return (
              <li key={r.id} className="rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface p-4 flex flex-col gap-3">
                <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/apuntes/${encodeURIComponent(r.subjectId)}?vista=opiniones`}
                      className="font-body text-body font-semibold text-ink-primary dark:text-night-text hover:text-primary hover:underline"
                    >
                      <span className="font-mono text-label text-ink-secondary dark:text-night-muted mr-2">{r.subjectId}</span>
                      {r.subjectName}
                    </Link>
                    <p className={LABEL}>
                      {term(r)} · {t('apuntes.reviews.commission', { commission: r.commission })}
                      {' · '}
                      <time dateTime={r.createdAt}>{formatDate(r.createdAt, i18n.language)}</time>
                    </p>
                    <p className="font-body text-body-sm text-ink-primary dark:text-night-text mt-1">
                      {profs || <span className="text-ink-secondary dark:text-night-muted">{t('apuntes.reviews.noProfessor')}</span>}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge tone="neutral">{t(`apuntes.reviews.difficultyBadge.${r.difficulty}`)}</Badge>
                    <Badge tone={r.recommend ? 'success' : 'warning'}>
                      {t(r.recommend ? 'apuntes.reviews.recommends' : 'apuntes.reviews.notRecommends')}
                    </Badge>
                  </div>
                </div>

                {r.comment?.trim() ? (
                  <p className="font-body text-body text-ink-primary dark:text-night-text whitespace-pre-line wrap-break-word">{r.comment}</p>
                ) : (
                  <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('manage.drive.reviews.noComment')}</p>
                )}

                <div className="border-t border-border dark:border-night-border pt-3">
                  <p className="font-body text-body-sm font-semibold text-ink-primary dark:text-night-text">
                    {t('manage.drive.files.reportCount', { count: r.reportCount })}
                  </p>
                  <ul className="mt-1 flex flex-col gap-1 font-body text-body-sm">
                    {r.reports.map((rep, i) => (
                      <li key={i} className="text-ink-secondary dark:text-night-muted">
                        <span className="font-mono text-label uppercase tracking-widest">{t(`apuntes.report.reasons.${rep.reason}`)}</span>
                        <span className="font-mono text-label"> · {formatDate(rep.createdAt, i18n.language)}</span>
                        {rep.comment && <p className="italic wrap-break-word">“{rep.comment}”</p>}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" loading={busy && !deleting} disabled={busy} onClick={() => void restore(r)}>
                    {t('manage.drive.reviews.restore')}
                  </Button>
                  <Button variant="dangerGhost" size="sm" disabled={busy} onClick={() => { setDeleteError(null); setDeleting(r) }}>
                    {t('manage.drive.reviews.delete')}
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {deleting && (
        <ConfirmDialog
          title={t('manage.drive.reviews.deleteTitle')}
          body={t('manage.drive.reviews.deleteBody', { subject: deleting.subjectName, term: term(deleting), commission: deleting.commission })}
          confirmLabel={t('manage.drive.reviews.deleteConfirm')}
          busy={busyId === deleting.id}
          error={deleteError}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  )
}
