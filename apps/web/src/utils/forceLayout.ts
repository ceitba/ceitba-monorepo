// Tiny deterministic force-directed layout (Fruchterman–Reingold style) for
// the wiki graph: a few hundred nodes at most, computed once, no library.

export interface LayoutNode { id: string; x: number; y: number }

export function forceLayout(ids: string[], edges: { from: string; to: string }[], iterations = 300): Map<string, LayoutNode> {
  const n = ids.length
  const nodes = new Map<string, LayoutNode>()
  if (n === 0) return nodes
  const area = 1000 * 1000
  const k = Math.sqrt(area / n) * 0.8
  // Start on a golden-angle spiral: deterministic and well spread.
  ids.forEach((id, i) => {
    const r = 30 * Math.sqrt(i + 1)
    const a = i * 2.39996
    nodes.set(id, { id, x: r * Math.cos(a), y: r * Math.sin(a) })
  })
  const list = [...nodes.values()]
  const links = edges
    .map((e) => [nodes.get(e.from), nodes.get(e.to)] as const)
    .filter((pair): pair is readonly [LayoutNode, LayoutNode] => !!pair[0] && !!pair[1] && pair[0] !== pair[1])

  let temperature = 120
  const disp = new Map<string, { x: number; y: number }>()
  for (let it = 0; it < iterations; it++) {
    list.forEach((v) => disp.set(v.id, { x: 0, y: 0 }))
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = list[i], b = list[j]
        let dx = a.x - b.x, dy = a.y - b.y
        let d = Math.hypot(dx, dy)
        if (d < 0.01) { dx = 0.01 * (i - j); dy = 0.01; d = Math.hypot(dx, dy) }
        const f = (k * k) / d
        const da = disp.get(a.id)!, db = disp.get(b.id)!
        da.x += (dx / d) * f; da.y += (dy / d) * f
        db.x -= (dx / d) * f; db.y -= (dy / d) * f
      }
    }
    for (const [a, b] of links) {
      const dx = a.x - b.x, dy = a.y - b.y
      const d = Math.max(Math.hypot(dx, dy), 0.01)
      const f = (d * d) / k
      const da = disp.get(a.id)!, db = disp.get(b.id)!
      da.x -= (dx / d) * f; da.y -= (dy / d) * f
      db.x += (dx / d) * f; db.y += (dy / d) * f
    }
    for (const v of list) {
      const dv = disp.get(v.id)!
      // Gravity keeps disconnected nodes from drifting away.
      dv.x -= v.x * 0.05; dv.y -= v.y * 0.05
      const d = Math.max(Math.hypot(dv.x, dv.y), 0.01)
      const step = Math.min(d, temperature)
      v.x += (dv.x / d) * step
      v.y += (dv.y / d) * step
    }
    temperature = Math.max(2, temperature * 0.97)
  }
  return nodes
}
