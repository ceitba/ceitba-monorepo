import { useState } from 'react'
import { Link } from 'react-router-dom'
import { getEvents, deleteEvent } from '../../store/eventStore'
import CategoryBadge from '../../components/CategoryBadge'

export default function AdminEventsPage() {
  const [events, setEvents]   = useState(() => getEvents())
  const [confirmId, setConfirmId] = useState(null)

  function handleDelete(id) {
    deleteEvent(id)
    setEvents(getEvents())
    setConfirmId(null)
  }

  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date))
  const today  = new Date().toISOString().slice(0, 10)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-h3 font-bold text-ink-primary">Eventos</h1>
          <p className="font-body text-body-sm text-ink-secondary mt-0.5">
            {events.length} {events.length === 1 ? 'evento' : 'eventos'} en total
          </p>
        </div>
        <Link
          to="/admin/events/new"
          className="inline-flex items-center gap-2 min-h-[44px] px-4 bg-primary text-surface font-body text-body-sm font-semibold rounded-sm hover:bg-primary-600 transition-colors duration-150 focus-visible:rounded"
        >
          <PlusIcon /> Nuevo evento
        </Link>
      </div>

      {sorted.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="bg-white rounded-card border border-border shadow-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="border-b border-border bg-surface">
                  <Th>Título</Th>
                  <Th>Fecha y hora</Th>
                  <Th>Categoría</Th>
                  <Th>Lugar</Th>
                  <Th>Organización</Th>
                  <Th><span className="sr-only">Acciones</span></Th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((event) => {
                  const isPast = event.date < today
                  return (
                    <tr
                      key={event.id}
                      className={[
                        'border-b border-border last:border-b-0 transition-colors duration-100',
                        isPast ? 'opacity-50 bg-surface hover:opacity-70' : 'hover:bg-surface',
                      ].join(' ')}
                    >
                      <td className="px-4 py-3">
                        <span className="font-body text-body-sm font-semibold text-ink-primary line-clamp-1">
                          {event.title}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-0.5">
                          <time className="font-mono text-label text-ink-primary" dateTime={event.date}>
                            {new Date(event.date).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </time>
                          <span className="font-mono text-label text-ink-secondary">
                            {event.time}–{event.endTime}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <CategoryBadge category={event.category} />
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-body text-body-sm text-ink-secondary line-clamp-1">
                          {event.location}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-label text-ink-secondary uppercase tracking-widest">
                          {event.organization}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 justify-end">
                          <Link
                            to={`/admin/events/${event.id}/edit`}
                            className="min-h-[36px] px-3 inline-flex items-center font-body text-body-sm text-primary hover:bg-primary-50 rounded-sm transition-colors duration-150"
                          >
                            Editar
                          </Link>
                          {confirmId === event.id ? (
                            <span className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleDelete(event.id)}
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
                              onClick={() => setConfirmId(event.id)}
                              className="min-h-[36px] px-3 font-body text-body-sm text-ink-secondary hover:text-red-600 hover:bg-red-50 rounded-sm transition-colors duration-150"
                            >
                              Eliminar
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
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

function EmptyState() {
  return (
    <div className="bg-white rounded-card border border-border shadow-card flex flex-col items-center justify-center py-20 gap-4 text-center">
      <div className="relative w-16 h-16">
        <div className="absolute inset-0 rounded-full bg-primary-50" />
        <div className="absolute top-3 left-3 w-8 h-8 rotate-45 bg-accent-100" />
      </div>
      <p className="font-display text-h5 font-bold text-ink-primary">Sin eventos</p>
      <p className="font-body text-body-sm text-ink-secondary">Creá el primer evento para el calendario.</p>
      <Link
        to="/admin/events/new"
        className="inline-flex items-center gap-2 min-h-[44px] px-5 bg-primary text-surface font-body text-body-sm font-semibold rounded-sm hover:bg-primary-600 transition-colors duration-150"
      >
        <PlusIcon /> Nuevo evento
      </Link>
    </div>
  )
}

function PlusIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
}
