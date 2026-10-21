import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { CostImpact } from '../../../api/kbAdmin'
import {
  Alert, Badge, Button, EmptyState, ErrorState, Field, LoadingRegion, Modal, Skeleton, SkeletonCards, textareaClass,
} from '@/components/ui'
import { apuntesAdminErrorMessage } from '../adminErrors'
import { basisText, range, usd } from './format'
import type { Loaded } from './useLoad'
import { statusInfo } from './status'

// Shared components for the "Wiki IA" admin views. Formatting helpers live
// in format.ts, table cell classes in styles.ts and useLoad in useLoad.ts.

// Loading / unavailable / error / empty wrapper for a view or a panel.
export function ViewState<T>({ state, empty, emptyText, emptyBody, emptyAction, skeleton = 'block', children }: {
  state: Loaded<T>
  empty?: (d: T) => boolean
  emptyText?: string
  emptyBody?: ReactNode
  emptyAction?: ReactNode
  skeleton?: 'block' | 'rows' | 'cards'
  children: (d: T) => ReactNode
}) {
  const { t } = useTranslation()
  if (state.loading && state.data == null) {
    if (skeleton === 'cards') {
      return <SkeletonCards count={4} className="grid grid-cols-2 lg:grid-cols-4 gap-3" cardClassName="h-24" />
    }
    return (
      <LoadingRegion className="flex flex-col gap-2">
        {skeleton === 'block'
          ? <Skeleton className="h-48 rounded-card" />
          : Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
      </LoadingRegion>
    )
  }
  if (state.unavailable) {
    return <EmptyState compact title={t('manage.wikiAi.unavailableTitle')} body={t('manage.wikiAi.unavailable')} />
  }
  if (state.error && state.data == null) {
    return <ErrorState compact title={t('manage.errors.loadFailed')} message={state.error} onRetry={state.reload} />
  }
  if (state.data == null) return null
  if (empty?.(state.data)) {
    return <EmptyState compact title={emptyText ?? t('manage.wikiAi.empty')} body={emptyBody} action={emptyAction} />
  }
  return <>{children(state.data)}</>
}


export function Panel({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface p-4 ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          {title && <h3 className="font-display font-bold text-h5 text-ink-primary dark:text-night-text">{title}</h3>}
          {actions}
        </div>
      )}
      {children}
    </section>
  )
}

export function StatusPill({ status }: { status: string | null | undefined }) {
  const { t } = useTranslation()
  const info = statusInfo(status)
  if (!info) return <Badge>—</Badge>
  return <Badge tone={info.tone}>{t(`manage.wikiAi.status.${info.key}`)}</Badge>
}

// Confirmation for settings changes and promotions: shows the weekly cost
// impact (previous vs projected) and takes an optional note.
export function CostImpactDialog({ title, body, loadImpact, onConfirm, onCancel }: {
  title: string
  body?: ReactNode
  // Resolves to null when the impact can only be known after saving.
  loadImpact?: () => Promise<CostImpact | null>
  onConfirm: (note: string) => Promise<CostImpact | null | undefined>
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [impact, setImpact] = useState<CostImpact | null | undefined>(undefined)
  const [after, setAfter] = useState<CostImpact | null | undefined>(undefined)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!loadImpact) { setImpact(null); return }
    let cancelled = false
    loadImpact()
      .then((i) => { if (!cancelled) setImpact(i) })
      .catch((e) => { if (!cancelled) { setImpact(null); setError(apuntesAdminErrorMessage(e, t)) } })
    return () => { cancelled = true }
  }, [loadImpact, t])

  async function confirm() {
    setBusy(true); setError(null)
    try {
      const result = await onConfirm(note.trim())
      setAfter(result ?? null)
    } catch (e) {
      setError(apuntesAdminErrorMessage(e, t))
    } finally {
      setBusy(false)
    }
  }

  // After saving, the server's numbers win; forecast-only fields (monthly,
  // full rebuild) are kept from the preview.
  const shown = after ? { ...(impact ?? {}), ...stripNulls(after) } as CostImpact : impact
  const done = after !== undefined
  return (
    <Modal
      title={done ? t('manage.wikiAi.saved') : title}
      onClose={onCancel}
      busy={busy}
      size="lg"
      footer={done ? (
        <Button onClick={onCancel}>{t('manage.wikiAi.close')}</Button>
      ) : (
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>{t('manage.cancel')}</Button>
          <Button onClick={confirm} loading={busy}>{t('manage.wikiAi.confirmSave')}</Button>
        </>
      )}
    >
      {body && <div className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{body}</div>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ImpactCard label={t('manage.wikiAi.impact.previous')} value={shown === undefined ? undefined : shown?.previousWeeklyAvgUsd ?? null} />
        <ImpactCard
          label={t('manage.wikiAi.impact.projected')}
          value={shown === undefined ? undefined : shown?.projectedWeeklyAvgUsd ?? null}
          delta={shown?.previousWeeklyAvgUsd != null && shown?.projectedWeeklyAvgUsd != null ? shown.projectedWeeklyAvgUsd - shown.previousWeeklyAvgUsd : null}
        />
      </div>
      {shown && (shown.projectedRange?.low != null || shown.projectedMonthly || shown.fullRebuildUsd != null) && (
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 font-body text-body-sm">
          {shown.projectedRange?.low != null && shown.projectedRange.high != null && (
            <div className="flex flex-wrap justify-between gap-x-2"><dt className="text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.forecast.weeklyRange')}</dt><dd className="tabular-nums">{range(shown.projectedRange.low, shown.projectedRange.high)}</dd></div>
          )}
          {shown.projectedMonthly?.expectedUsd != null && (
            <div className="flex flex-wrap justify-between gap-x-2">
              <dt className="text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.forecast.monthly')}</dt>
              <dd className="tabular-nums">
                {usd(shown.projectedMonthly.expectedUsd, 2)}
                {shown.projectedMonthly.low != null && shown.projectedMonthly.high != null && (
                  <span className="text-ink-secondary dark:text-night-muted"> ({range(shown.projectedMonthly.low, shown.projectedMonthly.high)})</span>
                )}
              </dd>
            </div>
          )}
          {shown.fullRebuildUsd != null && (
            <p className="sm:col-span-2 mt-1 px-3 py-2 rounded-xs bg-page-bg dark:bg-night-bg">{t('manage.wikiAi.forecast.fullRebuild', { cost: usd(shown.fullRebuildUsd, 2) })}</p>
          )}
          {shown.basis && (
            <p className="sm:col-span-2 font-body text-label text-ink-secondary dark:text-night-muted">{basisText(shown.basis, shown.runsUsed, t)}</p>
          )}
        </dl>
      )}
      {shown === null && !done && (
        <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.impact.afterSave')}</p>
      )}
      {!done && (
        <Field label={t('manage.wikiAi.note')}>
          {(p) => <textarea {...p} value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} className={textareaClass()} />}
        </Field>
      )}
      {error && <Alert tone="error">{error}</Alert>}
    </Modal>
  )
}

function ImpactCard({ label, value, delta }: { label: string; value: number | null | undefined; delta?: number | null }) {
  const { t } = useTranslation()
  return (
    <div className="rounded-xs border border-border dark:border-night-border p-3">
      <p className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">{label}</p>
      {value === undefined ? (
        <Skeleton className="h-7 mt-1" />
      ) : (
        <p className="font-display font-bold text-h5 sm:text-h4 text-ink-primary dark:text-night-text tabular-nums wrap-break-word">
          {value == null ? '—' : usd(value, 2)}
          <span className="font-body text-body-sm font-normal text-ink-secondary dark:text-night-muted"> {t('manage.wikiAi.perWeek')}</span>
        </p>
      )}
      {delta != null && (
        <p className={`font-mono text-label ${delta > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
          {delta > 0 ? '+' : '−'}{usd(Math.abs(delta), 2)}
        </p>
      )}
    </div>
  )
}

function stripNulls<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v != null)) as Partial<T>
}
