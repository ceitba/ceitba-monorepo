import type { CostRow } from '../../../api/kbAdmin'

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
