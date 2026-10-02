import '../../i18nApuntes'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { fetchKbGraph, fetchSubjectKb, kbPagePath, type KbGraph, type KbGraphNode } from '../../api/kb'
import { apuntesErrorMessage } from '../../utils/apuntes'
import { forceLayout } from '../../utils/forceLayout'
import EmptyState from '../../components/apuntes/EmptyState'

const RADIUS: Record<string, number> = { index: 13, topic: 10, concept: 7 }
const EXTERNAL_RADIUS = 6
const FILL: Record<string, string> = {
  index: 'fill-accent-400',
  topic: 'fill-primary-500 dark:fill-primary-300',
  concept: 'fill-emerald-600 dark:fill-emerald-400',
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

// /apuntes/:subjectId/grafo — the subject's wiki pages and the pages of
// other subjects they link with, as a static force-directed SVG.
export default function WikiGraphPage() {
  const { subjectId = '' } = useParams()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [graph, setGraph] = useState<KbGraph | null>(null)
  const [subjectName, setSubjectName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setGraph(null); setError(null)
    fetchKbGraph(subjectId)
      .then((g) => { if (!cancelled) setGraph({ nodes: g.nodes ?? [], edges: g.edges ?? [] }) })
      .catch((e) => { if (!cancelled) setError(apuntesErrorMessage(e, t)) })
    fetchSubjectKb(subjectId)
      .then((kb) => { if (!cancelled) setSubjectName(kb.subjectName) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [subjectId, t])

  const layout = useMemo(() => {
    if (!graph) return null
    const pos = forceLayout(graph.nodes.map((n) => n.id), graph.edges)
    const xs = [...pos.values()].map((p) => p.x)
    const ys = [...pos.values()].map((p) => p.y)
    const pad = 90
    const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad
    const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad
    return { pos, viewBox: `${minX} ${minY} ${Math.max(maxX - minX, 200)} ${Math.max(maxY - minY, 200)}` }
  }, [graph])

  const neighbours = useMemo(() => {
    const m = new Map<string, Set<string>>()
    graph?.edges.forEach((e) => {
      if (!m.has(e.from)) m.set(e.from, new Set())
      if (!m.has(e.to)) m.set(e.to, new Set())
      m.get(e.from)!.add(e.to)
      m.get(e.to)!.add(e.from)
    })
    return m
  }, [graph])

  function go(node: KbGraphNode) {
    navigate(kbPagePath(node.subjectId, node.slug))
  }

  const active = (id: string) => !hover || hover === id || neighbours.get(hover)?.has(id)

  return (
    <main id="main-content" tabIndex={-1} className="outline-none container-content py-section-mobile lg:py-section">
      <nav aria-label={t('apuntes.breadcrumbAria')} className="mb-4 font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted flex flex-wrap items-center gap-x-2">
        <Link to="/apuntes" className="hover:text-primary">{t('apuntes.title')}</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/apuntes/${encodeURIComponent(subjectId)}?vista=wiki`} className="hover:text-primary normal-case tracking-normal">
          {subjectName ?? subjectId}
        </Link>
        <span aria-hidden="true">/</span>
        <span>{t('wiki.graph')}</span>
      </nav>

      <header className="mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="font-display font-bold text-h3 text-ink-primary dark:text-night-text">{t('wiki.graphTitle')}</h1>
          <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted mt-1">{t('wiki.graphHint')}</p>
        </div>
        <ul className="flex flex-wrap gap-3 font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted" aria-label={t('wiki.legend')}>
          {(['index', 'topic', 'concept'] as const).map((type) => (
            <li key={type} className="inline-flex items-center gap-1.5">
              <svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="5" className={FILL[type]} /></svg>
              {t(`wiki.types.${type}`)}
            </li>
          ))}
          <li className="inline-flex items-center gap-1.5">
            <svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="5" className="fill-border dark:fill-night-border" /></svg>
            {t('wiki.otherSubjects')}
          </li>
        </ul>
      </header>

      {error && <p role="alert" className="font-body text-body-sm text-red-600 dark:text-red-400">{error}</p>}
      {!graph && !error && <div className="h-[70vh] rounded-card skeleton" aria-busy="true" />}
      {graph && graph.nodes.length === 0 && <EmptyState title={t('wiki.emptyTitle')} body={t('wiki.emptyBody')} />}

      {graph && layout && graph.nodes.length > 0 && (
        <div className="rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface overflow-hidden">
          <svg viewBox={layout.viewBox} className="w-full h-[70vh] select-none" role="img" aria-label={t('wiki.graphTitle')}>
            <g>
              {graph.edges.map((e, i) => {
                const a = layout.pos.get(e.from), b = layout.pos.get(e.to)
                if (!a || !b) return null
                const lit = hover && (e.from === hover || e.to === hover)
                return (
                  <line
                    key={i}
                    x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                    className={lit ? 'stroke-accent-400' : 'stroke-border dark:stroke-night-border'}
                    strokeWidth={lit ? 2.5 : 1.2}
                    opacity={hover && !lit ? 0.3 : 1}
                  />
                )
              })}
            </g>
            <g>
              {graph.nodes.map((node) => {
                const p = layout.pos.get(node.id)
                if (!p) return null
                const r = node.external ? EXTERNAL_RADIUS : (RADIUS[node.type] ?? 7)
                const label = node.external ? `${node.subjectId} · ${truncate(node.title, 18)}` : truncate(node.title, 28)
                return (
                  <g
                    key={node.id}
                    transform={`translate(${p.x},${p.y})`}
                    role="link"
                    tabIndex={0}
                    aria-label={node.external ? `${node.subjectId}: ${node.title}` : node.title}
                    onClick={() => go(node)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(node) } }}
                    onMouseEnter={() => setHover(node.id)}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover(node.id)}
                    onBlur={() => setHover(null)}
                    className="cursor-pointer outline-none"
                    opacity={active(node.id) ? 1 : 0.25}
                  >
                    <title>{node.external ? `${node.subjectId} · ${node.title}` : node.title}</title>
                    <circle
                      r={r}
                      className={node.external ? 'fill-border dark:fill-night-border stroke-ink-secondary' : `${FILL[node.type] ?? FILL.concept} stroke-white dark:stroke-night-surface`}
                      strokeWidth={node.external ? 1 : 2}
                    />
                    <text
                      x={r + 5}
                      y={4}
                      className={`font-body ${node.external ? 'fill-ink-secondary dark:fill-night-muted' : 'fill-ink-primary dark:fill-night-text'}`}
                      fontSize={node.type === 'index' ? 15 : 12}
                      fontWeight={node.type === 'index' ? 700 : 400}
                    >
                      {label}
                    </text>
                  </g>
                )
              })}
            </g>
          </svg>
        </div>
      )}
    </main>
  )
}
