import '../../../i18nApuntes'
import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Link } from 'react-router-dom'
import { ApiError } from '../../../api/client'
import { applyCorrection, rejectCorrection, type CorrectionSlot, type StaffCorrection } from '../../../api/corrections'
import {
  approveSource, blockSource, publishStaffFile, removeStaffFile, restoreStaffFile,
  type StaffFile, type StaffSource,
} from '../../../api/drive'
import type { KbRun } from '../../../api/kbAdmin'
import { isBlockedStatus } from '../../../api/kbAdmin'
import type { Article } from '../../../newsletter/types'
import { articleEditPath } from '../../../newsletter/paths'
import {
  Alert, Badge, Button, ConfirmDialog, EmptyState, LoadingRegion, Skeleton, ToggleGroup,
  buttonClass, toast, type BadgeTone,
} from '../../../components/ui'
import { adminErrorMessage, apuntesAdminErrorMessage } from '../adminErrors'
import { areaPath } from '../areas'
import { useQueue } from './queueContext'
import type { QueueKind, SourceId } from './useReviewQueue'
import DigestCard from './DigestCard'
import { usePublishArticle } from './usePublishArticle'

type Filter = 'all' | QueueKind

const KIND_TONE: Record<QueueKind, BadgeTone> = {
  articles: 'info',
  corrections: 'warning',
  apuntes: 'success',
  wiki: 'neutral',
}

const DAY_ORDER = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']

// What staff can do from a row. `to` makes it a link (open the item where
// the decision needs more context); otherwise `run` decides right here.
interface RowAction {
  label: string
  aria?: string
  to?: string
  run?: () => void
}

interface Row {
  key: string
  // The item's id in its source (what queue.remove takes).
  id: string
  source: SourceId
  kind: QueueKind
  typeLabel: string
  title: string
  meta: string
  at: number
  primary: RowAction
  secondary?: RowAction
}

// A decision that can't be undone in one step asks first (the dialog keeps
// the error and lets staff retry).
interface Pending {
  title: string
  body: string
  confirmLabel: string
  run: () => Promise<void>
}

function ms(iso: string | null | undefined): number {
  const v = Date.parse(iso ?? '')
  return Number.isNaN(v) ? Date.now() : v
}

function isConflict(e: unknown): boolean {
  return e instanceof ApiError && e.status === 409
}

function slots(list: CorrectionSlot[], t: TFunction): string {
  if (list.length === 0) return t('manage.corrections.noSlots')
  return [...list]
    .sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day) || a.time_from.localeCompare(b.time_from))
    .map((s) => `${t(`manage.corrections.days.${s.day}`)} ${s.time_from.slice(0, 5)}–${s.time_to.slice(0, 5)}`)
    .join(', ')
}

// "hace 3 días", in the active language.
function ago(when: number, lang: string): string {
  const diff = (when - Date.now()) / 1000
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' })
  const abs = Math.abs(diff)
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour')
  return rtf.format(Math.round(diff / 86400), 'day')
}

// Para revisar: one list of everything waiting on a staff decision, oldest
// first, with the decision on the row.
export default function ManageReviewSection() {
  const { t, i18n } = useTranslation()
  const queue = useQueue()
  const { data, status, counts } = queue
  const [filter, setFilter] = useState<Filter>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [pendingBusy, setPendingBusy] = useState(false)
  const [pendingError, setPendingError] = useState<string | null>(null)
  const lang = i18n.language
  const publishArticle = usePublishArticle()

  // 409: someone (another staff member, a sync, votes) already decided it.
  // Not an error: the row leaves and the source reloads to confirm.
  function alreadyHandled(row: Row) {
    queue.remove(row.source, row.id)
    queue.reloadSource(row.source)
    toast.info(t('manage.review.conflict'))
  }

  // Runs a decision that applies right away: the row leaves the list, a
  // toast says what happened (with Deshacer only where the API can truly
  // take it back).
  async function decide(row: Row, work: () => Promise<void>, onError: (e: unknown) => string) {
    setBusy(row.key)
    try {
      await work()
    } catch (e) {
      if (isConflict(e)) {
        alreadyHandled(row)
      } else {
        toast.error(onError(e))
      }
    } finally {
      setBusy(null)
    }
  }

  function ask(p: Omit<Pending, 'run'> & { row: Row; work: () => Promise<void>; onError: (e: unknown) => string }) {
    setPendingError(null)
    setPending({
      title: p.title,
      body: p.body,
      confirmLabel: p.confirmLabel,
      run: async () => {
        setPendingBusy(true); setPendingError(null)
        try {
          await p.work()
          setPending(null)
        } catch (e) {
          if (isConflict(e)) {
            setPending(null)
            alreadyHandled(p.row)
          } else {
            setPendingError(p.onError(e))
          }
        } finally {
          setPendingBusy(false)
        }
      },
    })
  }

  const rows = useMemo<Row[]>(() => {
    const list: Row[] = []
    const adminErr = (e: unknown) => adminErrorMessage(e, t)
    const apuntesErr = (e: unknown) => apuntesAdminErrorMessage(e, t)

    for (const a of data.articles as Article[]) {
      const authors = (a.authors ?? []).filter(Boolean).join(', ')
      const row: Row = {
        key: `article-${a.id}`,
        id: a.id,
        source: 'articles',
        kind: 'articles',
        typeLabel: t('manage.review.types.article'),
        title: a.title,
        meta: t('manage.review.articleMeta', {
          authors: authors || t('manage.review.unknownAuthor'),
          when: ago(ms(a.updatedAt ?? a.createdAt), lang),
        }),
        at: ms(a.updatedAt ?? a.createdAt),
        secondary: { label: t('manage.review.open'), to: articleEditPath(a.id, 'admin') },
        primary: { label: t('manage.review.publish'), aria: t('manage.review.publishAria', { title: a.title }) },
      }
      row.primary.run = () => decide(row, () => publishArticle(a, {
        published: t('manage.review.articlePublished', { title: a.title }),
        undo: t('ui.undo'),
        undoFailed: adminErr,
      }), adminErr)
      list.push(row)
    }

    for (const c of data.corrections as StaffCorrection[]) {
      const label = `${c.subjectName} · ${t('manage.corrections.commission', { name: c.commissionName })}`
      const row: Row = {
        key: `correction-${c.id}`,
        id: c.id,
        source: 'corrections',
        kind: 'corrections',
        typeLabel: t('manage.review.types.correction'),
        title: label,
        meta: t('manage.review.correctionMeta', {
          proposed: slots(c.schedule, t),
          sga: slots(c.sgaSchedule, t),
          votes: t('manage.corrections.votes', { confirms: c.confirms, rejects: c.rejects }),
        }),
        at: ms(c.createdAt),
        primary: { label: t('manage.corrections.apply'), aria: t('manage.corrections.applyAria', { label }) },
        secondary: { label: t('manage.corrections.reject'), aria: t('manage.corrections.rejectAria', { label }) },
      }
      // Applying is undone from Correcciones (Revertir), so it doesn't ask.
      row.primary.run = () => decide(row, async () => {
        await applyCorrection(c.id)
        queue.remove('corrections', c.id)
        toast.success(t('manage.corrections.appliedNotice', { subject: c.subjectName, commission: c.commissionName }))
      }, adminErr)
      // A rejected correction never applies again by votes: it asks.
      row.secondary!.run = () => ask({
        row,
        title: t('manage.corrections.rejectTitle'),
        body: t('manage.corrections.rejectBody', { subject: c.subjectName, commission: c.commissionName }),
        confirmLabel: t('manage.corrections.rejectConfirm'),
        work: async () => {
          await rejectCorrection(c.id)
          queue.remove('corrections', c.id)
          toast.success(t('manage.corrections.rejectedNotice', { subject: c.subjectName, commission: c.commissionName }))
        },
        onError: adminErr,
      })
      list.push(row)
    }

    for (const s of data.sources as StaffSource[]) {
      const owner = s.ownerName || s.ownerEmail || t('manage.review.community')
      const row: Row = {
        key: `source-${s.id}`,
        id: s.id,
        source: 'sources',
        kind: 'apuntes',
        typeLabel: t('manage.review.types.source'),
        title: s.rootName,
        meta: t('manage.review.sourceMeta', { owner, count: s.fileCount, when: ago(ms(s.createdAt), lang) }),
        at: ms(s.createdAt),
        primary: { label: t('manage.drive.sources.approve'), aria: t('manage.drive.sources.approveAria', { name: s.rootName }) },
        secondary: { label: t('manage.drive.sources.block'), aria: t('manage.drive.sources.blockAria', { name: s.rootName }) },
      }
      row.primary.run = () => decide(row, async () => {
        await approveSource(s.id)
        queue.remove('sources', s.id)
        toast.success(t('manage.drive.sources.approvedNotice', { name: s.rootName }))
      }, apuntesErr)
      row.secondary!.run = () => ask({
        row,
        title: t('manage.drive.sources.blockTitle'),
        body: t('manage.drive.sources.blockBody', { name: s.rootName, owner }),
        confirmLabel: t('manage.drive.sources.blockConfirm'),
        work: async () => {
          await blockSource(s.id)
          queue.remove('sources', s.id)
          toast.success(t('manage.drive.sources.blockedNotice', { name: s.rootName }))
        },
        onError: apuntesErr,
      })
      list.push(row)
    }

    const fileRow = (f: StaffFile, source: 'needsReview' | 'reported') => {
      const reported = source === 'reported'
      const first = [...(f.reports ?? [])].sort((a, b) => ms(a.createdAt) - ms(b.createdAt))[0]
      const at = reported && first ? ms(first.createdAt) : ms(f.driveModifiedAt)
      const subject = f.effectiveSubjectName || t('manage.review.noSubject')
      const row: Row = {
        key: `${source}-${f.id}`,
        id: f.id,
        source,
        kind: 'apuntes',
        typeLabel: t(reported ? 'manage.review.types.fileReported' : 'manage.review.types.fileReview'),
        title: f.name,
        meta: reported
          ? t('manage.review.fileReportedMeta', {
            subject,
            count: f.reportCount,
            reason: first ? t(`apuntes.report.reasons.${first.reason}`) : '',
          })
          : t('manage.review.fileReviewMeta', {
            subject,
            sharer: f.sharerName || f.sharerEmail || t('manage.review.unknownAuthor'),
          }),
        at,
        primary: { label: t(reported ? 'manage.drive.files.restore' : 'manage.drive.files.publish') },
        secondary: { label: t('manage.drive.files.remove') },
      }
      row.primary.run = () => decide(row, async () => {
        await (reported ? restoreStaffFile(f.id) : publishStaffFile(f.id))
        queue.remove(source, f.id)
        toast.success(t(reported ? 'manage.drive.files.restoreNotice' : 'manage.drive.files.publishNotice', { name: f.name }))
      }, apuntesErr)
      row.secondary!.run = () => ask({
        row,
        title: t('manage.drive.files.removeTitle'),
        body: t('manage.drive.files.removeBody', { name: f.name }),
        confirmLabel: t('manage.drive.files.remove'),
        work: async () => {
          await removeStaffFile(f.id)
          queue.remove(source, f.id)
          toast.success(t('manage.drive.files.removeNotice', { name: f.name }))
        },
        onError: apuntesErr,
      })
      return row
    }
    for (const f of data.needsReview) list.push(fileRow(f, 'needsReview'))
    for (const f of data.reported) list.push(fileRow(f, 'reported'))

    // Wiki IA decisions need the cost context of the Wiki IA area: the row
    // says what's waiting and opens it there.
    for (const r of data.wikiRuns as KbRun[]) {
      const blocked = isBlockedStatus(r.status)
      const when = ms(r.finishedAt ?? r.startedAt)
      list.push({
        key: `wiki-${r.id}`,
        id: r.id,
        source: 'wiki',
        kind: 'wiki',
        typeLabel: t('manage.review.types.wiki'),
        title: t(blocked ? 'manage.review.wikiBlockedTitle' : 'manage.review.wikiFailedTitle'),
        meta: t(blocked ? 'manage.review.wikiBlockedMeta' : 'manage.review.wikiFailedMeta', {
          when: new Date(when).toLocaleString(lang, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }),
          count: r.subjects?.length ?? 0,
        }),
        at: when,
        primary: { label: t(blocked ? 'manage.review.wikiReviewCost' : 'manage.review.wikiOpen'), to: areaPath('wiki') },
      })
    }

    return list.sort((a, b) => a.at - b.at)
    // decide/ask close over state setters only; rows rebuild with the data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, t, lang])

  const visible = filter === 'all' ? rows : rows.filter((r) => r.kind === filter)
  const failed = (Object.keys(status) as SourceId[]).filter((s) => status[s] === 'error')
  const firstLoad = rows.length === 0 && (Object.values(status) as string[]).some((s) => s === 'loading')

  // Only kinds with something waiting get a filter (plus the active one).
  const kinds: QueueKind[] = ['articles', 'corrections', 'apuntes', 'wiki']
  const filterOptions = [
    { value: 'all' as Filter, label: t('manage.review.filters.all', { count: counts.total }) },
    ...kinds
      .filter((k) => counts[k] > 0 || filter === k)
      .map((k) => ({ value: k as Filter, label: t(`manage.review.filters.${k}`, { count: counts[k] }) })),
  ]

  const truncated: ReactNode[] = []
  const more = (id: string, shown: number, total: number, area: Parameters<typeof areaPath>[0]) => {
    if (total > shown) {
      truncated.push(
        <p key={id} className="font-body text-body-sm text-ink-secondary dark:text-night-muted">
          {t(`manage.review.truncated.${id}`, { shown, total })}{' '}
          <Link to={areaPath(area)} className="text-primary dark:text-primary-300 underline underline-offset-2">{t('manage.review.seeAll')}</Link>
        </p>,
      )
    }
  }
  more('corrections', data.corrections.length, data.correctionsTotal, 'corrections')
  more('sources', data.sources.length, data.sourcesTotal, 'apuntes')
  more('needsReview', data.needsReview.length, data.needsReviewTotal, 'apuntes')
  more('reported', data.reported.length, data.reportedTotal, 'apuntes')

  return (
    <div className="flex flex-wrap items-start gap-8">
      <section aria-labelledby="review-title" className="flex-[999_1_420px] min-w-0 flex flex-col gap-4">
        <header>
          <h1 id="review-title" className="font-display font-bold text-h2 text-ink-primary dark:text-night-text">{t('manage.review.title')}</h1>
          <p className="font-body text-body text-ink-secondary dark:text-night-muted mt-1">
            {firstLoad ? t('manage.review.checking') : t('manage.review.pending', { count: counts.total })}
          </p>
        </header>

        {filterOptions.length > 1 && (
          <ToggleGroup label={t('manage.review.filterAria')} value={filter} onChange={setFilter} options={filterOptions} />
        )}

        {failed.length > 0 && (
          <Alert
            tone="error"
            action={<Button size="sm" variant="outline" onClick={() => failed.forEach((s) => queue.reloadSource(s))}>{t('errors.retry')}</Button>}
          >
            {t('manage.review.sourceFailed', { sources: failed.map((s) => t(`manage.review.sources.${s}`)).join(', ') })}
          </Alert>
        )}

        {firstLoad ? (
          <LoadingRegion className="flex flex-col gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface p-4 flex flex-col gap-2" aria-hidden="true">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ))}
          </LoadingRegion>
        ) : visible.length === 0 ? (
          failed.length > 0
            ? null
            : <EmptyState title={t('manage.review.emptyTitle')} body={t('manage.review.emptyBody')} />
        ) : (
          <ul className="list-none m-0 p-0 flex flex-col gap-3">
            {visible.map((r) => (
              <li
                key={r.key}
                className="rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface shadow-card px-4 sm:px-5 py-4 flex flex-wrap items-center gap-x-5 gap-y-3"
              >
                <div className="flex-[1_1_320px] min-w-0 flex flex-col gap-1.5">
                  <Badge tone={KIND_TONE[r.kind]} className="self-start">{r.typeLabel}</Badge>
                  <p className="font-body font-semibold text-body text-ink-primary dark:text-night-text leading-snug break-words">{r.title}</p>
                  <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{r.meta}</p>
                </div>
                <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                  {r.secondary && <ActionButton action={r.secondary} variant="outline" disabled={busy === r.key} />}
                  <ActionButton action={r.primary} variant="primary" loading={busy === r.key} />
                </div>
              </li>
            ))}
          </ul>
        )}
        {truncated}
      </section>

      <aside className="flex-[1_1_240px] flex flex-col gap-4">
        <DigestCard />
        <div className="rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface p-5 flex flex-col">
          <p className="mb-1 font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">{t('manage.review.quick.title')}</p>
          <QuickLink to={areaPath('benefits')}>{t('manage.review.quick.benefit')}</QuickLink>
          <QuickLink to={areaPath('organizations')}>{t('manage.review.quick.org')}</QuickLink>
          <QuickLink to={areaPath('people')}>{t('manage.review.quick.staff')}</QuickLink>
        </div>
      </aside>

      {pending && (
        <ConfirmDialog
          title={pending.title}
          body={pending.body}
          confirmLabel={pending.confirmLabel}
          busy={pendingBusy}
          error={pendingError}
          onConfirm={pending.run}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  )
}

function ActionButton({ action, variant, loading = false, disabled = false }: {
  action: RowAction
  variant: 'primary' | 'outline'
  loading?: boolean
  disabled?: boolean
}) {
  if (action.to) {
    return (
      <Link to={action.to} aria-label={action.aria} className={buttonClass({ variant, size: 'sm', className: 'flex-1 sm:flex-none' })}>
        {action.label}
      </Link>
    )
  }
  return (
    <Button
      variant={variant}
      size="sm"
      className="flex-1 sm:flex-none"
      aria-label={action.aria}
      loading={loading}
      disabled={disabled}
      onClick={action.run}
    >
      {action.label}
    </Button>
  )
}

function QuickLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="block py-2.5 font-body font-semibold text-body-sm text-primary dark:text-primary-300 hover:underline underline-offset-4"
    >
      {children} <span aria-hidden="true" className="ml-1">→</span>
    </Link>
  )
}
