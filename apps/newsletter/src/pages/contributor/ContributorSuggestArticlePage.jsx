import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { getContributorSession } from '../../store/contributorAuthStore'
import {
  getArticleById,
  submitArticleSuggestion,
  resubmitArticleSuggestion,
} from '../../store/articleStore'
import { fetchOrganizations } from '../../api/organizations'
import ImageUploader from '../../components/ImageUploader'

const CATEGORIES = ['ACADÉMICO', 'DEPORTES', 'CULTURA', 'ORGANIZACIONES']

const COLOR_OPTIONS = [
  { value: 'blue',   label: 'Azul',    cls: 'bg-primary-500' },
  { value: 'amber',  label: 'Ámbar',   cls: 'bg-accent-400'  },
  { value: 'green',  label: 'Verde',   cls: 'bg-emerald-600' },
  { value: 'violet', label: 'Violeta', cls: 'bg-violet-600'  },
]

const EMPTY_FORM = {
  title:        '',
  excerpt:      '',
  body:         [''],
  category:     'Académico',
  organization: 'ceitba',
  date:         new Date().toISOString().slice(0, 10),
  readingTime:  '',
  colorScheme:  'blue',
  coverImage:   '',
}

export default function ContributorSuggestArticlePage() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const session  = getContributorSession()
  const isEdit   = Boolean(id)

  const [form, setForm]       = useState(EMPTY_FORM)
  const [orgs, setOrgs]       = useState([])
  const [errors, setErrors]   = useState({})
  const [touched, setTouched] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [done, setDone]       = useState(false)

  useEffect(() => {
    fetchOrganizations()
      .then(({ data }) => setOrgs(data ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (isEdit && id) {
      const existing = getArticleById(id)
      if (existing) {
        setForm({
          ...EMPTY_FORM,
          ...existing,
          body: Array.isArray(existing.body) && existing.body.length > 0 ? existing.body : [''],
        })
      }
    }
  }, [id, isEdit])

  function set(key, value) {
    const next = { ...form, [key]: value }
    setForm(next)
    if (touched) validate(next)
  }

  function setBodyPara(index, value) {
    const next = form.body.map((p, i) => (i === index ? value : p))
    set('body', next)
  }

  function addPara() { set('body', [...form.body, '']) }
  function removePara(index) {
    if (form.body.length <= 1) return
    set('body', form.body.filter((_, i) => i !== index))
  }

  function validate(values = form) {
    const e = {}
    if (!values.title.trim())   e.title   = 'El título es obligatorio.'
    if (!values.excerpt.trim()) e.excerpt  = 'El copete es obligatorio.'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setTouched(true)
    if (!validate()) return

    setSaving(true)
    await new Promise((r) => setTimeout(r, 400))

    const data = {
      ...form,
      authors: [session.name],
      body: form.body.filter((p) => p.trim()),
    }

    if (isEdit) {
      resubmitArticleSuggestion(id, data)
    } else {
      submitArticleSuggestion(data, session)
    }

    setSaving(false)
    setDone(true)
    setTimeout(() => navigate('/contribute'), 1200)
  }

  if (done) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-3 animate-fade-in">
        <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <p className="font-display text-h5 font-bold text-ink-primary">
          {isEdit ? 'Sugerencia re-enviada' : 'Sugerencia enviada'}
        </p>
        <p className="font-body text-body-sm text-ink-secondary">El staff la revisará a la brevedad.</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          to="/contribute"
          className="font-mono text-label text-ink-secondary hover:text-primary transition-colors duration-150 underline underline-offset-2"
        >
          ← Mis sugerencias
        </Link>
        <h1 className="font-display text-h3 font-bold text-ink-primary">
          {isEdit ? 'Editar sugerencia' : 'Sugerir artículo'}
        </h1>
      </div>

      <div className="rounded-card border border-amber-200 bg-amber-50 px-4 py-3">
        <p className="font-body text-body-sm text-amber-800">
          Tu sugerencia quedará pendiente de aprobación. El staff puede aceptarla, proponer cambios o rechazarla. Recibirás una notificación con la decisión.
        </p>
      </div>

      {/* Main card */}
      <div className="bg-white rounded-card border border-border shadow-card p-6 flex flex-col gap-5">
        <Field label="Título" error={errors.title} required>
          <input
            type="text"
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="Titular del artículo"
            className={inputClass(errors.title)}
          />
        </Field>

        <Field label="Copete" error={errors.excerpt} required hint="1-2 oraciones. Aparece en las tarjetas.">
          <textarea
            rows={2}
            value={form.excerpt}
            onChange={(e) => set('excerpt', e.target.value)}
            placeholder="Resumen breve del artículo…"
            className={inputClass(errors.excerpt)}
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Categoría">
            <select value={form.category} onChange={(e) => set('category', e.target.value)} className={inputClass(null)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Organización">
            <select value={form.organization} onChange={(e) => set('organization', e.target.value)} className={inputClass(null)}>
              {orgs.map((o) => <option key={o.slug} value={o.slug}>{o.name}</option>)}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Fecha de publicación sugerida">
            <input
              type="date"
              value={form.date}
              onChange={(e) => set('date', e.target.value)}
              className={inputClass(null)}
            />
          </Field>
          <Field label="Tiempo de lectura estimado" hint="p. ej. 3 min">
            <input
              type="text"
              value={form.readingTime}
              onChange={(e) => set('readingTime', e.target.value)}
              placeholder="5 min"
              className={inputClass(null)}
            />
          </Field>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <label className="font-body text-body-sm font-semibold text-ink-primary">Cuerpo del artículo</label>
            <span className="font-body text-body-sm text-ink-secondary">{form.body.filter((p) => p.trim()).length} párrafos</span>
          </div>
          {form.body.map((para, i) => (
            <div key={i} className="flex gap-2 items-start">
              <textarea
                rows={3}
                value={para}
                onChange={(e) => setBodyPara(i, e.target.value)}
                placeholder={`Párrafo ${i + 1}…`}
                className={inputClass(null) + ' flex-1 resize-y'}
              />
              {form.body.length > 1 && (
                <button
                  type="button"
                  onClick={() => removePara(i)}
                  className="mt-1 w-8 h-8 flex items-center justify-center text-ink-secondary hover:text-red-500 hover:bg-red-50 rounded-sm transition-colors duration-150"
                  aria-label="Eliminar párrafo"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={addPara}
            className="self-start font-body text-body-sm text-primary hover:underline underline-offset-2 transition-colors duration-150"
          >
            + Agregar párrafo
          </button>
        </div>

        {/* Cover image */}
        <Field label="Imagen de portada" hint="Opcional">
          <ImageUploader value={form.coverImage} onChange={(v) => set('coverImage', v)} />
        </Field>

        {/* Color scheme */}
        <div className="flex flex-col gap-2">
          <label className="font-body text-body-sm font-semibold text-ink-primary">
            Color de fondo (si no hay imagen)
          </label>
          <div className="flex gap-2">
            {COLOR_OPTIONS.map(({ value, label, cls }) => (
              <button
                key={value}
                type="button"
                onClick={() => set('colorScheme', value)}
                className={[
                  'w-8 h-8 rounded-sm transition-all duration-150 focus-visible:rounded',
                  cls,
                  form.colorScheme === value
                    ? 'ring-2 ring-offset-2 ring-primary'
                    : 'hover:scale-110',
                ].join(' ')}
                aria-label={label}
                aria-pressed={form.colorScheme === value}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={saving}
          className="min-h-[44px] px-6 bg-primary text-surface font-body font-semibold rounded-sm hover:bg-primary-600 transition-colors duration-150 disabled:opacity-60 focus-visible:rounded"
        >
          {saving ? 'Enviando…' : isEdit ? 'Re-enviar sugerencia' : 'Enviar sugerencia'}
        </button>
        <Link
          to="/contribute"
          className="min-h-[44px] px-6 inline-flex items-center bg-white border border-border text-ink-secondary font-body font-semibold rounded-sm hover:border-primary hover:text-primary transition-colors duration-150 focus-visible:rounded"
        >
          Cancelar
        </Link>
      </div>
    </form>
  )
}

function Field({ label, hint, error, required, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <label className="font-body text-body-sm font-semibold text-ink-primary">
          {label}
          {required && <span className="text-red-500 ml-0.5" aria-hidden="true">*</span>}
        </label>
        {hint && <span className="font-body text-body-sm text-ink-secondary">{hint}</span>}
        {error && <span className="font-body text-body-sm text-red-600">{error}</span>}
      </div>
      {children}
    </div>
  )
}

function inputClass(error) {
  return [
    'w-full min-h-[44px] px-3 py-2 border rounded-sm font-body text-body text-ink-primary bg-white',
    'focus:outline-none focus:ring-1 transition-colors duration-150',
    error
      ? 'border-red-400 focus:border-red-500 focus:ring-red-300'
      : 'border-border focus:border-primary focus:ring-primary/30',
  ].join(' ')
}
