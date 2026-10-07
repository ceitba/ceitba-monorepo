import { useState } from 'react'
import { Link } from 'react-router-dom'
import { getArticleSuggestions } from '../../store/articleStore'
import { getEventSuggestions } from '../../store/eventStore'

const STATUS_META = {
  pending_review:    { label: 'Pendiente',        cls: 'bg-amber-50 text-amber-700'   },
  changes_requested: { label: 'Esperando alumno', cls: 'bg-blue-50 text-blue-700'     },
  rejected:          { label: 'Rechazado',         cls: 'bg-red-50 text-red-600'       },
}

const TABS = [
  { key: 'pending',  label: 'Pendientes',      statuses: ['pending_review']    },
  { key: 'waiting',  label: 'Esperando alumno',statuses: ['changes_requested'] },
  { key: 'rejected', label: 'Rechazados',       statuses: ['rejected']         },
]

export default function AdminSuggestionsPage() {
  const [tab, setTab] = useState('pending')

  const allSuggestions = [
    ...getArticleSuggestions().map((a) => ({ ...a, resourceType: 'article' })),
    ...getEventSuggestions().map((e)   => ({ ...e, resourceType: 'event'   })),
  ].sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0
    return tb - ta
  })

  const activeStatuses = TABS.find((t) => t.key === tab)?.statuses ?? []
  const visible = allSuggestions.filter((s) => activeStatuses.includes(s.status))

  function countFor(key) {
    const statuses = TABS.find((t) => t.key === key)?.statuses ?? []
    return allSuggestions.filter((s) => statuses.includes(s.status)).length
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="font-display text-h3 font-bold text-ink-primary">Sugerencias</h1>
        <p className="font-body text-body-sm text-ink-secondary mt-0.5">
          Artículos y eventos propuestos por alumnos con cuenta @itba.edu.ar.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {TABS.map(({ key, label }) => {
          const count = countFor(key)
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={[
                'px-4 py-2.5 font-body text-body-sm font-semibold transition-colors duration-150 border-b-2 -mb-px',
                tab === key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-ink-secondary hover:text-ink-primary',
              ].join(' ')}
            >
              {label}
              {count > 0 && (
                <span className={[
                  'ml-2 font-mono text-label px-1.5 py-0.5 rounded-sm',
                  tab === key ? 'bg-primary-100 text-primary' : 'bg-surface text-ink-secondary',
                ].join(' ')}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* List */}
      {visible.length === 0 ? (
        <EmptyTab tab={tab} />
      ) : (
        <div className="bg-white rounded-card border border-border shadow-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="border-b border-border bg-surface">
                  <Th>Tipo</Th>
                  <Th>Título</Th>
                  <Th>Propuesto por</Th>
                  <Th>Estado</Th>
                  <Th><span className="sr-only">Acciones</span></Th>
                </tr>
              </thead>
              <tbody>
                {visible.map((item) => (
                  <SuggestionRow key={item.id} item={item} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function SuggestionRow({ item }) {
  const s = STATUS_META[item.status] ?? { label: item.status, cls: 'bg-surface text-ink-secondary' }
  const reviewPath = `/admin/suggestions/${item.resourceType}/${item.id}`

  return (
    <tr className="border-b border-border last:border-b-0 hover:bg-surface transition-colors duration-100">
      <td className="px-4 py-3">
        <span className="font-mono text-label uppercase tracking-widest text-ink-secondary">
          {item.resourceType === 'article' ? 'Artículo' : 'Evento'}
        </span>
      </td>
      <td className="px-4 py-3">
        <p className="font-body text-body-sm font-semibold text-ink-primary line-clamp-1 max-w-xs">
          {item.title}
        </p>
        {item.resourceType === 'article' && item.excerpt && (
          <p className="font-body text-body-sm text-ink-secondary line-clamp-1 max-w-xs mt-0.5">
            {item.excerpt}
          </p>
        )}
        {item.resourceType === 'event' && item.date && (
          <p className="font-mono text-label text-ink-secondary mt-0.5">{item.date} · {item.location}</p>
        )}
      </td>
      <td className="px-4 py-3">
        <p className="font-body text-body-sm text-ink-primary">{item.suggestedBy?.name}</p>
        <p className="font-mono text-label text-ink-secondary">{item.suggestedBy?.email}</p>
      </td>
      <td className="px-4 py-3">
        <span className={['font-mono text-label uppercase tracking-widest px-2 py-0.5 rounded-sm', s.cls].join(' ')}>
          {s.label}
        </span>
      </td>
      <td className="px-4 py-3 text-right">
        <Link
          to={reviewPath}
          className="min-h-[36px] px-3 inline-flex items-center font-body text-body-sm font-semibold text-primary hover:bg-primary-50 rounded-sm transition-colors duration-150 focus-visible:rounded"
        >
          {item.status === 'pending_review' ? 'Revisar' : 'Ver'}
        </Link>
      </td>
    </tr>
  )
}

function Th({ children }) {
  return (
    <th className="px-4 py-3 text-left font-mono text-label uppercase tracking-widest text-ink-secondary">
      {children}
    </th>
  )
}

function EmptyTab({ tab }) {
  const msg = {
    pending:  'No hay sugerencias pendientes de revisión.',
    waiting:  'No hay sugerencias esperando respuesta de alumnos.',
    rejected: 'No hay sugerencias rechazadas.',
  }
  return (
    <div className="bg-white rounded-card border border-border shadow-card flex flex-col items-center justify-center py-16 gap-3 text-center">
      <div className="relative w-14 h-14">
        <div className="absolute inset-0 rounded-full bg-primary-50" />
        <div className="absolute top-2.5 left-2.5 w-9 h-9 rotate-45 bg-accent-100" />
      </div>
      <p className="font-display text-h5 font-bold text-ink-primary">Todo despejado</p>
      <p className="font-body text-body-sm text-ink-secondary">{msg[tab]}</p>
    </div>
  )
}
