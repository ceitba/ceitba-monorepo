// Small deterministic force-directed layout (Fruchterman–Reingold style)
// for the wiki graphs, computed once per data set; no library. O(n²) per
// iteration, with fewer iterations for bigger graphs (~100 ms for 500
// nodes). Optional groups cluster nodes (e.g. by subject): each group gets
// an anchor on a circle and its nodes are pulled towards it.

export interface LayoutNode { id: string; x: number; y: number }

export interface LayoutOptions {
  iterations?: number
  groupOf?: (id: string) => string | undefined
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
  const k = Math.sqrt((1000 * 1000) / Math.max(n, 1)) * 0.8 * Math.max(1, Math.sqrt(n / 60))

  // Group anchors on a circle sized to the graph.
  const groupKeys = opts.groupOf ? [...new Set(ids.map((id) => opts.groupOf!(id) ?? ''))] : []
  const anchors = new Map<string, { x: number; y: number }>()
  const ringR = groupKeys.length > 1 ? k * Math.sqrt(n) * 0.55 : 0
  groupKeys.forEach((g, i) => {
    const a = (i / groupKeys.length) * Math.PI * 2
    anchors.set(g, { x: ringR * Math.cos(a), y: ringR * Math.sin(a) })
  })
  const anchorOf = (id: string) => anchors.get(opts.groupOf?.(id) ?? '') ?? { x: 0, y: 0 }

  // Golden-angle spiral around each node's anchor: deterministic, spread.
  ids.forEach((id, i) => {
    const r = 30 * Math.sqrt(i + 1)
    const a = i * 2.39996
    const c = anchorOf(id)
    nodes.set(id, { id, x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) })
  })
  const list = [...nodes.values()]
  const anchorList = list.map((v) => anchorOf(v.id))
  const links = edges
    .map((e) => [nodes.get(e.from), nodes.get(e.to)] as const)
    .filter((pair): pair is readonly [LayoutNode, LayoutNode] => !!pair[0] && !!pair[1] && pair[0] !== pair[1])

  const dx = new Float64Array(n)
  const dy = new Float64Array(n)
  const index = new Map(list.map((v, i) => [v, i]))
  let temperature = k * 1.5
  const gravity = groupKeys.length > 1 ? 0.12 : 0.05
  for (let it = 0; it < iterations; it++) {
    dx.fill(0); dy.fill(0)
    for (let i = 0; i < n; i++) {
      const a = list[i]
      for (let j = i + 1; j < n; j++) {
        const b = list[j]
        let ddx = a.x - b.x, ddy = a.y - b.y
        let d2 = ddx * ddx + ddy * ddy
        if (d2 < 0.0001) { ddx = 0.01 * (i - j); ddy = 0.01; d2 = ddx * ddx + ddy * ddy }
        const f = (k * k) / d2 // = (k²/d) / d
        dx[i] += ddx * f; dy[i] += ddy * f
        dx[j] -= ddx * f; dy[j] -= ddy * f
      }
    }
    for (const [a, b] of links) {
      const ia = index.get(a)!, ib = index.get(b)!
      const ddx = a.x - b.x, ddy = a.y - b.y
      const d = Math.max(Math.sqrt(ddx * ddx + ddy * ddy), 0.01)
      const f = d / k // = (d²/k) / d
      dx[ia] -= ddx * f; dy[ia] -= ddy * f
      dx[ib] += ddx * f; dy[ib] += ddy * f
    }
    for (let i = 0; i < n; i++) {
      const v = list[i]
      const c = anchorList[i]
      dx[i] -= (v.x - c.x) * gravity
      dy[i] -= (v.y - c.y) * gravity
      const d = Math.max(Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]), 0.01)
      const step = Math.min(d, temperature)
      v.x += (dx[i] / d) * step
      v.y += (dy[i] / d) * step
    }
    temperature = Math.max(1, temperature * 0.96)
  }
  return nodes
}
