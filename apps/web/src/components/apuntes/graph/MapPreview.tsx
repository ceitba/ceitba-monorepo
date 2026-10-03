import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { fetchGlobalGraph, kbPagePath, type GlobalKbGraph } from '../../../api/kb'
import GraphView from './GraphView'
import { toGraphData } from './globalGraph'
import { BTN_PRIMARY } from '../buttons'

// "Mapa de apuntes" on /apuntes: a live, read-only preview of the global
// wiki map (hover tooltips, click opens a page). Renders nothing until the
// data arrives, and nothing at all if the endpoint is missing or empty.
export default function MapPreview() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [graph, setGraph] = useState<GlobalKbGraph | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchGlobalGraph().then((g) => { if (!cancelled) setGraph(g) }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const data = useMemo(() => (graph ? toGraphData(graph) : null), [graph])
  if (!data || data.nodes.length === 0) return null

  return (
    <section aria-labelledby="apuntes-map-heading" className="mb-10 rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 px-5 pt-4">
        <div>
          <h2 id="apuntes-map-heading" className="font-display font-bold text-h5 text-ink-primary dark:text-night-text">{t('wiki.map.title')}</h2>
          <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">
            {t('wiki.map.previewHint', { subjects: data.groups.length, pages: data.nodes.length })}
          </p>
        </div>
        <Link to="/apuntes/mapa" className={`${BTN_PRIMARY} self-start sm:self-auto`}>{t('wiki.map.explore')}</Link>
      </div>
      <GraphView
        mode="preview"
        className="h-72 sm:h-80"
        nodes={data.nodes}
        edges={data.edges}
        groups={data.groups}
        colorOf={data.colorOf}
        onOpen={(n) => navigate(kbPagePath(n.subjectId, n.slug))}
      />
    </section>
  )
}
