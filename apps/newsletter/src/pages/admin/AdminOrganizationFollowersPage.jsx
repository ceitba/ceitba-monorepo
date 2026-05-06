import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { fetchOrganizationFollowers } from '../../api/follows'
import { fetchOrganizationBySlug } from '../../api/organizations'
import { getOrganizations, isStaff } from '../../store/authStore'

export default function AdminOrganizationFollowersPage() {
  const { slug } = useParams()
  const allowed = isStaff() || getOrganizations().some((m) => m.slug === slug)

  const [data, setData]       = useState(null)
  const [orgName, setOrgName] = useState('')
  const [error, setError]     = useState('')
  const [query, setQuery]     = useState('')

  useEffect(() => {
    if (!allowed) return
    Promise.all([
      fetchOrganizationFollowers(slug),
      fetchOrganizationBySlug(slug).catch(() => null),
    ])
      .then(([followers, org]) => {
        setData(followers)
        if (org) setOrgName(org.name ?? '')
      })
      .catch((e) => setError(e.message ?? 'Error al cargar seguidores'))
  }, [slug, allowed])

  if (!allowed) {
    return (
      <div className="max-w-xl">
        <h1 className="font-display text-h3 font-bold text-ink-primary">Sin acceso</h1>
        <p className="font-body text-body text-ink-secondary mt-2">
          No sos miembro de esta organización.
        </p>
        <Link to="/admin/articles" className="mt-4 inline-block font-mono text-label text-primary underline underline-offset-2">
          Volver al panel
        </Link>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-xl">
        <h1 className="font-display text-h3 font-bold text-ink-primary">Error</h1>
        <p className="font-body text-body text-red-600 mt-2">{error}</p>
        <Link to={`/admin/org/${slug}`} className="mt-4 inline-block font-mono text-label text-primary underline underline-offset-2">
          Volver al perfil
        </Link>
      </div>
    )
  }

  if (!data) {
    return <p className="font-mono text-label uppercase tracking-widest text-ink-secondary">Cargando…</p>
  }

  const followers = data.data ?? []
  const count = data.count ?? followers.length

  const q = query.trim().toLowerCase()
  const visible = q
    ? followers.filter((f) =>
        (f.name ?? '').toLowerCase().includes(q) ||
        (f.email ?? '').toLowerCase().includes(q))
    : followers

  return (
    <div className="max-w-3xl">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-label uppercase tracking-widest text-ink-secondary">
            {slug}
          </p>
          <h1 className="font-display text-h2 font-bold text-ink-primary">
            Seguidores {orgName && <span className="text-ink-secondary font-normal">— {orgName}</span>}
          </h1>
        </div>
        <Link
          to={`/admin/org/${slug}`}
          className="font-mono text-label uppercase tracking-widest text-primary whitespace-nowrap"
        >
          ← Perfil
        </Link>
      </header>

      <div className="flex items-baseline gap-3 mb-4">
        <span className="font-display text-h2 font-bold text-ink-primary">{count}</span>
        <span className="font-mono text-label uppercase tracking-widest text-ink-secondary">
          {count === 1 ? 'persona sigue' : 'personas siguen'} esta organización
        </span>
      </div>

      {followers.length > 0 && (
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nombre o email…"
          className="w-full mb-4 px-3 py-2 border border-border rounded-sm font-body text-body text-ink-primary bg-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors duration-150"
        />
      )}

      {followers.length === 0 ? (
        <p className="font-body text-body text-ink-secondary">
          Todavía nadie sigue esta organización.
        </p>
      ) : visible.length === 0 ? (
        <p className="font-body text-body text-ink-secondary">
          No hay coincidencias.
        </p>
      ) : (
        <ul className="flex flex-col gap-1 list-none m-0 p-0 border border-border rounded-sm bg-white divide-y divide-border">
          {visible.map((f) => (
            <li key={f.userId} className="flex items-center gap-3 p-3">
              {f.avatarUrl
                ? <img src={f.avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover bg-surface" />
                : <div className="w-9 h-9 rounded-full bg-surface" aria-hidden="true" />}
              <div className="min-w-0 flex-1">
                <p className="font-display text-body font-bold text-ink-primary truncate">
                  {f.name || '—'}
                </p>
                <p className="font-mono text-label text-ink-secondary truncate">
                  {f.email}
                </p>
              </div>
              <time
                dateTime={f.followedAt}
                className="font-mono text-label uppercase tracking-widest text-ink-secondary whitespace-nowrap"
              >
                {formatDate(f.followedAt)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })
}
