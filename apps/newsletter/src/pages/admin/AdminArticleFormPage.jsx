import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  fetchArticleById,
  createArticle,
  updateArticle,
} from '../../api/articles'
import { fetchOrganizations } from '../../api/organizations'
import { CATEGORIES } from '../../data/articles'
import ImageUploader from '../../components/ImageUploader'
import ArticleLivePreview from '../../components/admin/ArticleLivePreview'

const COLOR_SCHEMES = [
  { value: 'blue',   bg: 'bg-primary-500',  label: 'Azul'    },
  { value: 'amber',  bg: 'bg-accent-400',   label: 'Ámbar'   },
  { value: 'green',  bg: 'bg-emerald-600',  label: 'Verde'   },
  { value: 'violet', bg: 'bg-violet-600',   label: 'Violeta' },
]

const EMPTY_FORM = {
  title:        '',
  excerpt:      '',
  body:         [''],
  category:     'Académico',
  organization: 'ceitba',
  authors:      [''],
  date:         new Date().toISOString().slice(0, 10),
  readingTime:  '',
  featured:     false,
  colorScheme:  'blue',
  coverImage:   '',
  status:       'published',
}

export default function AdminArticleFormPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = Boolean(id)

  const [form, setForm]         = useState(EMPTY_FORM)
  const [orgs, setOrgs]         = useState([])
  const [errors, setErrors]     = useState({})
  const [touched, setTouched]   = useState(false)
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)
  const [apiError, setApiError] = useState('')
  const [viewMode, setViewMode] = useState('edit')

  useEffect(() => {
    fetchOrganizations()
      .then(({ data }) => setOrgs(data ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!isEdit) return
    fetchArticleById(id)
      .then((existing) => {
        setForm({
          ...EMPTY_FORM,
          ...existing,
          body: Array.isArray(existing.body) && existing.body.length
            ? existing.body
            : [existing.excerpt ?? ''],
          authors: Array.isArray(existing.authors) && existing.authors.length
            ? existing.authors
            : [''],
        })
      })
      .catch(() => {})
  }, [id, isEdit])

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
    if (touched) validate({ ...form, [key]: value })
  }

  function validate(values = form) {
    const e = {}
    if (!values.title.trim())       e.title       = 'El título es obligatorio.'
    if (!values.excerpt.trim())     e.excerpt     = 'El copete es obligatorio.'
    if (!values.authors.some((a) => a.trim())) e.authors = 'Agregá al menos un autor.'
    if (!values.date)               e.date        = 'La fecha es obligatoria.'
    if (!values.readingTime.trim()) e.readingTime = 'El tiempo de lectura es obligatorio.'
    if (values.body.every((p) => !p.trim())) e.body = 'Escribí al menos un párrafo.'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSubmit(status) {
    setTouched(true)
    if (!validate()) return

    setSaving(true)
    setApiError('')
    try {
      const payload = {
        ...form,
        status,
        body: form.body.filter((p) => p.trim()),
        authors: form.authors.map((a) => a.trim()).filter(Boolean),
      }
      if (isEdit) {
        await updateArticle(id, payload)
      } else {
        await createArticle(payload)
      }
      setSaved(true)
      setTimeout(() => navigate('/admin/articles'), 800)
    } catch {
      setApiError('No se pudo guardar el artículo. Intentá de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  function updatePara(i, val) { set('body', form.body.map((p, idx) => (idx === i ? val : p))) }
  function addPara()          { set('body', [...form.body, '']) }
  function removePara(i)      { set('body', form.body.filter((_, idx) => idx !== i)) }

  function updateAuthor(i, val) { set('authors', form.authors.map((a, idx) => (idx === i ? val : a))) }
  function addAuthor()          { set('authors', [...form.authors, '']) }
  function removeAuthor(i)      { set('authors', form.authors.filter((_, idx) => idx !== i)) }

  if (saved) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-3 animate-fade-in">
        <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <p className="font-display text-h5 font-bold text-ink-primary">
          {isEdit ? 'Artículo actualizado' : 'Artículo publicado'}
        </p>
      </div>
    )
  }

  const previewArticle = { ...form, id: 'preview', body: form.body.filter((p) => p.trim()) }

  const formFields = (
    <>
      <div className="flex-1 flex flex-col gap-5">
        <FormField label="Título" error={errors.title} required>
          <input type="text" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Título del artículo" className={inputClass(errors.title)} />
        </FormField>

        <FormField label="Copete" hint="2–3 oraciones. Aparece en la tarjeta y en el índice." error={errors.excerpt} required>
          <textarea rows={3} value={form.excerpt} onChange={(e) => set('excerpt', e.target.value)} placeholder="Resumen breve del artículo…" className={inputClass(errors.excerpt)} />
        </FormField>

        <div className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <label className="font-body text-body-sm font-semibold text-ink-primary">
              Cuerpo <span className="text-red-500" aria-hidden="true">*</span>
            </label>
            {errors.body && <span className="font-body text-body-sm text-red-600">{errors.body}</span>}
          </div>
          {form.body.map((para, i) => (
            <div key={i} className="relative group">
              <textarea rows={5} value={para} onChange={(e) => updatePara(i, e.target.value)} placeholder={`Párrafo ${i + 1}…`} className={[inputClass(null), 'pr-10'].join(' ')} />
              {form.body.length > 1 && (
                <button type="button" onClick={() => removePara(i)} aria-label={`Eliminar párrafo ${i + 1}`} className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center rounded text-ink-secondary hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity duration-150">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              )}
            </div>
          ))}
          <button type="button" onClick={addPara} className="self-start min-h-[36px] px-3 flex items-center gap-2 font-body text-body-sm text-primary border border-dashed border-primary/40 hover:border-primary hover:bg-primary-50 rounded-sm transition-colors duration-150 focus-visible:rounded">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Agregar párrafo
          </button>
        </div>

        <FormField label="Imagen de portada" hint="Opcional">
          <ImageUploader value={form.coverImage} onChange={(v) => set('coverImage', v)} />
        </FormField>
      </div>

      <aside className="lg:w-72 flex-shrink-0 flex flex-col gap-4">
        <div className="bg-white rounded-card border border-border shadow-card p-4 flex flex-col gap-3">
          {apiError && (
            <p role="alert" className="font-body text-body-sm text-red-600 bg-red-50 px-3 py-2 rounded-sm">
              {apiError}
            </p>
          )}
          <button type="button" onClick={() => handleSubmit('published')} disabled={saving} className="min-h-[44px] bg-primary text-surface font-body font-semibold rounded-sm hover:bg-primary-600 transition-colors duration-150 disabled:opacity-60 focus-visible:rounded">
            {saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Publicar'}
          </button>
          <button type="button" onClick={() => handleSubmit('draft')} disabled={saving} className="min-h-[44px] bg-white border border-border text-ink-secondary font-body font-semibold rounded-sm hover:border-primary hover:text-primary transition-colors duration-150 disabled:opacity-60 focus-visible:rounded">
            Guardar como borrador
          </button>
        </div>

        <SidebarCard title="Estado">
          <StatusToggle value={form.status} onChange={(v) => set('status', v)} />
        </SidebarCard>

        <SidebarCard title="Categoría">
          <select value={form.category} onChange={(e) => set('category', e.target.value)} className={selectClass()}>
            {CATEGORIES.filter((c) => c !== 'TODOS').map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </SidebarCard>

        <SidebarCard title="Organización">
          <select value={form.organization} onChange={(e) => set('organization', e.target.value)} className={selectClass()}>
            {orgs.map((o) => <option key={o.slug} value={o.slug}>{o.name}</option>)}
          </select>
        </SidebarCard>

        <SidebarCard title="Metadatos">
          <div className="flex flex-col gap-3">
            <FormField label="Autores" error={errors.authors} required small>
              <div className="flex flex-col gap-2">
                {form.authors.map((author, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <input
                      type="text"
                      value={author}
                      onChange={(e) => updateAuthor(i, e.target.value)}
                      placeholder={`Autor ${i + 1}`}
                      className={[inputClass(errors.authors), 'flex-1'].join(' ')}
                    />
                    {form.authors.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeAuthor(i)}
                        aria-label={`Quitar autor ${i + 1}`}
                        className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-sm text-ink-secondary hover:text-red-600 hover:bg-red-50 transition-colors duration-150"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addAuthor}
                  className="self-start min-h-[32px] px-2 flex items-center gap-1.5 font-body text-body-sm text-primary border border-dashed border-primary/40 hover:border-primary hover:bg-primary-50 rounded-sm transition-colors duration-150 focus-visible:rounded"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  Agregar autor
                </button>
              </div>
            </FormField>
            <FormField label="Fecha" error={errors.date} required small>
              <input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} className={inputClass(errors.date)} />
            </FormField>
            <FormField label="Tiempo de lectura" error={errors.readingTime} required small>
              <input type="text" value={form.readingTime} onChange={(e) => set('readingTime', e.target.value)} placeholder="p. ej. 4 min" className={inputClass(errors.readingTime)} />
            </FormField>
          </div>
        </SidebarCard>

        <SidebarCard title="Destacado">
          <label className="flex items-center gap-3 cursor-pointer">
            <div className="relative">
              <input type="checkbox" checked={form.featured} onChange={(e) => set('featured', e.target.checked)} className="sr-only peer" />
              <div className="w-10 h-5 bg-border rounded-full peer-checked:bg-primary transition-colors duration-150" />
              <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-150 peer-checked:translate-x-5" />
            </div>
            <span className="font-body text-body-sm text-ink-secondary">
              {form.featured ? 'Sí, mostrar como destacado' : 'No destacado'}
            </span>
          </label>
          {form.featured && (
            <p className="mt-2 font-mono text-label text-ink-secondary leading-relaxed">
              Desplazará al artículo destacado actual.
            </p>
          )}
        </SidebarCard>

        <SidebarCard title="Color de portada">
          <div className="grid grid-cols-4 gap-2">
            {COLOR_SCHEMES.map(({ value, bg, label }) => (
              <button key={value} type="button" onClick={() => set('colorScheme', value)} aria-label={label} aria-pressed={form.colorScheme === value} className={['h-10 rounded-sm transition-all duration-150 focus-visible:rounded relative', bg, form.colorScheme === value ? 'ring-2 ring-offset-2 ring-primary' : 'opacity-70 hover:opacity-100'].join(' ')}>
                {form.colorScheme === value && (
                  <svg className="absolute inset-0 m-auto" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                )}
              </button>
            ))}
          </div>
        </SidebarCard>
      </aside>
    </>
  )

  return (
    <div className="flex flex-col gap-6" style={{ maxWidth: viewMode === 'split' ? 'none' : '64rem' }}>
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <Link to="/admin/articles" className="font-mono text-label text-ink-secondary hover:text-primary transition-colors duration-150 underline underline-offset-2">
            ← Artículos
          </Link>
          <h1 className="font-display text-h3 font-bold text-ink-primary">
            {isEdit ? 'Editar artículo' : 'Nuevo artículo'}
          </h1>
        </div>
        <ViewModeToggle value={viewMode} onChange={setViewMode} />
      </div>

      {viewMode === 'preview' && (
        <div className="bg-white rounded-card border border-border shadow-card p-6">
          <ArticleLivePreview article={previewArticle} orgs={orgs} />
        </div>
      )}

      {viewMode === 'edit' && (
        <div className="flex flex-col lg:flex-row gap-6 lg:items-start">
          {formFields}
        </div>
      )}

      {viewMode === 'split' && (
        <div className="flex -mx-4 sm:-mx-6 lg:-mx-8">
          <div className="flex-1 min-w-0 overflow-y-auto px-4 sm:px-6 lg:px-8 pb-16" style={{ maxHeight: 'calc(100vh - 3.5rem)' }}>
            <div className="flex flex-col lg:flex-row gap-6 lg:items-start">{formFields}</div>
          </div>
          <div className="w-[44%] flex-shrink-0 border-l border-border bg-surface overflow-y-auto px-6 lg:px-8 pt-6 pb-16" style={{ maxHeight: 'calc(100vh - 3.5rem)' }} aria-label="Vista previa en tiempo real">
            <p className="font-mono text-label uppercase tracking-widest text-ink-secondary mb-6 flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-accent animate-pulse" aria-hidden="true" />
              Vista previa en tiempo real
            </p>
            <ArticleLivePreview article={previewArticle} orgs={orgs} />
          </div>
        </div>
      )}
    </div>
  )
}

function ViewModeToggle({ value, onChange }) {
  const modes = [
    { key: 'edit',    label: 'Editor',       icon: <IconEdit /> },
    { key: 'split',   label: 'Split',        icon: <IconSplit />, desktopOnly: true },
    { key: 'preview', label: 'Vista previa', icon: <IconEye /> },
  ]
  return (
    <div className="flex rounded-sm border border-border overflow-hidden" role="group" aria-label="Modo de vista">
      {modes.map(({ key, label, icon, desktopOnly }) => (
        <button key={key} type="button" onClick={() => onChange(key)} aria-pressed={value === key} className={['flex items-center gap-1.5 min-h-[36px] px-3 font-mono text-label uppercase tracking-widest transition-colors duration-150', desktopOnly ? 'hidden lg:flex' : 'flex', value === key ? 'bg-primary text-white' : 'text-ink-secondary hover:bg-surface'].join(' ')}>
          <span className="w-3.5 h-3.5">{icon}</span>
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  )
}

function IconEdit()  { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> }
function IconSplit() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/></svg> }
function IconEye()   { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> }

function SidebarCard({ title, children }) {
  return (
    <div className="bg-white rounded-card border border-border shadow-card p-4">
      <p className="font-mono text-label uppercase tracking-widest text-ink-secondary mb-3">{title}</p>
      {children}
    </div>
  )
}

function FormField({ label, hint, error, required, small, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label className={['font-body font-semibold text-ink-primary', small ? 'text-body-sm' : 'text-body-sm'].join(' ')}>
          {label}
          {required && <span className="text-red-500 ml-0.5" aria-hidden="true">*</span>}
        </label>
        {hint  && <span className="font-body text-body-sm text-ink-secondary">{hint}</span>}
        {error && <span className="font-body text-body-sm text-red-600">{error}</span>}
      </div>
      {children}
    </div>
  )
}

function StatusToggle({ value, onChange }) {
  return (
    <div className="flex rounded-sm border border-border overflow-hidden">
      {['published', 'draft'].map((s) => (
        <button key={s} type="button" onClick={() => onChange(s)} className={['flex-1 min-h-[36px] font-mono text-label uppercase tracking-widest transition-colors duration-150', value === s ? (s === 'published' ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-white') : 'text-ink-secondary hover:bg-surface'].join(' ')}>
          {s === 'published' ? 'Publicado' : 'Borrador'}
        </button>
      ))}
    </div>
  )
}

function inputClass(error) {
  return ['w-full px-3 py-2 border rounded-sm font-body text-body text-ink-primary bg-white', 'focus:outline-none focus:ring-1 transition-colors duration-150', error ? 'border-red-400 focus:border-red-500 focus:ring-red-300' : 'border-border focus:border-primary focus:ring-primary/30'].join(' ')
}

function selectClass() {
  return 'w-full min-h-[44px] px-3 py-2 border border-border rounded-sm font-body text-body text-ink-primary bg-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors duration-150'
}
