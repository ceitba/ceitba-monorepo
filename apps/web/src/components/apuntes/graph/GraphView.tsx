import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { KbPageType } from '../../../api/kb'
import { forceLayout, type LayoutNode } from '../../../utils/forceLayout'

// Interactive wiki graph (subject graph, global map and their previews).
//
// Rendering: SVG; the layout is computed once per data set (after first
// paint), then pan/zoom only rewrites the transform of one <g> inside a
// requestAnimationFrame and sets --k on the <svg>, so labels keep a constant
// on-screen size via CSS and nothing re-renders while zooming. React
// re-renders only on selection, search and filter changes.

export interface GraphNode {
  id: string
  subjectId: string
  slug: string
  title: string
  type: KbPageType
  // Drawn grey and small (pages of other subjects in a subject graph).
  muted?: boolean
  // Cluster key (subject in the global map).
  group?: string
}

export interface GraphEdge {
  from: string
  to: string
  emphasized?: boolean
}

export interface GraphGroup {
  key: string
  label: string
  color: string
}

type Mode = 'full' | 'preview' | 'thumb'

interface Props {
  nodes: GraphNode[]
  edges: GraphEdge[]
  // Fill for a node (CSS colour or var()).
  colorOf: (node: GraphNode) => string
  // Clusters with legend colours (global map): enables group labels and
  // the subject filter.
  groups?: GraphGroup[]
  mode?: Mode
  className?: string
  onOpen?: (node: GraphNode) => void
  // Summary for the focus card, fetched lazily.
  loadSummary?: (node: GraphNode) => Promise<string | null>
  // Subject label for the focus card.
  subjectLabel?: (node: GraphNode) => string
  // Label for the muted-nodes filter ("Otras materias").
  mutedLabel?: string
}

const MIN_K = 0.2
const MAX_K = 4
const RADIUS: Record<KbPageType, number> = { index: 14, topic: 10, concept: 7 }
const TYPES: KbPageType[] = ['index', 'topic', 'concept']

function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

function radiusOf(n: GraphNode): number {
  return n.muted ? 6 : RADIUS[n.type] ?? 7
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

export default function GraphView({
  nodes, edges, colorOf, groups, mode = 'full', className = '', onOpen, loadSummary, subjectLabel, mutedLabel,
}: Props) {
  const { t } = useTranslation()
  const interactive = mode === 'full'
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const gRef = useRef<SVGGElement>(null)
  const view = useRef({ k: 1, x: 0, y: 0 })
  const raf = useRef(0)
  const size = useRef({ w: 0, h: 0 })
  const tween = useRef(0)
  const [layout, setLayout] = useState<Map<string, LayoutNode> | null>(null)

  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [hiddenTypes, setHiddenTypes] = useState<Set<KbPageType>>(new Set())
  const [hiddenGroups, setHiddenGroups] = useState<Set<string>>(new Set())
  const [hideMuted, setHideMuted] = useState(false)
  const [summaries, setSummaries] = useState<Map<string, string | null>>(new Map())

  // ── Layout (after first paint) ──────────────────────────────────────────
  useEffect(() => {
    setLayout(null)
    let cancelled = false
    const run = () => {
      if (cancelled) return
      const groupOf = groups ? new Map(nodes.map((n) => [n.id, n.group ?? ''])) : null
      const pos = forceLayout(nodes.map((n) => n.id), edges, groupOf ? { groupOf: (id) => groupOf.get(id) } : {})
      if (!cancelled) setLayout(pos)
    }
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
    const handle = w.requestIdleCallback ? w.requestIdleCallback(run, { timeout: 600 }) : window.setTimeout(run, 30)
    return () => {
      cancelled = true
      if (!w.requestIdleCallback) window.clearTimeout(handle)
    }
  }, [nodes, edges, groups])

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])

  const visible = useMemo(() => nodes.filter((n) =>
    !hiddenTypes.has(n.type) &&
    !(n.muted && hideMuted) &&
    !(n.group != null && hiddenGroups.has(n.group))), [nodes, hiddenTypes, hiddenGroups, hideMuted])
  const visibleIds = useMemo(() => new Set(visible.map((n) => n.id)), [visible])
  const visibleEdges = useMemo(() => edges.filter((e) => visibleIds.has(e.from) && visibleIds.has(e.to)), [edges, visibleIds])

  const neighbours = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const e of edges) {
      if (!m.has(e.from)) m.set(e.from, new Set())
      if (!m.has(e.to)) m.set(e.to, new Set())
      m.get(e.from)!.add(e.to)
      m.get(e.to)!.add(e.from)
    }
    return m
  }, [edges])

  const matches = useMemo(() => {
    const q = normalize(query.trim())
    if (!q) return null
    return new Set(visible.filter((n) => normalize(n.title).includes(q) || normalize(n.subjectId).includes(q)).map((n) => n.id))
  }, [query, visible])

  // Active set for dimming: search matches win, else selection + neighbours.
  const active = useMemo(() => {
    if (matches) return matches
    if (selected) return new Set([selected, ...(neighbours.get(selected) ?? [])])
    return null
  }, [matches, selected, neighbours])

  // ── View transform ──────────────────────────────────────────────────────
  const apply = useCallback(() => {
    if (raf.current) return
    raf.current = requestAnimationFrame(() => {
      raf.current = 0
      const { k, x, y } = view.current
      gRef.current?.setAttribute('transform', `translate(${x},${y}) scale(${k})`)
      const svg = svgRef.current
      if (svg) {
        svg.style.setProperty('--k', String(k))
        svg.classList.toggle('zoom-low', k < 1)
        svg.classList.toggle('zoom-high', k >= 1)
      }
    })
  }, [])

  const animateTo = useCallback((target: { k: number; x: number; y: number }, ms = 260) => {
    cancelAnimationFrame(tween.current)
    const from = { ...view.current }
    const start = performance.now()
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const step = (now: number) => {
      const p = reduce ? 1 : Math.min(1, (now - start) / ms)
      const e = 1 - Math.pow(1 - p, 3)
      view.current = {
        k: from.k + (target.k - from.k) * e,
        x: from.x + (target.x - from.x) * e,
        y: from.y + (target.y - from.y) * e,
      }
      apply()
      if (p < 1) tween.current = requestAnimationFrame(step)
    }
    tween.current = requestAnimationFrame(step)
  }, [apply])

  const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
    cancelAnimationFrame(tween.current)
    const v = view.current
    const k = clamp(v.k * factor, MIN_K, MAX_K)
    const f = k / v.k
    view.current = { k, x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f }
    apply()
  }, [apply])

  const fitTo = useCallback((ids: Iterable<string> | null, animate = true, maxK = 1.6) => {
    if (!layout) return
    const { w, h } = size.current
    if (!w || !h) return
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const id of ids ?? visibleIds) {
      const p = layout.get(id)
      if (!p) continue
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
    }
    if (!Number.isFinite(minX)) return
    const pad = mode === 'thumb' ? 24 : 70
    const bw = Math.max(maxX - minX, 1) + pad * 2
    const bh = Math.max(maxY - minY, 1) + pad * 2
    const k = clamp(Math.min(w / bw, h / bh), MIN_K, maxK)
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
    const target = { k, x: w / 2 - cx * k, y: h / 2 - cy * k }
    if (animate) animateTo(target)
    else { view.current = target; apply() }
  }, [layout, visibleIds, mode, animateTo, apply])

  const reset = useCallback(() => {
    if (!layout) return
    const { w, h } = size.current
    let sx = 0, sy = 0, c = 0
    for (const id of visibleIds) { const p = layout.get(id); if (p) { sx += p.x; sy += p.y; c++ } }
    const cx = c ? sx / c : 0, cy = c ? sy / c : 0
    animateTo({ k: 1, x: w / 2 - cx, y: h / 2 - cy })
  }, [layout, visibleIds, animateTo])

  // Track the container size; fit on first layout.
  const fitted = useRef(false)
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      size.current = { w: el.clientWidth, h: el.clientHeight }
    })
    size.current = { w: el.clientWidth, h: el.clientHeight }
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => { fitted.current = false }, [nodes])
  useEffect(() => {
    if (layout && !fitted.current) {
      fitted.current = true
      fitTo(null, false, mode === 'full' ? 1.2 : 1)
    }
  }, [layout, fitTo, mode])

  // ── Pointer: drag to pan, pinch to zoom; wheel zoom around the cursor ──
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{ moved: boolean; dist?: number; startX: number; startY: number }>({ moved: false, startX: 0, startY: 0 })
  const suppressClick = useRef(false)

  useEffect(() => {
    const svg = svgRef.current
    if (!svg || !interactive) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = svg.getBoundingClientRect()
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018))
      zoomAt(factor, e.clientX - r.left, e.clientY - r.top)
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [interactive, zoomAt])

  function local(e: { clientX: number; clientY: number }) {
    const r = svgRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (!interactive) return
    pointers.current.set(e.pointerId, local(e))
    if (pointers.current.size === 1) {
      gesture.current = { moved: false, startX: e.clientX, startY: e.clientY }
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      gesture.current = { ...gesture.current, moved: true, dist: Math.hypot(a.x - b.x, a.y - b.y) }
    }
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!interactive || !pointers.current.has(e.pointerId)) return
    const prev = pointers.current.get(e.pointerId)!
    const cur = local(e)
    pointers.current.set(e.pointerId, cur)
    if (pointers.current.size === 1) {
      if (!gesture.current.moved && Math.hypot(e.clientX - gesture.current.startX, e.clientY - gesture.current.startY) < 4) return
      if (!gesture.current.moved) {
        gesture.current.moved = true
        svgRef.current?.setPointerCapture(e.pointerId)
      }
      cancelAnimationFrame(tween.current)
      view.current = { ...view.current, x: view.current.x + cur.x - prev.x, y: view.current.y + cur.y - prev.y }
      apply()
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      if (gesture.current.dist) zoomAt(dist / gesture.current.dist, (a.x + b.x) / 2, (a.y + b.y) / 2)
      gesture.current.dist = dist
    }
  }

  function onPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    if (!interactive) return
    pointers.current.delete(e.pointerId)
    if (gesture.current.moved) {
      suppressClick.current = true
      window.setTimeout(() => { suppressClick.current = false }, 0)
    }
    if (pointers.current.size < 2) gesture.current.dist = undefined
    if (pointers.current.size === 0) gesture.current.moved = false
  }

  // ── Selection, keyboard ─────────────────────────────────────────────────
  const selectedNode = selected ? byId.get(selected) ?? null : null

  useEffect(() => {
    if (!selectedNode || !loadSummary || summaries.has(selectedNode.id)) return
    let cancelled = false
    loadSummary(selectedNode)
      .then((s) => { if (!cancelled) setSummaries((m) => new Map(m).set(selectedNode.id, s)) })
      .catch(() => { if (!cancelled) setSummaries((m) => new Map(m).set(selectedNode.id, null)) })
    return () => { cancelled = true }
  }, [selectedNode, loadSummary, summaries])

  function clickNode(node: GraphNode) {
    if (suppressClick.current) return
    if (mode === 'preview') { onOpen?.(node); return }
    if (mode !== 'full') return
    if (selected === node.id) onOpen?.(node)
    else setSelected(node.id)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!interactive || (e.target as HTMLElement).tagName === 'INPUT') return
    const { w, h } = size.current
    const pan = 60
    switch (e.key) {
      case '+': case '=': zoomAt(1.25, w / 2, h / 2); break
      case '-': case '_': zoomAt(0.8, w / 2, h / 2); break
      case '0': fitTo(null); break
      case 'ArrowLeft': view.current.x += pan; apply(); break
      case 'ArrowRight': view.current.x -= pan; apply(); break
      case 'ArrowUp': view.current.y += pan; apply(); break
      case 'ArrowDown': view.current.y -= pan; apply(); break
      case 'Escape': setSelected(null); setQuery(''); break
      case 'Enter': if (selectedNode) onOpen?.(selectedNode); break
      default: return
    }
    e.preventDefault()
  }

  // Zoom to search results shortly after typing stops.
  useEffect(() => {
    if (!matches || matches.size === 0) return
    const id = window.setTimeout(() => fitTo(matches, true, 2), 350)
    return () => window.clearTimeout(id)
  }, [matches, fitTo])

  // Cluster label positions (centroids).
  const groupLabels = useMemo(() => {
    if (!groups || !layout) return []
    return groups.map((g) => {
      let sx = 0, sy = 0, c = 0
      for (const n of visible) {
        if (n.group !== g.key) continue
        const p = layout.get(n.id)
        if (p) { sx += p.x; sy += p.y; c++ }
      }
      return c ? { ...g, x: sx / c, y: sy / c } : null
    }).filter((g): g is GraphGroup & { x: number; y: number } => !!g)
  }, [groups, layout, visible])

  const hasMuted = useMemo(() => nodes.some((n) => n.muted), [nodes])

  // ── Render ──────────────────────────────────────────────────────────────
  const svg = (
    <svg
      ref={svgRef}
      className={`kbg ${active ? 'has-focus' : ''} ${interactive ? 'is-interactive' : ''}`}
      style={{ touchAction: interactive ? 'none' : 'auto' }}
      width="100%"
      height="100%"
      role="img"
      aria-label={t('wiki.graphTitle')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={(e) => { if (e.target === svgRef.current && !suppressClick.current && mode === 'full') setSelected(null) }}
    >
      <g ref={gRef}>
        {layout && (
          <>
            <g>
              {visibleEdges.map((e, i) => {
                const a = layout.get(e.from), b = layout.get(e.to)
                if (!a || !b) return null
                const lit = !!active && active.has(e.from) && active.has(e.to)
                return (
                  <line
                    key={i}
                    x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                    className={`kbg-edge${e.emphasized ? ' is-strong' : ''}${lit ? ' is-active' : ''}`}
                    vectorEffect="non-scaling-stroke"
                  />
                )
              })}
            </g>
            <g>
              {visible.map((node) => {
                const p = layout.get(node.id)
                if (!p) return null
                const r = radiusOf(node)
                const isActive = !active || active.has(node.id)
                const label = node.muted ? `${node.subjectId} · ${truncate(node.title, 22)}` : truncate(node.title, 30)
                return (
                  <g
                    key={node.id}
                    transform={`translate(${p.x},${p.y})`}
                    className={`kbg-node kbg-${node.type}${node.muted ? ' is-muted' : ''}${isActive && active ? ' is-active' : ''}${selected === node.id ? ' is-selected' : ''}${matches?.has(node.id) ? ' is-match' : ''}`}
                    onClick={(e) => { e.stopPropagation(); clickNode(node) }}
                    role={mode === 'thumb' ? undefined : 'button'}
                    tabIndex={mode === 'full' ? 0 : undefined}
                    aria-label={mode === 'thumb' ? undefined : `${node.subjectId} · ${node.title}`}
                    onKeyDown={mode === 'full' ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); clickNode(node) }
                    } : undefined}
                  >
                    {mode !== 'thumb' && <title>{`${node.subjectId} · ${node.title}`}</title>}
                    <circle r={r} style={{ fill: node.muted ? undefined : colorOf(node) }} vectorEffect="non-scaling-stroke" />
                    {mode !== 'thumb' && (
                      <text x={r + 3} y={0} dy="0.35em" className={`kbg-label lbl-${node.muted ? 'muted' : node.type}`}>
                        {label}
                      </text>
                    )}
                  </g>
                )
              })}
            </g>
            {mode !== 'thumb' && (
              <g aria-hidden="true">
                {groupLabels.map((g) => (
                  <text key={g.key} x={g.x} y={g.y} textAnchor="middle" className="kbg-group-label" style={{ fill: g.color }}>
                    {g.label}
                  </text>
                ))}
              </g>
            )}
          </>
        )}
      </g>
    </svg>
  )

  if (mode !== 'full') {
    return (
      <div ref={wrapRef} className={`relative ${className}`}>
        {!layout && <div className="absolute inset-0 skeleton rounded-card" aria-hidden="true" />}
        {svg}
      </div>
    )
  }

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {/* Toolbar: search + filters */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="relative lg:w-72">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && matches?.size) { e.preventDefault(); fitTo(matches, true, 2) }
              if (e.key === 'Escape') setQuery('')
            }}
            placeholder={t('wiki.graphUi.search')}
            aria-label={t('wiki.graphUi.search')}
            className="w-full px-3 py-2 rounded-sm border border-border dark:border-night-border bg-white dark:bg-night-surface font-body text-body-sm focus:outline-none focus:border-primary"
          />
          {matches && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-label text-ink-secondary dark:text-night-muted" aria-live="polite">
              {t('wiki.graphUi.matches', { count: matches.size })}
            </span>
          )}
        </div>
        <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <legend className="sr-only">{t('wiki.graphUi.typeFilter')}</legend>
          {TYPES.map((type) => (
            <label key={type} className="inline-flex items-center gap-1.5 cursor-pointer font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-primary"
                checked={!hiddenTypes.has(type)}
                onChange={() => setHiddenTypes((s) => { const n = new Set(s); if (n.has(type)) n.delete(type); else n.add(type); return n })}
              />
              <svg width="10" height="10" aria-hidden="true">
                <circle cx="5" cy="5" r={type === 'index' ? 5 : type === 'topic' ? 4 : 3} className={groups ? 'fill-ink-secondary' : `kbg-swatch-${type}`} />
              </svg>
              {t(`wiki.types.${type}`)}
            </label>
          ))}
          {hasMuted && (
            <label className="inline-flex items-center gap-1.5 cursor-pointer font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
              <input type="checkbox" className="h-3.5 w-3.5 accent-primary" checked={!hideMuted} onChange={() => setHideMuted((v) => !v)} />
              <svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4" className="kbg-swatch-muted" /></svg>
              {mutedLabel ?? t('wiki.otherSubjects')}
            </label>
          )}
        </fieldset>
      </div>

      {groups && groups.length > 1 && (
        <fieldset className="flex flex-wrap gap-x-4 gap-y-1 max-h-24 overflow-y-auto">
          <legend className="sr-only">{t('wiki.graphUi.subjectFilter')}</legend>
          {groups.map((g) => (
            <label key={g.key} className="inline-flex items-center gap-1.5 cursor-pointer font-body text-body-sm text-ink-primary dark:text-night-text">
              <input
                type="checkbox"
                className="h-3.5 w-3.5"
                style={{ accentColor: g.color }}
                checked={!hiddenGroups.has(g.key)}
                onChange={() => setHiddenGroups((s) => { const n = new Set(s); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n })}
              />
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: g.color }} aria-hidden="true" />
              {g.label}
            </label>
          ))}
        </fieldset>
      )}

      <div
        ref={wrapRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        aria-label={t('wiki.graphUi.canvasAria')}
        className="relative flex-1 min-h-[60vh] rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {!layout && <div className="absolute inset-0 skeleton" aria-hidden="true" />}
        {svg}

        <div className="absolute bottom-3 right-3 flex flex-col rounded-sm border border-border dark:border-night-border bg-white/95 dark:bg-night-surface/95 shadow-card overflow-hidden">
          {[
            { label: t('wiki.graphUi.zoomIn'), icon: '+', on: () => zoomAt(1.3, size.current.w / 2, size.current.h / 2) },
            { label: t('wiki.graphUi.zoomOut'), icon: '−', on: () => zoomAt(1 / 1.3, size.current.w / 2, size.current.h / 2) },
            { label: t('wiki.graphUi.fit'), icon: '⤢', on: () => fitTo(null) },
            { label: t('wiki.graphUi.reset'), icon: '1:1', on: reset },
          ].map((b) => (
            <button
              key={b.label}
              type="button"
              onClick={b.on}
              title={b.label}
              aria-label={b.label}
              className="w-10 h-10 flex items-center justify-center font-mono text-body-sm text-ink-primary dark:text-night-text hover:bg-primary-50 dark:hover:bg-primary-900 border-b last:border-b-0 border-border dark:border-night-border"
            >
              {b.icon}
            </button>
          ))}
        </div>

        <p className="hidden sm:block absolute bottom-3 left-3 font-mono text-label text-ink-secondary dark:text-night-muted pointer-events-none">
          {t('wiki.graphUi.keysHint')}
        </p>

        {selectedNode && (
          <div
            className="absolute top-3 right-3 left-3 sm:left-auto sm:w-72 rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface shadow-card-hover p-4 flex flex-col gap-2 animate-fade-in"
            role="dialog"
            aria-label={selectedNode.title}
          >
            <div className="flex items-start gap-2">
              <span className="w-3 h-3 mt-1.5 rounded-full flex-shrink-0" style={{ background: selectedNode.muted ? 'var(--kbg-muted)' : colorOf(selectedNode) }} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="font-display font-bold text-h5 text-ink-primary dark:text-night-text break-words">{selectedNode.title}</p>
                <p className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
                  {subjectLabel ? subjectLabel(selectedNode) : selectedNode.subjectId} · {t(`wiki.typeOne.${selectedNode.type}`)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label={t('errors.dismiss')}
                className="leading-none text-h5 text-ink-secondary dark:text-night-muted hover:text-primary"
              >
                ×
              </button>
            </div>
            {loadSummary && (
              summaries.has(selectedNode.id) ? (
                summaries.get(selectedNode.id) && (
                  <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{summaries.get(selectedNode.id)}</p>
                )
              ) : (
                <div className="h-8 rounded-sm skeleton" aria-hidden="true" />
              )
            )}
            <button
              type="button"
              onClick={() => onOpen?.(selectedNode)}
              className="self-start mt-1 inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-sm bg-primary text-white font-mono text-label uppercase tracking-widest hover:bg-primary-600"
            >
              {t('wiki.graphUi.open')} →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// Distinct, theme-neutral colours per subject (golden-angle hues).
export function subjectColor(index: number): string {
  const hue = Math.round((index * 137.508 + 210) % 360)
  return `hsl(${hue} 58% 52%)`
}
