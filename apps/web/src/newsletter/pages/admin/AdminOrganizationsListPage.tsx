import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { fetchOrganizations } from '../../api/organizations'
import { isStaff } from '../../store/authStore'
import { newsletterPath } from '@/newsletter/paths'
import type { Organization } from '../../types'

export default function AdminOrganizationsListPage() {
  // Hooks run unconditionally (rules of hooks); the staff redirect comes
  // after them and the fetch is skipped for non-staff.
  const staff = isStaff()
  const [orgs, setOrgs] = useState<Organization[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!staff) return
    fetchOrganizations()
      // GET /organizations answers { data: [...] }, but api/organizations
      // types it as a bare Organization[].
      .then(({ data }) => setOrgs(data ?? []))
      .catch(() => setError('No se pudieron cargar las organizaciones.'))
  }, [staff])

  if (!staff) return <Navigate to={newsletterPath('/admin/articles')} replace />

  if (error) return <p className="font-body text-body text-red-600">{error}</p>
  if (!orgs) return <p className="font-mono text-label uppercase tracking-widest text-ink-secondary">Cargando…</p>

  return (
    <div className="max-w-3xl">
      <header className="mb-6">
        <h1 className="font-display text-h2 font-bold text-ink-primary">
          Todas las organizaciones
        </h1>
        <p className="font-body text-body-sm text-ink-secondary mt-1">
          Como CEITBA podés editar el perfil de cualquier organización.
        </p>
      </header>

      <ul className="flex flex-col gap-2 list-none m-0 p-0">
        {orgs.map((org) => (
          <li key={org.slug}>
            <Link
              to={newsletterPath(`/admin/org/${org.slug}`)}
              className="flex items-center gap-3 p-3 border border-border rounded-sm bg-white hover:border-primary transition-colors duration-150"
            >
              {org.logoUrl
                ? <img src={org.logoUrl} alt="" className="w-10 h-10 rounded-sm object-cover bg-surface" />
                : <div className="w-10 h-10 rounded-sm bg-surface" aria-hidden="true" />}
              <div className="min-w-0 flex-1">
                <p className="font-display text-body font-bold text-ink-primary truncate">
                  {org.name}
                </p>
                <p className="font-mono text-label text-ink-secondary truncate">
                  {org.slug} · {org.fullName}
                </p>
              </div>
              <span className="font-mono text-label uppercase tracking-widest text-primary">
                Editar →
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
