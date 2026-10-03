import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CostRow } from '../../../api/kbAdmin'
import { usd } from './shared'

// Weekly cost, stacked by stage or by model. Categorical slots in fixed
// order (reference palette: blue, orange, aqua, yellow, magenta, green,
// violet, red), 2px surface gaps between segments, a legend, hover
// tooltips, and a table view for exact values.

export interface StackSeries { key: string; label: string }

const SLOTS = 8

function rowParts(r: CostRow): { week: string; series: string } {
  const key = r.key
  if (key && typeof key === 'object') {
    return { week: key.week ?? Object.values(key)[0] ?? '', series: key.stage ?? key.model ?? Object.values(key)[1] ?? 'total' }
  }
  const [a, b] = String(key ?? '').split(/[|/]/)
  return { week: r.week ?? a ?? '', series: r.stage ?? r.model ?? b ?? 'total' }
}

export function weeklyStacks(rows: CostRow[], order?: string[]) {
  const weeks = new Map<string, Map<string, number>>()
  const totals = new Map<string, number>()
  for (const r of rows) {
    const { week, series } = rowParts(r)
    if (!weeks.has(week)) weeks.set(week, new Map())
    const m = weeks.get(week)!
    m.set(series, (m.get(series) ?? 0) + (r.costUsd ?? 0))
    totals.set(series, (totals.get(series) ?? 0) + (r.costUsd ?? 0))
  }
  const known = order?.filter((k) => totals.has(k)) ?? []
  const rest = [...totals.keys()].filter((k) => !known.includes(k)).sort((a, b) => totals.get(b)! - totals.get(a)!)
  let series = [...known, ...rest]
  // Never more than 8 hues: the tail folds into "other".
  if (series.length > SLOTS) {
    const keep = series.slice(0, SLOTS - 1)
    const fold = new Set(series.slice(SLOTS - 1))
    for (const m of weeks.values()) {
      let other = 0
      for (const k of fold) { other += m.get(k) ?? 0; m.delete(k) }
      if (other) m.set('__other', other)
    }
    series = [...keep, '__other']
  }
  return { weeks: [...weeks.entries()].sort((a, b) => a[0].localeCompare(b[0])), series }
}

export default function CostChart({ rows, order, labelOf }: { rows: CostRow[]; order?: string[]; labelOf: (k: string) => string }) {
  const { t } = useTranslation()
  const { weeks, series } = useMemo(() => weeklyStacks(rows, order), [rows, order])
  const [hover, setHover] = useState<{ week: string; series: string; x: number; y: number } | null>(null)
  const [table, setTable] = useState(false)
  const label = (k: string) => (k === '__other' ? t('manage.wikiAi.chart.other') : labelOf(k))

  // Drawn at the container's real pixel width so text and marks keep their
  // size (no viewBox scaling).
  const wrapRef = useRef<HTMLDivElement>(null)
  const [W, setW] = useState(640)
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(Math.max(280, el.clientWidth)))
    setW(Math.max(280, el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [table])
  const H = 240, padL = 64, padB = 28, padT = 10, padR = 8
  const max = Math.max(0.0001, ...weeks.map(([, m]) => [...m.values()].reduce((a, b) => a + b, 0)))
  const nice = niceMax(max)
  const bw = Math.min(36, (W - padL - padR) / Math.max(weeks.length, 1) * 0.62)
  const step = (W - padL - padR) / Math.max(weeks.length, 1)
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / nice)

  if (weeks.length === 0) return <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted py-6 text-center">{t('manage.wikiAi.chart.noData')}</p>

  return (
    <div className="kbviz flex flex-col gap-2">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 font-body text-body-sm text-ink-secondary dark:text-night-muted" aria-label={t('wiki.legend')}>
        {series.map((s, i) => (
          <li key={s} className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: `var(--series-${i + 1})` }} aria-hidden="true" />
            {label(s)}
          </li>
        ))}
        <li className="ml-auto">
          <button type="button" onClick={() => setTable((v) => !v)} className="font-mono text-label uppercase tracking-widest hover:text-primary">
            {table ? t('manage.wikiAi.chart.showChart') : t('manage.wikiAi.chart.showTable')}
          </button>
        </li>
      </ul>
      {table ? (
        <div className="overflow-x-auto">
          <table className="w-full font-body text-body-sm">
            <thead><tr>
              <th className="px-2 py-1 text-left font-mono text-label uppercase tracking-widest">{t('manage.wikiAi.chart.week')}</th>
              {series.map((s) => <th key={s} className="px-2 py-1 text-right font-mono text-label uppercase tracking-widest">{label(s)}</th>)}
              <th className="px-2 py-1 text-right font-mono text-label uppercase tracking-widest">{t('manage.wikiAi.chart.total')}</th>
            </tr></thead>
            <tbody>
              {weeks.map(([w, m]) => (
                <tr key={w} className="border-t border-border dark:border-night-border">
                  <td className="px-2 py-1 font-mono text-label">{w}</td>
                  {series.map((s) => <td key={s} className="px-2 py-1 text-right tabular-nums">{usd(m.get(s) ?? 0, 2)}</td>)}
                  <td className="px-2 py-1 text-right tabular-nums font-semibold">{usd([...m.values()].reduce((a, b) => a + b, 0), 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative" ref={wrapRef}>
          <svg width={W} height={H} className="block" role="img" aria-label={t('manage.wikiAi.chart.aria')}>
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line x1={padL} x2={W - padR} y1={y(nice * f)} y2={y(nice * f)} className="kbviz-grid" />
                <text x={padL - 6} y={y(nice * f)} dy="0.35em" textAnchor="end" className="kbviz-axis">{usd(nice * f, Number.isInteger(nice * f) ? 0 : 2)}</text>
              </g>
            ))}
            {weeks.map(([w, m], wi) => {
              const cx = padL + step * wi + step / 2
              let acc = 0
              const segs = series.map((s, si) => {
                const v = m.get(s) ?? 0
                if (v <= 0) return null
                const top = y(acc + v), bottom = y(acc)
                acc += v
                const h = Math.max(0, bottom - top - 2) // 2px surface gap
                return (
                  <rect
                    key={s}
                    x={cx - bw / 2}
                    y={top}
                    width={bw}
                    height={h}
                    rx={2}
                    style={{ fill: `var(--series-${si + 1})` }}
                    onMouseEnter={() => setHover({ week: w, series: s, x: cx, y: top })}
                    onMouseLeave={() => setHover(null)}
                  />
                )
              })
              return (
                <g key={w}>
                  {segs}
                  <text x={cx} y={H - 10} textAnchor="middle" className="kbviz-axis">{shortWeek(w)}</text>
                </g>
              )
            })}
          </svg>
          {hover && (
            <div
              className="pointer-events-none absolute z-10 px-2 py-1 rounded-sm border border-border dark:border-night-border bg-white dark:bg-night-surface shadow-card font-body text-body-sm text-ink-primary dark:text-night-text whitespace-nowrap"
              style={{ left: hover.x, top: hover.y, transform: 'translate(-50%, calc(-100% - 6px))' }}
            >
              <span className="font-mono text-label text-ink-secondary dark:text-night-muted">{hover.week}</span>
              <br />
              {label(hover.series)}: <strong>{usd(weeks.find(([w]) => w === hover.week)?.[1].get(hover.series) ?? 0, 2)}</strong>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function niceMax(v: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / p
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p
}

function shortWeek(w: string): string {
  const m = /W(\d+)/.exec(w)
  if (m) return `S${m[1]}`
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(w)
  return d ? `${d[3]}/${d[2]}` : w.slice(0, 8)
}
