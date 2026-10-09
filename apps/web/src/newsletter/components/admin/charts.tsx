import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ToggleGroup } from '@/components/ui'

// Building blocks of the newsletter stats pages (staff analytics and an
// organization's Estadísticas): cards, a daily sparkline, horizontal bars.
// CSS only, no chart library.

export const statCard = 'bg-white dark:bg-night-surface rounded-card border border-border dark:border-night-border shadow-card p-5'
export const statCardLabel = 'font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted'

export function RangePicker({ ranges, active, onChange }: {
  ranges: { key: string; days: number }[]
  active: number
  onChange: (days: number) => void
}) {
  const { t } = useTranslation()
  return (
    <ToggleGroup
      joined
      label={t('admin.analytics.rangeLabel')}
      value={active}
      onChange={onChange}
      options={ranges.map(({ key, days }) => ({ value: days, key, label: t(`admin.analytics.ranges.${key}`) }))}
    />
  )
}

export function StatCard({ label, value, icon, hint }: { label: string; value: string; icon: ReactNode; hint?: string }) {
  return (
    <div className={`${statCard} flex flex-col gap-2`}>
      <div className="w-8 h-8 text-primary dark:text-primary-300" aria-hidden="true">{icon}</div>
      <p className="font-display text-h3 font-bold text-ink-primary dark:text-night-text tabular-nums">{value}</p>
      <p className="font-mono text-label text-ink-secondary dark:text-night-muted uppercase tracking-widest">{label}</p>
      {hint && <p className="font-body text-label text-ink-secondary dark:text-night-muted">{hint}</p>}
    </div>
  )
}

export interface SparkPoint {
  date: string // YYYY-MM-DD
  value: number
}

// Daily bars with min / max / last as text (the values without hovering)
// and a screen-reader table.
export function Sparkline({ id, title, data, fmtDay, fmtNum, valueLabel, barClass = 'bg-primary-200 dark:bg-primary-700', floor = 4 }: {
  id: string
  title: string
  data: SparkPoint[]
  fmtDay: (iso: string) => string
  fmtNum: (n: number) => string
  valueLabel: string
  barClass?: string
  // Minimum bar height in %, so zero days still show a sliver.
  floor?: number
}) {
  const { t } = useTranslation()
  const values = data.map((d) => d.value)
  const max = Math.max(...values, 1)
  if (data.length === 0) return null
  return (
    <section className={statCard} aria-labelledby={id}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-4">
        <h3 id={id} className={statCardLabel}>{title}</h3>
        <p className="font-mono text-label text-ink-secondary dark:text-night-muted">
          {t('admin.analytics.sparkSummary', {
            min: fmtNum(Math.min(...values)),
            max: fmtNum(Math.max(...values)),
            last: fmtNum(values[values.length - 1] ?? 0),
          })}
        </p>
      </div>
      <div className="flex items-end gap-1 h-20" aria-hidden="true">
        {data.map(({ date, value }) => (
          <div key={date} className="flex-1 h-full flex flex-col justify-end items-center">
            <div className={`w-full rounded-sm ${barClass}`} style={{ height: `${Math.max(floor, (value / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="flex justify-between mt-1 font-mono text-label text-ink-secondary dark:text-night-muted" aria-hidden="true">
        <span>{fmtDay(data[0].date)}</span>
        <span>{fmtDay(data[data.length - 1].date)}</span>
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr><th scope="col">{t('admin.analytics.columns.day')}</th><th scope="col">{valueLabel}</th></tr>
        </thead>
        <tbody>
          {data.map(({ date, value }) => (
            <tr key={date}><td>{fmtDay(date)}</td><td>{value}</td></tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

export interface BarDatum {
  label: string
  value: number
}

export function BarChart({ data, colorClass }: { data: BarDatum[]; colorClass: string }) {
  const max = Math.max(...data.map((d) => d.value), 1)
  return (
    <ul className="flex flex-col gap-3 list-none m-0 p-0">
      {data.map(({ label, value }, i) => (
        <li key={`${label}-${i}`} className="flex items-center gap-3">
          <span className="w-36 font-body text-body-sm text-ink-secondary dark:text-night-muted text-right flex-shrink-0 break-words">
            {label}
          </span>
          <div className="flex-1 bg-page-bg dark:bg-night-raised rounded-full h-2.5" aria-hidden="true">
            <div className={['h-2.5 rounded-full', colorClass].join(' ')} style={{ width: `${(value / max) * 100}%` }} />
          </div>
          <span className="w-10 font-mono text-label text-ink-secondary dark:text-night-muted text-right flex-shrink-0">{value}</span>
        </li>
      ))}
    </ul>
  )
}

export function EmptyMetric({ label }: { label: string }) {
  return <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted py-4 text-center">{label}</p>
}

export function IconEye() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
}
export function IconUser() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
}
export function IconThumb() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
}
export function IconHeart() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
}
export function IconBell() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
}
export function IconMail() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/></svg>
}
