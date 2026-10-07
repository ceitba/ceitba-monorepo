import '../../i18nApuntes'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { fetchKbGraph, fetchKbPage, fetchSubjectKb, kbPagePath, type KbGraph } from '../../api/kb'
import { apuntesErrorCopy } from '../../components/apuntes/errorCopy'
import { EmptyState, ErrorState, LoadingRegion, Skeleton } from '../../components/ui'
import GraphView, { type GraphNode } from '../../components/apuntes/graph/GraphView'

const TYPE_COLOR: Record<string, string> = {
  index: 'var(--kbg-index)',
  topic: 'var(--kbg-topic)',
  concept: 'var(--kbg-concept)',
}

const colorOf = (n: GraphNode) => TYPE_COLOR[n.type] ?? TYPE_COLOR.concept

// /apuntes/:subjectId/grafo — the subject's wiki pages (coloured by type)
// and the pages of other subjects they link with (muted), with zoom, pan,
// search, filters and a focus card.
export default function WikiGraphPage() {
  const { subjectId = '' } = useParams()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [graph, setGraph] = useState<KbGraph | null>(null)
  const [subjectName, setSubjectName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    setGraph(null); setError(null)
    fetchKbGraph(subjectId)
      .then((g) => { if (!cancelled) setGraph({ nodes: g.nodes ?? [], edges: g.edges ?? [] }) })
      .catch((e) => { if (!cancelled) setError(apuntesErrorCopy(e, t)) })
    // Only feeds the breadcrumb; the subject code stands in if it fails.
    fetchSubjectKb(subjectId)
      .then((kb) => { if (!cancelled) setSubjectName(kb.subjectName) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [subjectId, t, tick])

  const nodes = useMemo<GraphNode[]>(() => (graph?.nodes ?? []).map((n) => ({
    id: n.id, subjectId: n.subjectId, slug: n.slug, title: n.title, type: n.type, muted: n.external,
  })), [graph])
  const edges = useMemo(() => graph?.edges ?? [], [graph])

  const loadSummary = useCallback(
    (n: GraphNode) => fetchKbPage(n.subjectId, n.slug).then((p) => p.summary || null),
    [],
  )

  return (
    <main id="main-content" tabIndex={-1} className="outline-none container-content py-section-mobile lg:py-12 flex flex-col min-h-[calc(100vh-4rem)]">
      <nav aria-label={t('apuntes.breadcrumbAria')} className="mb-4 font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted flex flex-wrap items-center gap-x-2">
        <Link to="/apuntes" className="hover:text-primary">{t('apuntes.title')}</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/apuntes/${encodeURIComponent(subjectId)}?vista=wiki`} className="hover:text-primary normal-case tracking-normal">
          {subjectName ?? subjectId}
        </Link>
        <span aria-hidden="true">/</span>
        <span>{t('wiki.graph')}</span>
      </nav>

      <header className="mb-4">
        <h1 className="font-display font-bold text-h3 text-ink-primary dark:text-night-text">{t('wiki.graphTitle')}</h1>
        <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted mt-1">{t('wiki.graphHint')}</p>
      </header>

      {error && (
        <ErrorState
          message={error}
          onRetry={() => setTick((n) => n + 1)}
          backTo={`/apuntes/${encodeURIComponent(subjectId)}?vista=wiki`}
          backLabel={t('wiki.backToSubject')}
        />
      )}
      {!graph && !error && (
        <LoadingRegion className="flex-1 flex flex-col">
          <Skeleton className="flex-1 min-h-[60vh] !rounded-card" />
        </LoadingRegion>
      )}
      {graph && graph.nodes.length === 0 && <EmptyState title={t('wiki.emptyTitle')} body={t('wiki.emptyBody')} />}
      {graph && nodes.length > 0 && (
        <GraphView
          className="flex-1"
          nodes={nodes}
          edges={edges}
          colorOf={colorOf}
          onOpen={(n) => navigate(kbPagePath(n.subjectId, n.slug))}
          loadSummary={loadSummary}
          subjectLabel={(n) => (n.subjectId === subjectId && subjectName ? `${n.subjectId} ${subjectName}` : n.subjectId)}
        />
      )}
    </main>
  )
}
