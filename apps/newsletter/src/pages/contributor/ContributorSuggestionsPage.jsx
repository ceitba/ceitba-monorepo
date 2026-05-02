import { useState } from 'react'
import { Link } from 'react-router-dom'
import { getContributorSession } from '../../store/contributorAuthStore'
import { getArticles } from '../../store/articleStore'
import { getEvents } from '../../store/eventStore'

const STATUS_LABEL = {
  pending_review:     { label: 'Pendiente de revisión', cls: 'bg-amber-50 text-amber-700' },
  changes_requested:  { label: 'Cambios solicitados',   cls: 'bg-blue-50 text-blue-700'  },
  published:          { label: 'Publicado',              cls: 'bg-emerald-50 text-emerald-700' },
  rejected:           { label: 'Rechazado',              cls: 'bg-red-50 text-red-600'    },
}

export default function ContributorSuggestionsPage() {
  const session = getContributorSession()
  const [items]  = useState(() => {
    if (!session) return []
    const articles = getArticles()
      .filter((a) => a.suggestedBy?.id === session.id)
      .map((a) => ({ ...a, resourceType: 'article' }))
    const events = getEvents()
      .filter((e) => e.suggestedBy?.id === session.id)
      .map((e) => ({ ...e, resourceType: 'event' }))
    return [...articles, ...events].sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0
      return tb - ta
    })
  })

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-h3 font-bold text-ink-primary">Mis sugerencias</h1>
          <p className="font-body text-body-sm text-ink-secondary mt-0.5">
            Artículos y eventos que propusiste al equipo editorial.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Link
            to="/contribute/suggest/article"
            className="inline-flex items-center gap-2 min-h-[40px] px-4 bg-primary text-surface font-body text-body-sm font-semibold rounded-sm hover:bg-primary-600 transition-colors duration-150 focus-visible:rounded"
          >
            <PlusIcon /> Artículo
          </Link>
          <Link
            to="/contribute/suggest/event"
            className="inline-flex items-center gap-2 min-h-[40px] px-4 bg-white border border-border text-ink-primary font-body text-body-sm font-semibold rounded-sm hover:border-primary hover:text-primary transition-colors duration-150 focus-visible:rounded"
          >
            <PlusIcon /> Evento
          </Link>
        </div>
      </div>

      {/* List */}
      {items.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item) => (
            <SuggestionRow key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  )
}

function SuggestionRow({ item }) {
  const s = STATUS_LABEL[item.status] ?? { label: item.status, cls: 'bg-surface text-ink-secondary' }
  const isArticle = item.resourceType === 'article'

  return (
    <div className="bg-white rounded-card border border-border shadow-card p-5 flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-mono text-label uppercase tracking-widest text-ink-secondary">
            {isArticle ? 'Artículo' : 'Evento'}
          </span>
          <span className={['font-mono text-label uppercase tracking-widest px-2 py-0.5 rounded-sm', s.cls].join(' ')}>
            {s.label}
          </span>
        </div>
        <p className="font-display text-h5 font-bold text-ink-primary leading-snug line-clamp-1">
          {item.title}
        </p>
        {isArticle && item.excerpt && (
          <p className="font-body text-body-sm text-ink-secondary mt-1 line-clamp-1">{item.excerpt}</p>
        )}
        {!isArticle && (
          <p className="font-body text-body-sm text-ink-secondary mt-1">
            {item.date} · {item.location}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {item.status === 'changes_requested' && (
          <Link
            to={`/contribute/review/${item.resourceType}/${item.id}`}
            className="min-h-[36px] px-3 inline-flex items-center font-body text-body-sm font-semibold text-white bg-accent hover:bg-accent-600 rounded-sm transition-colors duration-150 focus-visible:rounded"
          >
            Revisar cambios
          </Link>
        )}
        {(item.status === 'pending_review' || item.status === 'rejected') && (
          <Link
            to={`/contribute/suggest/${isArticle ? 'article' : 'event'}/${item.id}/edit`}
            className="min-h-[36px] px-3 inline-flex items-center font-body text-body-sm text-primary hover:bg-primary-50 rounded-sm transition-colors duration-150 focus-visible:rounded"
          >
            {item.status === 'rejected' ? 'Re-enviar' : 'Editar'}
          </Link>
        )}
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="bg-white rounded-card border border-border shadow-card flex flex-col items-center justify-center py-20 gap-4 text-center">
      <div className="relative w-16 h-16">
        <div className="absolute inset-0 rounded-full bg-primary-50" />
        <div className="absolute top-3 left-3 w-8 h-8 rotate-45 bg-accent-100" />
      </div>
      <p className="font-display text-h5 font-bold text-ink-primary">Aún no sugeriste nada</p>
      <p className="font-body text-body-sm text-ink-secondary max-w-xs">
        Proponé artículos o eventos al equipo editorial de ITBA News.
      </p>
      <div className="flex gap-3 mt-1">
        <Link
          to="/contribute/suggest/article"
          className="inline-flex items-center gap-2 min-h-[44px] px-5 bg-primary text-surface font-body text-body-sm font-semibold rounded-sm hover:bg-primary-600 transition-colors duration-150"
        >
          <PlusIcon /> Sugerir artículo
        </Link>
        <Link
          to="/contribute/suggest/event"
          className="inline-flex items-center gap-2 min-h-[44px] px-5 bg-white border border-border text-ink-primary font-body text-body-sm font-semibold rounded-sm hover:border-primary hover:text-primary transition-colors duration-150"
        >
          <PlusIcon /> Sugerir evento
        </Link>
      </div>
    </div>
  )
}

function PlusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  )
}
