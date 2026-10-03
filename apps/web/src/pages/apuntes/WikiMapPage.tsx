import '../../i18nApuntes'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { fetchMyPlanSubjects } from '../../api/drive'
import { fetchGlobalGraph, fetchKbPage, kbPagePath, type GlobalKbGraph } from '../../api/kb'
import { apuntesErrorMessage } from '../../utils/apuntes'
import { usePins } from '../../hooks/usePins'
import EmptyState from '../../components/apuntes/EmptyState'
import GraphView, { type GraphNode } from '../../components/apuntes/graph/GraphView'
import { toGraphData } from '../../components/apuntes/graph/globalGraph'

// /apuntes/mapa — every subject wiki as one map, clustered and coloured by
// subject. "Solo mis materias" (?mias=1) limits it to the student's plan
// and pinned subjects.
export default function WikiMapPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const onlyMine = params.get('mias') === '1'
  const { pins } = usePins()
  const [plan, setPlan] = useState<string[] | null>(null)
  const [graph, setGraph] = useState<GlobalKbGraph | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    if (!onlyMine || plan) return
    fetchMyPlanSubjects().then((s) => setPlan(s.map((x) => x.subjectId))).catch(() => setPlan([]))
  }, [onlyMine, plan])

  const mine = useMemo(() => {
    if (!onlyMine) return null
    if (plan == null || pins == null) return undefined // still loading
    return [...new Set([...plan, ...pins.map((p) => p.subjectId)])]
  }, [onlyMine, plan, pins])

  useEffect(() => {
    if (mine === undefined) return
    if (mine && mine.length === 0) { setGraph({ subjects: [], nodes: [], edges: [] }); return }
    let cancelled = false
    setGraph(null); setError(null)
    fetchGlobalGraph(mine ?? undefined)
      .then((g) => { if (!cancelled) setGraph(g) })
      .catch((e) => {
        if (cancelled) return
        if (e instanceof ApiError && e.status === 404) setMissing(true)
        else setError(apuntesErrorMessage(e, t))
      })
    return () => { cancelled = true }
  }, [mine, t])

  const data = useMemo(() => (graph ? toGraphData(graph) : null), [graph])
  const loadSummary = useCallback(
    (n: GraphNode) => fetchKbPage(n.subjectId, n.slug).then((p) => p.summary || null),
    [],
  )

  // The endpoint isn't deployed yet: don't show a broken page.
  if (missing) return <Navigate to="/apuntes" replace />

  function toggleMine() {
    const next = new URLSearchParams(params)
    if (onlyMine) next.delete('mias')
    else next.set('mias', '1')
    setParams(next, { replace: true })
  }

  return (
    <main id="main-content" tabIndex={-1} className="outline-none container-content py-section-mobile lg:py-10 flex flex-col min-h-[calc(100vh-4rem)]">
      <nav aria-label={t('apuntes.breadcrumbAria')} className="mb-4 font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted flex flex-wrap items-center gap-x-2">
        <Link to="/apuntes" className="hover:text-primary">{t('apuntes.title')}</Link>
        <span aria-hidden="true">/</span>
        <span>{t('wiki.map.title')}</span>
      </nav>
      <header className="mb-4 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="font-display font-bold text-h3 text-ink-primary dark:text-night-text">{t('wiki.map.title')}</h1>
          <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted mt-1 max-w-2xl">{t('wiki.map.subtitle')}</p>
        </div>
        <label className="inline-flex items-center gap-2 cursor-pointer font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
          <input type="checkbox" className="h-4 w-4 accent-primary" checked={onlyMine} onChange={toggleMine} />
          {t('wiki.map.onlyMine')}
        </label>
      </header>

      {error && <p role="alert" className="font-body text-body-sm text-red-600 dark:text-red-400">{error}</p>}
      {!data && !error && <div className="flex-1 min-h-[60vh] rounded-card skeleton" aria-busy="true" />}
      {data && data.nodes.length === 0 && (
        <EmptyState
          title={onlyMine ? t('wiki.map.emptyMine') : t('wiki.map.empty')}
          body={onlyMine ? t('wiki.map.emptyMineBody') : undefined}
        />
      )}
      {data && data.nodes.length > 0 && (
        <GraphView
          className="flex-1"
          nodes={data.nodes}
          edges={data.edges}
          groups={data.groups}
          colorOf={data.colorOf}
          subjectLabel={data.subjectLabel}
          loadSummary={loadSummary}
          onOpen={(n) => navigate(kbPagePath(n.subjectId, n.slug))}
        />
      )}
    </main>
  )
}
