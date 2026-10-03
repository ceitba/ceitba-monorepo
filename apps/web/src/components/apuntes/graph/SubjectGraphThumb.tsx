import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { fetchKbGraph, type KbGraph } from '../../../api/kb'
import GraphView, { type GraphNode } from './GraphView'

const TYPE_COLOR: Record<string, string> = {
  index: 'var(--kbg-index)',
  topic: 'var(--kbg-topic)',
  concept: 'var(--kbg-concept)',
}

// Small static picture of a subject's wiki graph for its Wiki tab; the
// whole card links to /apuntes/:subjectId/grafo.
export default function SubjectGraphThumb({ subjectId }: { subjectId: string }) {
  const { t } = useTranslation()
  const [graph, setGraph] = useState<KbGraph | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchKbGraph(subjectId).then((g) => { if (!cancelled) setGraph(g) }).catch(() => {})
    return () => { cancelled = true }
  }, [subjectId])

  const nodes = useMemo<GraphNode[]>(() => (graph?.nodes ?? []).map((n) => ({
    id: n.id, subjectId: n.subjectId, slug: n.slug, title: n.title, type: n.type, muted: n.external,
  })), [graph])
  const edges = useMemo(() => graph?.edges ?? [], [graph])
  if (!graph || nodes.length < 2) return null

  return (
    <Link
      to={`/apuntes/${encodeURIComponent(subjectId)}/grafo`}
      className="group block rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface overflow-hidden hover:border-primary transition-colors"
    >
      <GraphView
        mode="thumb"
        className="h-40 pointer-events-none"
        nodes={nodes}
        edges={edges}
        colorOf={(n) => TYPE_COLOR[n.type] ?? TYPE_COLOR.concept}
      />
      <span className="flex items-center justify-between px-3 py-2 border-t border-border dark:border-night-border font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted group-hover:text-primary">
        {t('wiki.graphLink')}
        <span aria-hidden="true">→</span>
      </span>
    </Link>
  )
}
