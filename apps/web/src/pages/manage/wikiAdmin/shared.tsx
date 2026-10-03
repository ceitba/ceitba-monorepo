import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../../../api/client'
import type { CostImpact } from '../../../api/kbAdmin'
import Modal from '../../../components/Modal'
import { apuntesErrorMessage } from '../../../utils/apuntes'

// Shared bits for the "Wiki IA" admin views.

export interface Loaded<T> {
  data: T | null
  loading: boolean
  error: string | null
  // The endpoint doesn't exist on this API build yet (404).
  unavailable: boolean
  reload: () => void
  setData: (fn: (d: T | null) => T | null) => void
}

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []): Loaded<T> {
  const { t } = useTranslation()
  const [data, setDataState] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [tick, setTick] = useState(0)
  const req = useRef(0)
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    const id = ++req.current
    setLoading(true)
    fnRef.current()
      .then((d) => { if (req.current === id) { setDataState(d); setError(null); setUnavailable(false) } })
      .catch((e) => {
        if (req.current !== id) return
        if (isUnavailable(e)) setUnavailable(true)
        else setError(apuntesErrorMessage(e, t))
      })
      .finally(() => { if (req.current === id) setLoading(false) })
  }, [tick, t, ...deps]) // eslint-disable-line react-hooks/exhaustive-deps

  const reload = useCallback(() => setTick((n) => n + 1), [])
  const setData = useCallback((f: (d: T | null) => T | null) => setDataState((d) => f(d)), [])
  return { data, loading, error, unavailable, reload, setData }
}

export function isUnavailable(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 404 || e.status === 405 || e.status === 501)
}

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

// ── Formatting ───────────────────────────────────────────────────────────

export function usd(n: number | null | undefined, digits?: number): string {
  if (n == null || Number.isNaN(n)) return '—'
  // Sub-cent amounts (probes, small runs) keep 4 decimals so they don't
  // all read "0.01" / "0.00".
  let d = digits ?? (Math.abs(n) < 1 ? 4 : 2)
  if (n !== 0 && Math.abs(n) < 0.01) d = Math.max(d, 4)
  return `US$ ${n.toLocaleString('en-US', { minimumFractionDigits: Math.min(d, 2), maximumFractionDigits: d })}`
}

export function tokens(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k`
  return String(n)
}

export function pct(r: number | null | undefined, digits = 0): string {
  if (r == null || Number.isNaN(r)) return '—'
  return `${(r * 100).toFixed(digits)}%`
}

export function duration(start?: string | null, end?: string | null): string {
  if (!start) return '—'
  const ms = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime()
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return h < 48 ? `${h} h ${m % 60} min` : `${Math.round(h / 24)} d`
}

export function secs(n: number | null | undefined): string {
  if (n == null) return '—'
  return n < 60 ? `${Math.round(n)}s` : n < 3600 ? `${Math.round(n / 60)} min` : `${(n / 3600).toFixed(1)} h`
}

// ── UI pieces ────────────────────────────────────────────────────────────

export const TH = 'px-3 py-2 font-mono text-label uppercase tracking-widest text-left whitespace-nowrap'
export const TD = 'px-3 py-2 align-top'
export const BTN = 'px-3 py-1.5 rounded-sm font-mono text-label uppercase tracking-widest border border-border dark:border-night-border hover:border-primary hover:text-primary transition-colors disabled:opacity-50 disabled:pointer-events-none'
export const BTN_PRI = 'px-3 py-1.5 rounded-sm font-mono text-label uppercase tracking-widest bg-primary text-white hover:bg-primary-600 disabled:opacity-50 disabled:pointer-events-none'
export const BTN_DANGER = 'px-3 py-1.5 rounded-sm font-mono text-label uppercase tracking-widest text-red-600 dark:text-red-400 hover:underline disabled:opacity-50'
export const FIELD = 'px-3 py-2 rounded-sm border border-border dark:border-night-border bg-white dark:bg-night-surface font-body text-body-sm text-ink-primary dark:text-night-text focus:outline-none focus:border-primary disabled:opacity-50'

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

export function range(low: number | null | undefined, high: number | null | undefined): string {
  if (low == null || high == null) return '—'
  return `${usd(low, 2)} – ${usd(high, 2)}`
}

// "según las últimas N ejecuciones" / "estimado por el volumen de apuntes".
export function basisText(basis: string | null | undefined, runs: number | null | undefined, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (basis === 'history') return t('manage.wikiAi.forecast.basis.history', { count: runs ?? 0 })
  if (basis === 'corpus') return t('manage.wikiAi.forecast.basis.corpus')
  if (basis === 'blend') return t('manage.wikiAi.forecast.basis.blend', { count: runs ?? 0 })
  return ''
}
