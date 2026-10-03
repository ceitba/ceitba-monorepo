import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { CostImpact } from '../../../api/kbAdmin'
import Modal from '../../../components/Modal'
import { apuntesErrorMessage } from '../../../utils/apuntes'
import { basisText, range, usd } from './format'
import { BTN_PRI, FIELD } from './styles'
import type { Loaded } from './useLoad'

// Shared components for the "Wiki IA" admin views. Formatting helpers live
// in format.ts, class strings in styles.ts and useLoad in useLoad.ts.

// Loading / unavailable / error / empty wrapper for a view or a panel.
export function ViewState<T>({ state, empty, emptyText, skeleton = 'block', children }: {
  state: Loaded<T>
  empty?: (d: T) => boolean
  emptyText?: string
  skeleton?: 'block' | 'rows' | 'cards'
  children: (d: T) => ReactNode
}) {
  const { t } = useTranslation()
  if (state.loading && state.data == null) {
    return (
      <div aria-busy="true" aria-hidden="true" className={skeleton === 'cards' ? 'grid grid-cols-2 lg:grid-cols-4 gap-3' : 'flex flex-col gap-2'}>
        {Array.from({ length: skeleton === 'block' ? 1 : 4 }).map((_, i) => (
          <div key={i} className={`rounded-card skeleton ${skeleton === 'block' ? 'h-48' : skeleton === 'cards' ? 'h-24' : 'h-10'}`} />
        ))}
      </div>
    )
  }
  if (state.unavailable) {
    return (
      <div className="px-4 py-6 rounded-card border border-dashed border-border dark:border-night-border text-center font-body text-body-sm text-ink-secondary dark:text-night-muted">
        {t('manage.wikiAi.unavailable')}
      </div>
    )
  }
  if (state.error && state.data == null) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 px-4 py-4 rounded-card border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 font-body text-body-sm text-red-700 dark:text-red-300">
        <span className="flex-1">{state.error}</span>
        <button type="button" onClick={state.reload} className="font-mono text-label uppercase tracking-widest underline">{t('errors.retry')}</button>
      </div>
    )
  }
  if (state.data == null) return null
  if (empty?.(state.data)) {
    return (
      <p className="px-4 py-8 rounded-card border border-border dark:border-night-border text-center font-body text-body-sm text-ink-secondary dark:text-night-muted">
        {emptyText ?? t('manage.wikiAi.empty')}
      </p>
    )
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
  const s = (status ?? '').toUpperCase()
  const tone =
    /FAIL|ERROR|EXPIRED|CANCEL/.test(s) ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'
      : /BLOCKED/.test(s) ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
        : /DONE|COMPLETE|SUCCE|PUBLISHED|OK/.test(s) ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
          : 'bg-primary-50 text-primary-700 dark:bg-primary-900 dark:text-primary-200'
  return <span className={`inline-block px-2 py-0.5 rounded-sm font-mono text-label uppercase tracking-widest whitespace-nowrap ${tone}`}>{status ?? '—'}</span>
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
      .catch((e) => { if (!cancelled) { setImpact(null); setError(apuntesErrorMessage(e, t)) } })
    return () => { cancelled = true }
  }, [loadImpact, t])

  async function confirm() {
    setBusy(true); setError(null)
    try {
      const result = await onConfirm(note.trim())
      setAfter(result ?? null)
    } catch (e) {
      setError(apuntesErrorMessage(e, t))
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
        <button type="button" onClick={onCancel} className={BTN_PRI}>{t('manage.wikiAi.close')}</button>
      ) : (
        <>
          <button type="button" onClick={onCancel} disabled={busy} className="px-3 py-1.5 font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">{t('manage.cancel')}</button>
          <button type="button" onClick={confirm} disabled={busy} className={BTN_PRI}>{busy ? '…' : t('manage.wikiAi.confirmSave')}</button>
        </>
      )}
    >
      {body && <div className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{body}</div>}
      <div className="grid grid-cols-2 gap-3">
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
            <div className="flex justify-between gap-2"><dt className="text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.forecast.weeklyRange')}</dt><dd className="tabular-nums">{range(shown.projectedRange.low, shown.projectedRange.high)}</dd></div>
          )}
          {shown.projectedMonthly?.expectedUsd != null && (
            <div className="flex justify-between gap-2">
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
            <p className="sm:col-span-2 mt-1 px-3 py-2 rounded-sm bg-page-bg dark:bg-night-bg">{t('manage.wikiAi.forecast.fullRebuild', { cost: usd(shown.fullRebuildUsd, 2) })}</p>
          )}
          {shown.basis && (
            <p className="sm:col-span-2 font-body text-[0.75rem] text-ink-secondary dark:text-night-muted">{basisText(shown.basis, shown.runsUsed, t)}</p>
          )}
        </dl>
      )}
      {shown === null && !done && (
        <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.impact.afterSave')}</p>
      )}
      {!done && (
        <label className="flex flex-col gap-1">
          <span className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.note')}</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} className={FIELD} />
        </label>
      )}
      {error && <p role="alert" className="font-body text-body-sm text-red-600 dark:text-red-400">{error}</p>}
    </Modal>
  )
}

function ImpactCard({ label, value, delta }: { label: string; value: number | null | undefined; delta?: number | null }) {
  const { t } = useTranslation()
  return (
    <div className="rounded-sm border border-border dark:border-night-border p-3">
      <p className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">{label}</p>
      {value === undefined ? (
        <div className="h-7 mt-1 rounded-sm skeleton" aria-hidden="true" />
      ) : (
        <p className="font-display font-bold text-h4 text-ink-primary dark:text-night-text">
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
