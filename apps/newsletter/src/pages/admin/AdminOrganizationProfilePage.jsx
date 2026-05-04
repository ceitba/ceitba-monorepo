import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { fetchOrganizationBySlug, updateOrganization } from '../../api/organizations'
import { getOrganizations, isStaff } from '../../store/authStore'

const COLOR_SCHEMES = [
  { value: 'blue',   label: 'Azul'    },
  { value: 'amber',  label: 'Ámbar'   },
  { value: 'green',  label: 'Verde'   },
  { value: 'violet', label: 'Violeta' },
]

export default function AdminOrganizationProfilePage() {
  const { slug } = useParams()
  const allowed = isStaff() || getOrganizations().some((m) => m.slug === slug)

  const [form, setForm]         = useState(null)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)
  const [apiError, setApiError] = useState('')

  useEffect(() => {
    if (!allowed) return
    fetchOrganizationBySlug(slug)
      .then((org) => setForm({
        name:          org.name ?? '',
        fullName:      org.fullName ?? '',
        description:   org.description ?? '',
        category:      org.category ?? '',
        color:         org.color ?? 'blue',
        memberCount:   org.memberCount ?? 0,
        logoUrl:       org.logoUrl ?? '',
        backgroundUrl: org.backgroundUrl ?? '',
      }))
      .catch((e) => setLoadError(e.message ?? 'Error al cargar la organización'))
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

  if (loadError) {
    return (
      <div className="max-w-xl">
        <h1 className="font-display text-h3 font-bold text-ink-primary">No encontrado</h1>
        <p className="font-body text-body text-ink-secondary mt-2">{loadError}</p>
      </div>
    )
  }

  if (!form) {
    return <p className="font-mono text-label uppercase tracking-widest text-ink-secondary">Cargando…</p>
  }

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
    setSaved(false)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setApiError('')
    try {
      const next = await updateOrganization(slug, form)
      setForm({
        name:          next.name ?? '',
        fullName:      next.fullName ?? '',
        description:   next.description ?? '',
        category:      next.category ?? '',
        color:         next.color ?? 'blue',
        memberCount:   next.memberCount ?? 0,
        logoUrl:       next.logoUrl ?? '',
        backgroundUrl: next.backgroundUrl ?? '',
      })
      setSaved(true)
    } catch (err) {
      setApiError(err.message ?? 'Error al guardar.')
    } finally {
      setSaving(false)
    }
  }

  const canEditNames = isStaff()

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-8">
      <form onSubmit={handleSubmit} className="flex flex-col gap-6 max-w-2xl">
        <header>
          <p className="font-mono text-label uppercase tracking-widest text-ink-secondary">
            {slug}
          </p>
          <h1 className="font-display text-h2 font-bold text-ink-primary">
            Perfil de la organización
          </h1>
        </header>

        <Field label="Nombre corto">
          <input
            type="text"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            disabled={!canEditNames}
            className={inputClass()}
          />
        </Field>

        <Field label="Nombre completo">
          <input
            type="text"
            value={form.fullName}
            onChange={(e) => set('fullName', e.target.value)}
            disabled={!canEditNames}
            className={inputClass()}
          />
        </Field>

        <Field label="Descripción">
          <textarea
            rows={4}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            className={inputClass()}
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Categoría">
            <input
              type="text"
              value={form.category}
              onChange={(e) => set('category', e.target.value)}
              className={inputClass()}
            />
          </Field>
          <Field label="Color">
            <select
              value={form.color}
              onChange={(e) => set('color', e.target.value)}
              className={inputClass()}
            >
              {COLOR_SCHEMES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="URL del logo">
          <input
            type="url"
            value={form.logoUrl}
            onChange={(e) => set('logoUrl', e.target.value)}
            placeholder="https://…"
            className={inputClass()}
          />
        </Field>

        <Field label="URL del fondo">
          <input
            type="url"
            value={form.backgroundUrl}
            onChange={(e) => set('backgroundUrl', e.target.value)}
            placeholder="https://…"
            className={inputClass()}
          />
        </Field>

        {apiError && (
          <p className="font-body text-body-sm text-red-600">{apiError}</p>
        )}

        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 min-h-[40px] px-5 bg-primary text-surface font-body text-body-sm font-semibold rounded-sm hover:bg-primary-600 transition-colors duration-150 disabled:opacity-50"
          >
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
          {saved && (
            <span className="font-mono text-label text-emerald-600 uppercase tracking-widest">
              Guardado
            </span>
          )}
        </div>
      </form>

      <aside className="lg:sticky lg:top-20 self-start">
        <p className="font-mono text-label uppercase tracking-widest text-ink-secondary mb-2">
          Previsualización
        </p>
        <div className="border border-border rounded-sm overflow-hidden bg-white">
          <div
            className="h-32 bg-primary-100"
            style={form.backgroundUrl
              ? { backgroundImage: `url(${form.backgroundUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
              : undefined}
            aria-hidden="true"
          />
          <div className="p-4 flex items-start gap-3">
            {form.logoUrl
              ? <img src={form.logoUrl} alt="" className="w-12 h-12 rounded-sm object-cover bg-surface" />
              : <div className="w-12 h-12 rounded-sm bg-surface" aria-hidden="true" />}
            <div className="min-w-0">
              <p className="font-display text-body font-bold text-ink-primary truncate">
                {form.name || slug}
              </p>
              <p className="font-mono text-label text-ink-secondary truncate">
                {form.fullName}
              </p>
              <p className="font-body text-body-sm text-ink-secondary mt-2 line-clamp-3">
                {form.description}
              </p>
            </div>
          </div>
        </div>
      </aside>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-label uppercase tracking-widest text-ink-secondary">{label}</span>
      {children}
    </label>
  )
}

function inputClass() {
  return 'w-full px-3 py-2 border border-border rounded-sm font-body text-body text-ink-primary bg-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors duration-150 disabled:bg-surface disabled:text-ink-secondary'
}
