import { fetchPlanSubjects, type PlanSubject } from '../api/plans'
import { fetchMyPlanSubjects } from '../api/drive'

// Correlatividades (prerequisite) map of a career plan: model, ordering and
// layout shared by the full map, its mini preview and the subject header.

export interface CorrNode {
  id: string
  name: string
  year: number | null
  semester: number | null
  section: string | null
  credits: number | null
  creditsRequired: number
  deps: string[] // prerequisites present in the plan
  dependents: string[] // subjects that list this one as prerequisite
  curricular: boolean
  fileCount: number
  hasWiki: boolean
}

export interface CorrColumn {
  key: string
  year: number
  semester: number
  ids: string[]
}

export interface CorrModel {
  planId: string
  nodes: Map<string, CorrNode>
  columns: CorrColumn[]
  electives: { section: string; ids: string[] }[]
}

const isCurricular = (s: PlanSubject) => s.year != null && s.year > 0

export function buildModel(
  planId: string,
  list: PlanSubject[],
  extra: Map<string, { fileCount?: number; hasWiki?: boolean }> = new Map(),
): CorrModel {
  const nodes = new Map<string, CorrNode>()
  for (const s of list) {
    nodes.set(s.subjectId, {
      id: s.subjectId,
      name: s.subject?.name ?? s.subjectId,
      year: s.year,
      semester: s.semester,
      section: s.section,
      credits: s.subject?.credits ?? null,
      creditsRequired: s.creditsRequired ?? 0,
      deps: [],
      dependents: [],
      curricular: isCurricular(s),
      fileCount: extra.get(s.subjectId)?.fileCount ?? 0,
      hasWiki: !!extra.get(s.subjectId)?.hasWiki,
    })
  }
  for (const s of list) {
    const node = nodes.get(s.subjectId)!
    for (const d of s.dependencies ?? []) {
      if (!nodes.has(d) || d === s.subjectId || node.deps.includes(d)) continue
      node.deps.push(d)
      nodes.get(d)!.dependents.push(s.subjectId)
    }
  }

  const colMap = new Map<string, CorrColumn>()
  for (const n of nodes.values()) {
    if (!n.curricular) continue
    const sem = n.semester && n.semester > 0 ? n.semester : 1
    const key = `${n.year}.${sem}`
    if (!colMap.has(key)) colMap.set(key, { key, year: n.year!, semester: sem, ids: [] })
    colMap.get(key)!.ids.push(n.id)
  }
  const columns = [...colMap.values()].sort((a, b) => a.year - b.year || a.semester - b.semester)
  columns.forEach((c) => c.ids.sort())
  orderColumns(columns, nodes)

  const sections = new Map<string, string[]>()
  for (const n of nodes.values()) {
    if (n.curricular) continue
    const key = n.section?.trim() || ''
    if (!sections.has(key)) sections.set(key, [])
    sections.get(key)!.push(n.id)
  }
  const electives = [...sections.entries()]
    .sort((a, b) => Number(a[0] === '') - Number(b[0] === '') || a[0].localeCompare(b[0]))
    .map(([section, ids]) => ({ section, ids: ids.sort() }))

  return { planId, nodes, columns, electives }
}

// Barycenter heuristic: a few left→right and right→left sweeps ordering
// each column by the mean row of its neighbours in other columns.
function orderColumns(columns: CorrColumn[], nodes: Map<string, CorrNode>) {
  const pos = new Map<string, { col: number; row: number }>()
  const refresh = () => columns.forEach((c, ci) => c.ids.forEach((id, ri) => pos.set(id, { col: ci, row: ri })))
  refresh()
  const sortBy = (ci: number, neighbours: (n: CorrNode) => string[], before: boolean) => {
    const col = columns[ci]
    const score = new Map<string, number>()
    col.ids.forEach((id, i) => {
      const rows = neighbours(nodes.get(id)!)
        .map((x) => pos.get(x))
        .filter((p): p is { col: number; row: number } => !!p && (before ? p.col < ci : p.col > ci))
        .map((p) => p.row)
      score.set(id, rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : i)
    })
    col.ids.sort((a, b) => score.get(a)! - score.get(b)! || a.localeCompare(b))
    refresh()
  }
  for (let sweep = 0; sweep < 3; sweep++) {
    for (let ci = 1; ci < columns.length; ci++) sortBy(ci, (n) => n.deps, true)
    for (let ci = columns.length - 2; ci >= 0; ci--) sortBy(ci, (n) => n.dependents, false)
  }
}

// Transitive closure along `next` (excluding the start).
export function closure(start: string, next: (id: string) => string[]): Set<string> {
  const out = new Set<string>()
  const stack = [...next(start)]
  while (stack.length) {
    const id = stack.pop()!
    if (out.has(id) || id === start) continue
    out.add(id)
    stack.push(...next(id))
  }
  return out
}

// ── Layout of the curricular columns ──────────────────────────────────────

export interface CorrLayout {
  width: number
  height: number
  pos: Map<string, { x: number; y: number }>
  columnX: number[]
  // Column index per subject, and per column the y of each row gap (above
  // the first card, between cards, below the last) for edge routing.
  colOf: Map<string, number>
  gapYs: number[][]
  cardW: number
  cardH: number
  header: number
}

export function layoutColumns(model: CorrModel, opts: { cardW?: number; cardH?: number; colGap?: number; rowGap?: number; pad?: number; header?: number } = {}): CorrLayout {
  const cardW = opts.cardW ?? 184
  const cardH = opts.cardH ?? 92
  const colGap = opts.colGap ?? 72
  const rowGap = opts.rowGap ?? 16
  const pad = opts.pad ?? 16
  const header = opts.header ?? 36
  const maxRows = Math.max(1, ...model.columns.map((c) => c.ids.length))
  const pos = new Map<string, { x: number; y: number }>()
  const columnX: number[] = []
  const colOf = new Map<string, number>()
  const gapYs: number[][] = []
  model.columns.forEach((c, ci) => {
    const x = pad + ci * (cardW + colGap)
    columnX.push(x)
    const offset = ((maxRows - c.ids.length) * (cardH + rowGap)) / 2
    const top = pad + header + offset
    c.ids.forEach((id, ri) => {
      pos.set(id, { x, y: top + ri * (cardH + rowGap) })
      colOf.set(id, ci)
    })
    gapYs.push(Array.from({ length: c.ids.length + 1 }, (_, i) => top + i * (cardH + rowGap) - rowGap / 2))
  })
  const cols = Math.max(1, model.columns.length)
  return {
    width: pad * 2 + cols * cardW + (cols - 1) * colGap,
    height: pad * 2 + header + maxRows * (cardH + rowGap) - rowGap,
    pos,
    columnX,
    colOf,
    gapYs,
    cardW,
    cardH,
    header,
  }
}

// Dependency → subject curve from the right edge of one card to the left
// edge of the other. Edges that skip columns pass each intermediate column
// through the row gap closest to their straight line, so they never run
// under a card.
export function edgePath(fromId: string, toId: string, l: CorrLayout): string | null {
  const from = l.pos.get(fromId), to = l.pos.get(toId)
  if (!from || !to) return null
  const start = { x: from.x + l.cardW, y: from.y + l.cardH / 2 }
  const end = { x: to.x, y: to.y + l.cardH / 2 }
  const c1 = l.colOf.get(fromId) ?? 0, c2 = l.colOf.get(toId) ?? 0
  const points: { x: number; y: number }[] = [start]
  for (let ci = c1 + 1; ci < c2; ci++) {
    const x = l.columnX[ci]
    const tY = start.y + ((end.y - start.y) * (x + l.cardW / 2 - start.x)) / Math.max(end.x - start.x, 1)
    const gaps = l.gapYs[ci] ?? [tY]
    const y = gaps.reduce((best, g) => (Math.abs(g - tY) < Math.abs(best - tY) ? g : best), gaps[0])
    points.push({ x: x - 4, y }, { x: x + l.cardW + 4, y })
  }
  points.push(end)
  let d = `M${start.x},${start.y}`
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1], q = points[i]
    if (i % 2 === 0 && i < points.length - 1) {
      // Straight run through a column's row gap.
      d += ` L${q.x},${q.y}`
    } else {
      const dx = Math.max(20, (q.x - p.x) / 2)
      d += ` C${p.x + dx},${p.y} ${q.x - dx},${q.y} ${q.x},${q.y}`
    }
  }
  return d
}

// ── Data loading (cached per plan for the session) ────────────────────────

const cache = new Map<string, Promise<CorrModel>>()

// Plan subjects + file counts and wiki flags (mine=true). Callers OR the
// wiki flag with the pins list's, for API builds without hasWiki.
export function loadCorrModel(planId: string): Promise<CorrModel> {
  let p = cache.get(planId)
  if (!p) {
    p = Promise.all([
      fetchPlanSubjects(planId),
      fetchMyPlanSubjects().catch(() => []),
    ]).then(([list, mine]) => {
      const extra = new Map(mine.map((m) => [m.subjectId, {
        fileCount: m.fileCount,
        hasWiki: m.hasWiki,
      }]))
      return buildModel(planId, list, extra)
    })
    p.catch(() => cache.delete(planId))
    cache.set(planId, p)
  }
  return p
}
