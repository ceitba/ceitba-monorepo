import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { getArticleById, acceptArticleChanges, rejectArticleChanges } from '../../store/articleStore'
import { getEventById, acceptEventChanges, rejectEventChanges } from '../../store/eventStore'

export default function ContributorReviewChangesPage() {
  const { type, id } = useParams()  // type = 'article' | 'event'
  const navigate     = useNavigate()
  const [done, setDone] = useState(null) // null | 'accepted' | 'rejected'

  const resource = type === 'article' ? getArticleById(id) : getEventById(id)

  if (!resource) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-3">
        <p className="font-display text-h5 font-bold text-ink-primary">Sugerencia no encontrada</p>
        <Link to="/contribute" className="text-primary hover:underline font-body text-body-sm">
          ← Volver a mis sugerencias
        </Link>
      </div>
    )
  }

  if (resource.status !== 'changes_requested' || !resource.staffEdits) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-3">
        <p className="font-display text-h5 font-bold text-ink-primary">Sin cambios pendientes</p>
        <p className="font-body text-body-sm text-ink-secondary">
          Esta sugerencia no tiene cambios del staff esperando revisión.
        </p>
        <Link to="/contribute" className="text-primary hover:underline font-body text-body-sm mt-2">
          ← Volver
        </Link>
      </div>
    )
  }

  function handleAccept() {
    if (type === 'article') acceptArticleChanges(id)
    else acceptEventChanges(id)
    setDone('accepted')
    setTimeout(() => navigate('/contribute'), 1400)
  }

  function handleReject() {
    if (type === 'article') rejectArticleChanges(id)
    else rejectEventChanges(id)
    setDone('rejected')
    setTimeout(() => navigate('/contribute'), 1400)
  }

  if (done) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-3 animate-fade-in">
        <div className={['w-12 h-12 rounded-full flex items-center justify-center', done === 'accepted' ? 'bg-emerald-50' : 'bg-amber-50'].join(' ')}>
          {done === 'accepted' ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>
          )}
        </div>
        <p className="font-display text-h5 font-bold text-ink-primary">
          {done === 'accepted' ? '¡Publicado! Gracias por tu contribución.' : 'Cambios rechazados. Vuelve al estado de revisión.'}
        </p>
      </div>
    )
  }

  const original = resource
  const proposed = { ...resource, ...resource.staffEdits }
  const isArticle = type === 'article'

  const COMPARE_FIELDS = isArticle
    ? [
        { key: 'title',       label: 'Título' },
        { key: 'excerpt',     label: 'Copete' },
        { key: 'category',    label: 'Categoría' },
        { key: 'organization',label: 'Organización' },
        { key: 'readingTime', label: 'Tiempo de lectura' },
      ]
    : [
        { key: 'title',       label: 'Título' },
        { key: 'date',        label: 'Fecha' },
        { key: 'time',        label: 'Inicio' },
        { key: 'endTime',     label: 'Fin' },
        { key: 'location',    label: 'Lugar' },
        { key: 'category',    label: 'Categoría' },
        { key: 'organization',label: 'Organización' },
        { key: 'description', label: 'Descripción' },
      ]

  const changedFields = COMPARE_FIELDS.filter(
    ({ key }) => String(original[key] ?? '') !== String(proposed[key] ?? ''),
  )
  const bodyChanged = isArticle &&
    JSON.stringify(original.body) !== JSON.stringify(proposed.body)

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          to="/contribute"
          className="font-mono text-label text-ink-secondary hover:text-primary transition-colors duration-150 underline underline-offset-2"
        >
          ← Mis sugerencias
        </Link>
        <h1 className="font-display text-h3 font-bold text-ink-primary">Revisar cambios del staff</h1>
      </div>

      {/* Info banner */}
      <div className="rounded-card border border-blue-200 bg-blue-50 px-4 py-3">
        <p className="font-body text-body-sm text-blue-800">
          El staff propuso cambios en tu {isArticle ? 'artículo' : 'evento'}{' '}
          <strong>"{resource.title}"</strong>. Revisá las diferencias y decidí si aceptás la versión propuesta o la devolvés al estado de revisión.
        </p>
      </div>

      {/* Summary of changes */}
      {changedFields.length === 0 && !bodyChanged ? (
        <div className="bg-white rounded-card border border-border shadow-card p-5">
          <p className="font-body text-body-sm text-ink-secondary italic">No se detectaron diferencias de texto.</p>
        </div>
      ) : (
        <div className="bg-white rounded-card border border-border shadow-card overflow-hidden">
          {/* Column headers */}
          <div className="grid grid-cols-2 border-b border-border">
            <div className="px-5 py-3 border-r border-border bg-surface">
              <p className="font-mono text-label uppercase tracking-widest text-ink-secondary">Tu versión</p>
            </div>
            <div className="px-5 py-3 bg-blue-50">
              <p className="font-mono text-label uppercase tracking-widest text-blue-700">Versión del staff</p>
            </div>
          </div>

          {changedFields.map(({ key, label }, i) => (
            <div
              key={key}
              className={['grid grid-cols-2', i < changedFields.length - 1 || bodyChanged ? 'border-b border-border' : ''].join(' ')}
            >
              <div className="px-5 py-4 border-r border-border">
                <p className="font-mono text-label uppercase tracking-widest text-ink-secondary mb-1">{label}</p>
                <p className="font-body text-body text-ink-primary">{original[key] || <em className="text-border">—</em>}</p>
              </div>
              <div className="px-5 py-4 bg-blue-50/40">
                <p className="font-mono text-label uppercase tracking-widest text-blue-600 mb-1">{label}</p>
                <p className="font-body text-body text-ink-primary">{proposed[key] || <em className="text-border">—</em>}</p>
              </div>
            </div>
          ))}

          {bodyChanged && (
            <div className="grid grid-cols-2">
              <div className="px-5 py-4 border-r border-border">
                <p className="font-mono text-label uppercase tracking-widest text-ink-secondary mb-2">Cuerpo</p>
                <div className="flex flex-col gap-2">
                  {(original.body ?? []).filter(Boolean).map((p, i) => (
                    <p key={i} className="font-body text-body-sm text-ink-primary leading-relaxed">{p}</p>
                  ))}
                  {(original.body ?? []).filter(Boolean).length === 0 && (
                    <em className="font-body text-body-sm text-border">Sin cuerpo</em>
                  )}
                </div>
              </div>
              <div className="px-5 py-4 bg-blue-50/40">
                <p className="font-mono text-label uppercase tracking-widest text-blue-600 mb-2">Cuerpo</p>
                <div className="flex flex-col gap-2">
                  {(proposed.body ?? []).filter(Boolean).map((p, i) => (
                    <p key={i} className="font-body text-body-sm text-ink-primary leading-relaxed">{p}</p>
                  ))}
                  {(proposed.body ?? []).filter(Boolean).length === 0 && (
                    <em className="font-body text-body-sm text-border">Sin cuerpo</em>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-3">
        <button
          type="button"
          onClick={handleAccept}
          className="min-h-[44px] px-6 bg-emerald-600 text-white font-body font-semibold rounded-sm hover:bg-emerald-700 transition-colors duration-150 focus-visible:rounded"
        >
          Aceptar cambios y publicar
        </button>
        <button
          type="button"
          onClick={handleReject}
          className="min-h-[44px] px-6 bg-white border border-border text-ink-secondary font-body font-semibold rounded-sm hover:border-red-300 hover:text-red-600 transition-colors duration-150 focus-visible:rounded"
        >
          Rechazar cambios
        </button>
      </div>

      <p className="font-body text-body-sm text-ink-secondary">
        Al rechazar, tu versión original vuelve a la cola de revisión del staff.
      </p>
    </div>
  )
}
