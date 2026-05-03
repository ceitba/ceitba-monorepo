import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { fetchArticles, deleteArticle } from '../../api/articles'
import { fetchAnalyticsSummary } from '../../api/analytics'
import CategoryBadge from '../../components/CategoryBadge'

export default function AdminArticlesPage() {
  const [articles, setArticles] = useState([])
  const [votes, setVotes]       = useState({})
  const [status, setStatus]     = useState('loading')
  const [confirmId, setConfirmId] = useState(null)

  function load() {
    setStatus('loading')
    Promise.all([
      fetchArticles({ status: 'all' }),
      fetchAnalyticsSummary(30),
    ])
      .then(([{ data }, summary]) => {
        setArticles(data)
        setVotes(
          Object.fromEntries((summary.voteBreakdown ?? []).map((v) => [v.articleId, { up: v.up, down: v.down }])),
        )
        setStatus('success')
      })
      .catch(() => setStatus('error'))
  }

  useEffect(load, [])

  async function handleDelete(id) {
    try {
      await deleteArticle(id)
      setArticles((prev) => prev.filter((a) => a.id !== id))
    } catch {
      // leave list unchanged on error
    }
    setConfirmId(null)
  }

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center py-32" aria-busy="true">
        <p className="font-mono text-label text-ink-secondary uppercase tracking-widest">Cargando artículos…</p>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-4 text-center">
        <p className="font-display text-h5 font-bold text-ink-primary">No se pudieron cargar los artículos</p>
        <button type="button" onClick={load} className="min-h-[44px] px-5 bg-primary text-surface font-body font-semibold rounded-sm hover:bg-primary-600 transition-colors duration-150">
          Reintentar
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-h3 font-bold text-ink-primary">Artículos</h1>
          <p className="font-body text-body-sm text-ink-secondary mt-0.5">
            {articles.length} {articles.length === 1 ? 'artículo' : 'artículos'} en total
          </p>
        </div>
        <Link
          to="/admin/articles/new"
          className="inline-flex items-center gap-2 min-h-[44px] px-4 bg-primary text-surface font-body text-body-sm font-semibold rounded-sm hover:bg-primary-600 transition-colors duration-150 focus-visible:rounded"
        >
          <PlusIcon /> Nuevo artículo
        </Link>
      </div>

      {/* Table */}
      {articles.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="bg-white rounded-card border border-border shadow-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="border-b border-border bg-surface">
                  <Th>Título</Th>
                  <Th>Estado</Th>
                  <Th>Categoría</Th>
                  <Th>Organización</Th>
                  <Th>Fecha</Th>
                  <Th>Votos</Th>
                  <Th><span className="sr-only">Acciones</span></Th>
                </tr>
              </thead>
              <tbody>
                {articles.map((article) => (
                  <tr
                    key={article.id}
                    className="border-b border-border last:border-b-0 hover:bg-surface transition-colors duration-100"
                  >
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-0.5">
                        <span className="font-body text-body-sm font-semibold text-ink-primary line-clamp-1">
                          {article.title}
                        </span>
                        {article.featured && (
                          <span className="font-mono text-label text-accent-500 uppercase tracking-widest">
                            Destacado
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={article.status ?? 'published'} />
                    </td>
                    <td className="px-4 py-3">
                      <CategoryBadge category={article.category} />
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-label text-ink-secondary uppercase tracking-widest">
                        {article.organization}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <time className="font-mono text-label text-ink-secondary" dateTime={article.date}>
                        {new Date(article.date).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </time>
                    </td>
                    <td className="px-4 py-3">
                      <VotePill votes={votes[article.id]} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        <Link
                          to={`/admin/articles/${article.id}/edit`}
                          className="min-h-[36px] px-3 inline-flex items-center font-body text-body-sm text-primary hover:bg-primary-50 rounded-sm transition-colors duration-150 focus-visible:rounded"
                        >
                          Editar
                        </Link>
                        {confirmId === article.id ? (
                          <span className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleDelete(article.id)}
                              className="min-h-[36px] px-3 font-body text-body-sm text-red-600 hover:bg-red-50 rounded-sm transition-colors duration-150"
                            >
                              Confirmar
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmId(null)}
                              className="min-h-[36px] px-2 font-body text-body-sm text-ink-secondary hover:bg-surface rounded-sm transition-colors duration-150"
                            >
                              Cancelar
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmId(article.id)}
                            className="min-h-[36px] px-3 font-body text-body-sm text-ink-secondary hover:text-red-600 hover:bg-red-50 rounded-sm transition-colors duration-150"
                          >
                            Eliminar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function Th({ children }) {
  return (
    <th className="px-4 py-3 text-left font-mono text-label uppercase tracking-widest text-ink-secondary">
      {children}
    </th>
  )
}

const STATUS_DISPLAY = {
  published:          { label: 'Publicado',         cls: 'bg-emerald-50 text-emerald-700' },
  draft:              { label: 'Borrador',           cls: 'bg-amber-50 text-amber-700'    },
  pending_review:     { label: 'Pendiente revisión', cls: 'bg-amber-50 text-amber-700'    },
  changes_requested:  { label: 'Cambios solicitados',cls: 'bg-blue-50 text-blue-700'      },
  rejected:           { label: 'Rechazado',          cls: 'bg-red-50 text-red-600'        },
}

function StatusBadge({ status }) {
  const meta = STATUS_DISPLAY[status] ?? { label: status, cls: 'bg-surface text-ink-secondary' }
  return (
    <span className={['font-mono text-label uppercase tracking-widest px-2 py-0.5 rounded-sm', meta.cls].join(' ')}>
      {meta.label}
    </span>
  )
}

function EmptyState() {
  return (
    <div className="bg-white rounded-card border border-border shadow-card flex flex-col items-center justify-center py-20 gap-4 text-center">
      <div className="relative w-16 h-16">
        <div className="absolute inset-0 rounded-full bg-primary-50" />
        <div className="absolute top-3 left-3 w-8 h-8 rotate-45 bg-accent-100" />
      </div>
      <p className="font-display text-h5 font-bold text-ink-primary">Sin artículos</p>
      <p className="font-body text-body-sm text-ink-secondary">Creá el primer artículo para el newsletter.</p>
      <Link
        to="/admin/articles/new"
        className="inline-flex items-center gap-2 min-h-[44px] px-5 bg-primary text-surface font-body text-body-sm font-semibold rounded-sm hover:bg-primary-600 transition-colors duration-150"
      >
        <PlusIcon /> Nuevo artículo
      </Link>
    </div>
  )
}

function VotePill({ votes }) {
  if (!votes || (votes.up === 0 && votes.down === 0)) {
    return <span className="font-mono text-label text-border">—</span>
  }
  return (
    <span className="flex items-center gap-2 font-mono text-label">
      <span className="text-emerald-600">▲ {votes.up}</span>
      <span className="text-red-500">▼ {votes.down}</span>
    </span>
  )
}

function PlusIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
}
