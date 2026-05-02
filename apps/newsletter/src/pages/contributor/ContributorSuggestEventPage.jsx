import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { getContributorSession } from '../../store/contributorAuthStore'
import { getEventById, submitEventSuggestion, resubmitEventSuggestion } from '../../store/eventStore'
import { ORGANIZATIONS } from '../../data/organizations'

const EVENT_CATEGORIES = ['Académico', 'Campus', 'Cultura', 'Tecnología', 'Deportes']

const EMPTY_FORM = {
  title:        '',
  date:         new Date().toISOString().slice(0, 10),
  time:         '09:00',
  endTime:      '10:00',
  location:     '',
  category:     'Académico',
  organization: 'ceitba',
  description:  '',
}

export default function ContributorSuggestEventPage() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const session  = getContributorSession()
  const isEdit   = Boolean(id)

  const [form, setForm]       = useState(EMPTY_FORM)
  const [errors, setErrors]   = useState({})
  const [touched, setTouched] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [done, setDone]       = useState(false)

  useEffect(() => {
    if (isEdit && id) {
      const existing = getEventById(id)
      if (existing) setForm({ ...EMPTY_FORM, ...existing })
    }
  }, [id, isEdit])

  function set(key, value) {
    const next = { ...form, [key]: value }
    setForm(next)
    if (touched) validate(next)
  }

  function validate(values = form) {
    const e = {}
    if (!values.title.trim())    e.title    = 'El título es obligatorio.'
    if (!values.date)            e.date     = 'La fecha es obligatoria.'
    if (!values.time)            e.time     = 'La hora de inicio es obligatoria.'
    if (!values.endTime)         e.endTime  = 'La hora de fin es obligatoria.'
    if (!values.location.trim()) e.location = 'El lugar es obligatorio.'
    if (values.time >= values.endTime) e.endTime = 'La hora de fin debe ser posterior al inicio.'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setTouched(true)
    if (!validate()) return

    setSaving(true)
    await new Promise((r) => setTimeout(r, 400))

    if (isEdit) {
      resubmitEventSuggestion(id, form)
    } else {
      submitEventSuggestion(form, session)
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
          {isEdit ? 'Editar sugerencia' : 'Sugerir evento'}
        </h1>
      </div>

      <div className="rounded-card border border-amber-200 bg-amber-50 px-4 py-3">
        <p className="font-body text-body-sm text-amber-800">
          Tu sugerencia quedará pendiente de aprobación. El staff puede aceptarla, proponer cambios o rechazarla.
        </p>
      </div>

      <div className="bg-white rounded-card border border-border shadow-card p-6 flex flex-col gap-5">
        <Field label="Título" error={errors.title} required>
          <input
            type="text"
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="Nombre del evento"
            className={inputClass(errors.title)}
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Fecha" error={errors.date} required>
            <input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} className={inputClass(errors.date)} />
          </Field>
          <Field label="Inicio" error={errors.time} required>
            <input type="time" value={form.time} onChange={(e) => set('time', e.target.value)} className={inputClass(errors.time)} />
          </Field>
          <Field label="Fin" error={errors.endTime} required>
            <input type="time" value={form.endTime} onChange={(e) => set('endTime', e.target.value)} className={inputClass(errors.endTime)} />
          </Field>
        </div>

        <Field label="Lugar" error={errors.location} required>
          <input
            type="text"
            value={form.location}
            onChange={(e) => set('location', e.target.value)}
            placeholder="p. ej. Aula Magna, Laboratorio 4…"
            className={inputClass(errors.location)}
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Categoría">
            <select value={form.category} onChange={(e) => set('category', e.target.value)} className={inputClass(null)}>
              {EVENT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Organización">
            <select value={form.organization} onChange={(e) => set('organization', e.target.value)} className={inputClass(null)}>
              {ORGANIZATIONS.map((o) => <option key={o.slug} value={o.slug}>{o.name}</option>)}
            </select>
          </Field>
        </div>

        <Field label="Descripción" hint="Opcional. 1–2 oraciones para el calendario.">
          <textarea
            rows={4}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="Breve descripción del evento…"
            className={inputClass(null)}
          />
        </Field>
      </div>

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
