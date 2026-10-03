// Small deterministic force-directed layout (Fruchterman–Reingold style)
// for the wiki graphs, computed once per data set; no library. O(n²) per
// iteration, with fewer iterations for bigger graphs (~100 ms for 500
// nodes).
//
// - groups cluster nodes (e.g. by subject): each group gets an anchor on a
//   circle and its nodes are pulled towards it;
// - peripheral nodes (pages of other subjects in a subject graph) repel
//   less, get short links and a stronger pull to the centre, so they sit
//   around the subject's pages instead of being flung far out;
// - collision keeps nodes at least their radius + padding apart.

export interface LayoutNode { id: string; x: number; y: number }

export interface LayoutOptions {
  iterations?: number
  groupOf?: (id: string) => string | undefined
  isPeripheral?: (id: string) => boolean
  radiusOf?: (id: string) => number
  // Extra clearance between node circles (world units).
  collisionPadding?: number
}

export function forceLayout(
  ids: string[],
  edges: { from: string; to: string }[],
  opts: LayoutOptions = {},
): Map<string, LayoutNode> {
  const n = ids.length
  const nodes = new Map<string, LayoutNode>()
  if (n === 0) return nodes
  const iterations = opts.iterations ?? (n <= 150 ? 300 : n <= 400 ? 180 : 110)
  const peripheral = ids.map((id) => !!opts.isPeripheral?.(id))
  const coreCount = Math.max(1, peripheral.filter((p) => !p).length)
  // Ideal edge length. Denser graphs (more edges per node) need more room.
  const density = Math.min(3, Math.max(1, edges.length / Math.max(n, 1)))
  const k = 60 * Math.sqrt(density) * Math.max(1, Math.pow(coreCount / 30, 0.25))
  const radius = ids.map((id) => opts.radiusOf?.(id) ?? 8)
  const pad = opts.collisionPadding ?? 18

  const groupKeys = opts.groupOf ? [...new Set(ids.map((id) => opts.groupOf!(id) ?? ''))] : []
  const anchors = new Map<string, { x: number; y: number }>()
  const ringR = groupKeys.length > 1 ? k * Math.sqrt(n) * 0.9 : 0
  groupKeys.forEach((g, i) => {
    const a = (i / groupKeys.length) * Math.PI * 2
    anchors.set(g, { x: ringR * Math.cos(a), y: ringR * Math.sin(a) })
  })
  const anchorOf = (id: string) => anchors.get(opts.groupOf?.(id) ?? '') ?? { x: 0, y: 0 }

  // Golden-angle spiral around each node's anchor: deterministic, spread.
  // Peripheral nodes start on an outer ring.
  ids.forEach((id, i) => {
    const r = (peripheral[i] ? 1.6 : 1) * k * 0.5 * Math.sqrt(i + 1)
    const a = i * 2.39996
    const c = anchorOf(id)
    nodes.set(id, { id, x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) })
  })
  const list = ids.map((id) => nodes.get(id)!)
  const anchorList = ids.map((id) => anchorOf(id))
  const index = new Map(ids.map((id, i) => [id, i]))
  const links = edges
    .map((e) => [index.get(e.from), index.get(e.to)] as const)
    .filter((pair): pair is readonly [number, number] => pair[0] != null && pair[1] != null && pair[0] !== pair[1])

  const dx = new Float64Array(n)
  const dy = new Float64Array(n)
  let temperature = k * 2
  const groupGravity = groupKeys.length > 1 ? 0.06 : 0.012
  for (let it = 0; it < iterations; it++) {
    dx.fill(0); dy.fill(0)
    // Repulsion (weaker when a peripheral node is involved).
    for (let i = 0; i < n; i++) {
      const a = list[i]
      for (let j = i + 1; j < n; j++) {
        const b = list[j]
        let ddx = a.x - b.x, ddy = a.y - b.y
        let d2 = ddx * ddx + ddy * ddy
        if (d2 < 0.0001) { ddx = 0.01 * (i - j); ddy = 0.01; d2 = ddx * ddx + ddy * ddy }
        const w = peripheral[i] || peripheral[j] ? 0.35 : 1
        const f = (w * k * k) / d2
        dx[i] += ddx * f; dy[i] += ddy * f
        dx[j] -= ddx * f; dy[j] -= ddy * f
      }
    }
    // Attraction along links (shorter for links to peripheral nodes).
    for (const [ia, ib] of links) {
      const a = list[ia], b = list[ib]
      const ddx = a.x - b.x, ddy = a.y - b.y
      const d = Math.max(Math.sqrt(ddx * ddx + ddy * ddy), 0.01)
      const w = peripheral[ia] || peripheral[ib] ? 2.5 : 1
      const f = (w * d) / k
      dx[ia] -= ddx * f; dy[ia] -= ddy * f
      dx[ib] += ddx * f; dy[ib] += ddy * f
    }
    for (let i = 0; i < n; i++) {
      const v = list[i]
      const c = anchorList[i]
      const g = peripheral[i] ? 0.12 : groupGravity
      dx[i] -= (v.x - c.x) * g * k * 0.05
      dy[i] -= (v.y - c.y) * g * k * 0.05
      const d = Math.max(Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]), 0.01)
      const step = Math.min(d, temperature)
      v.x += (dx[i] / d) * step
      v.y += (dy[i] / d) * step
    }
    temperature = Math.max(0.5, temperature * 0.965)
  }

  // Collision: a few relaxation passes so circles never overlap.
  for (let pass = 0; pass < 8; pass++) {
    let moved = false
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = list[i], b = list[j]
        const min = radius[i] + radius[j] + pad
        let ddx = b.x - a.x, ddy = b.y - a.y
        let d = Math.sqrt(ddx * ddx + ddy * ddy)
        if (d >= min) continue
        if (d < 0.01) { ddx = 1; ddy = 0; d = 1 }
        const push = (min - d) / 2
        a.x -= (ddx / d) * push; a.y -= (ddy / d) * push
        b.x += (ddx / d) * push; b.y += (ddy / d) * push
        moved = true
      }
    }
    if (!moved) break
  }
  return nodes
}
