import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  getArticleById,
  approveArticleSuggestion,
  rejectArticleSuggestion,
  requestArticleChanges,
} from '../../store/articleStore'
import {
  getEventById,
  approveEventSuggestion,
  rejectEventSuggestion,
  requestEventChanges,
} from '../../store/eventStore'
import { fetchOrganizations } from '../../api/organizations'

const ARTICLE_CATEGORIES = ['ACADÉMICO', 'DEPORTES', 'CULTURA', 'ORGANIZACIONES']
const EVENT_CATEGORIES   = ['ACADÉMICO', 'DEPORTES', 'CULTURA', 'ORGANIZACIONES']

const STATUS_META = {
  pending_review:    { label: 'Pendiente',        cls: 'bg-amber-50 text-amber-700' },
  changes_requested: { label: 'Esperando alumno', cls: 'bg-blue-50 text-blue-700'  },
  rejected:          { label: 'Rechazado',         cls: 'bg-red-50 text-red-600'    },
  published:         { label: 'Publicado',          cls: 'bg-emerald-50 text-emerald-700' },
}

export default function AdminSuggestionReviewPage() {
  const { type, id } = useParams()
  const navigate     = useNavigate()
  const isArticle    = type === 'article'

  const [resource, setResource] = useState(() =>
    isArticle ? getArticleById(id) : getEventById(id),
  )
  const [form, setForm]       = useState({})
  const [orgs, setOrgs]       = useState([])
  const [saved, setSaved]     = useState(null) // null | 'approved' | 'changes_requested' | 'rejected'
  const [saving, setSaving]   = useState(false)
  const [confirmReject, setConfirmReject] = useState(false)

  useEffect(() => {
    fetchOrganizations()
      .then(({ data }) => setOrgs(data ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (resource) {
      setForm(isArticle
        ? {
            title:        resource.title        ?? '',
            excerpt:      resource.excerpt       ?? '',
            body:         Array.isArray(resource.body) ? resource.body : [''],
            category:     resource.category     ?? 'Académico',
            organization: resource.organization ?? 'ceitba',
            readingTime:  resource.readingTime  ?? '',
            date:         resource.date         ?? new Date().toISOString().slice(0, 10),
          }
        : {
            title:        resource.title        ?? '',
            date:         resource.date         ?? new Date().toISOString().slice(0, 10),
            time:         resource.time         ?? '09:00',
            endTime:      resource.endTime      ?? '10:00',
            location:     resource.location     ?? '',
            category:     resource.category     ?? 'Académico',
            organization: resource.organization ?? 'ceitba',
            description:  resource.description  ?? '',
          },
      )
    }
  }, [resource, isArticle])

  if (!resource) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-3">
        <p className="font-display text-h5 font-bold text-ink-primary">Sugerencia no encontrada</p>
        <Link to="/admin/suggestions" className="text-primary hover:underline font-body text-body-sm">
          ← Volver a sugerencias
        </Link>
      </div>
    )
  }

  const s = STATUS_META[resource.status] ?? { label: resource.status, cls: 'bg-surface text-ink-secondary' }
  const isReadOnly = resource.status !== 'pending_review'

  async function handleApprove() {
    setSaving(true)
    await new Promise((r) => setTimeout(r, 400))
    if (isArticle) approveArticleSuggestion(id)
    else approveEventSuggestion(id)
    setSaved('approved')
    setTimeout(() => navigate('/admin/suggestions'), 1200)
  }

  async function handleRequestChanges() {
    setSaving(true)
    await new Promise((r) => setTimeout(r, 400))
    const edits = isArticle
      ? {
          title:        form.title,
          excerpt:      form.excerpt,
          body:         form.body.filter((p) => p.trim()),
          category:     form.category,
          organization: form.organization,
          readingTime:  form.readingTime,
          date:         form.date,
        }
      : {
          title:        form.title,
          date:         form.date,
          time:         form.time,
          endTime:      form.endTime,
          location:     form.location,
          category:     form.category,
          organization: form.organization,
          description:  form.description,
        }
    if (isArticle) requestArticleChanges(id, edits)
    else requestEventChanges(id, edits)
    setSaved('changes_requested')
    setTimeout(() => navigate('/admin/suggestions'), 1200)
  }

  async function handleReject() {
    setSaving(true)
    await new Promise((r) => setTimeout(r, 400))
    if (isArticle) rejectArticleSuggestion(id)
    else rejectEventSuggestion(id)
    setSaved('rejected')
    setTimeout(() => navigate('/admin/suggestions'), 1200)
  }

  function set(key, val) {
    setForm((prev) => ({ ...prev, [key]: val }))
  }

  function setBodyPara(index, value) {
    const next = form.body.map((p, i) => (i === index ? value : p))
    set('body', next)
  }

  if (saved) {
    const msg = {
      approved:          '¡Sugerencia aprobada y publicada!',
      changes_requested: 'Cambios enviados al alumno.',
      rejected:          'Sugerencia rechazada.',
    }
    const icon = {
      approved: { stroke: '#059669', bg: 'bg-emerald-50', path: <polyline points="20 6 9 17 4 12"/> },
      changes_requested: { stroke: '#d97706', bg: 'bg-amber-50', path: <circle cx="12" cy="12" r="10"/> },
      rejected: { stroke: '#dc2626', bg: 'bg-red-50', path: <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></> },
    }[saved]
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-3 animate-fade-in">
        <div className={['w-12 h-12 rounded-full flex items-center justify-center', icon.bg].join(' ')}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={icon.stroke} strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
            {icon.path}
          </svg>
        </div>
        <p className="font-display text-h5 font-bold text-ink-primary">{msg[saved]}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          to="/admin/suggestions"
          className="font-mono text-label text-ink-secondary hover:text-primary transition-colors duration-150 underline underline-offset-2"
        >
          ← Sugerencias
        </Link>
        <h1 className="font-display text-h3 font-bold text-ink-primary">
          Revisar {isArticle ? 'artículo' : 'evento'}
        </h1>
      </div>

      {/* Contributor info + status */}
      <div className="bg-white rounded-card border border-border shadow-card p-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div className="flex flex-col gap-0.5">
          <p className="font-body text-body-sm text-ink-secondary">Propuesto por</p>
          <p className="font-body text-body-sm font-semibold text-ink-primary">
            {resource.suggestedBy?.name}
            <span className="font-normal text-ink-secondary ml-1">({resource.suggestedBy?.email})</span>
          </p>
        </div>
        <span className={['font-mono text-label uppercase tracking-widest px-3 py-1 rounded-sm', s.cls].join(' ')}>
          {s.label}
        </span>
      </div>

      {isReadOnly && (
        <div className="rounded-card border border-border bg-surface px-4 py-3">
          <p className="font-body text-body-sm text-ink-secondary">
            {resource.status === 'changes_requested'
              ? 'Ya enviaste cambios. Esperá que el alumno los acepte o rechace.'
              : 'Esta sugerencia fue rechazada.'}
          </p>
        </div>
      )}

      {/* Form fields */}
      <div className="bg-white rounded-card border border-border shadow-card p-6 flex flex-col gap-5">
        {isArticle ? (
          <ArticleFields form={form} set={set} setBodyPara={setBodyPara} readOnly={isReadOnly} />
        ) : (
          <EventFields form={form} set={set} readOnly={isReadOnly} />
        )}
      </div>

      {/* Actions — only when pending_review */}
      {resource.status === 'pending_review' && (
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            type="button"
            onClick={handleApprove}
            disabled={saving}
            className="min-h-[44px] px-5 bg-emerald-600 text-white font-body font-semibold rounded-sm hover:bg-emerald-700 transition-colors duration-150 disabled:opacity-60 focus-visible:rounded"
          >
            {saving ? 'Guardando…' : 'Aprobar tal como está'}
          </button>

          <button
            type="button"
            onClick={handleRequestChanges}
            disabled={saving}
            className="min-h-[44px] px-5 bg-primary text-surface font-body font-semibold rounded-sm hover:bg-primary-600 transition-colors duration-150 disabled:opacity-60 focus-visible:rounded"
          >
            {saving ? 'Guardando…' : 'Enviar con cambios al alumno'}
          </button>

          {confirmReject ? (
            <span className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleReject}
                disabled={saving}
                className="min-h-[44px] px-4 font-body text-body-sm font-semibold text-red-600 hover:bg-red-50 border border-red-300 rounded-sm transition-colors duration-150 disabled:opacity-60"
              >
                Confirmar rechazo
              </button>
              <button
                type="button"
                onClick={() => setConfirmReject(false)}
                className="min-h-[44px] px-3 font-body text-body-sm text-ink-secondary hover:bg-surface rounded-sm transition-colors duration-150"
              >
                Cancelar
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmReject(true)}
              className="min-h-[44px] px-5 bg-white border border-border text-ink-secondary font-body font-semibold rounded-sm hover:border-red-300 hover:text-red-600 transition-colors duration-150 focus-visible:rounded"
            >
              Rechazar
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Article fields ─────────────────────────────────────────────────────────────

function ArticleFields({ form, set, setBodyPara, readOnly }) {
  return (
    <>
      <Field label="Título">
        <input type="text" value={form.title ?? ''} readOnly={readOnly}
          onChange={(e) => set('title', e.target.value)}
          className={inputClass(null, readOnly)} />
      </Field>
      <Field label="Copete">
        <textarea rows={2} value={form.excerpt ?? ''} readOnly={readOnly}
          onChange={(e) => set('excerpt', e.target.value)}
          className={inputClass(null, readOnly)} />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Categoría">
          {readOnly
            ? <p className={inputClass(null, true)}>{form.category}</p>
            : (
              <select value={form.category ?? ''} onChange={(e) => set('category', e.target.value)} className={inputClass(null)}>
                {ARTICLE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
        </Field>
        <Field label="Organización">
          {readOnly
            ? <p className={inputClass(null, true)}>{form.organization}</p>
            : (
              <select value={form.organization ?? ''} onChange={(e) => set('organization', e.target.value)} className={inputClass(null)}>
                {orgs.map((o) => <option key={o.slug} value={o.slug}>{o.name}</option>)}
              </select>
            )}
        </Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Fecha">
          <input type="date" value={form.date ?? ''} readOnly={readOnly}
            onChange={(e) => set('date', e.target.value)}
            className={inputClass(null, readOnly)} />
        </Field>
        <Field label="Tiempo de lectura">
          <input type="text" value={form.readingTime ?? ''} readOnly={readOnly}
            onChange={(e) => set('readingTime', e.target.value)}
            placeholder="5 min" className={inputClass(null, readOnly)} />
        </Field>
      </div>
      {/* Body paragraphs */}
      <div className="flex flex-col gap-2">
        <label className="font-body text-body-sm font-semibold text-ink-primary">Cuerpo</label>
        {(form.body ?? ['']).map((para, i) => (
          <div key={i} className="flex gap-2 items-start">
            <textarea
              rows={3}
              value={para}
              readOnly={readOnly}
              onChange={(e) => setBodyPara(i, e.target.value)}
              placeholder={`Párrafo ${i + 1}…`}
              className={inputClass(null, readOnly) + ' flex-1 resize-y'}
            />
            {!readOnly && (form.body ?? []).length > 1 && (
              <button type="button"
                onClick={() => set('body', form.body.filter((_, j) => j !== i))}
                className="mt-1 w-8 h-8 flex items-center justify-center text-ink-secondary hover:text-red-500 hover:bg-red-50 rounded-sm transition-colors duration-150"
                aria-label="Eliminar párrafo">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            )}
          </div>
        ))}
        {!readOnly && (
          <button type="button"
            onClick={() => set('body', [...(form.body ?? []), ''])}
            className="self-start font-body text-body-sm text-primary hover:underline underline-offset-2">
            + Agregar párrafo
          </button>
        )}
      </div>
    </>
  )
}

// ── Event fields ───────────────────────────────────────────────────────────────

function EventFields({ form, set, readOnly }) {
  return (
    <>
      <Field label="Título">
        <input type="text" value={form.title ?? ''} readOnly={readOnly}
          onChange={(e) => set('title', e.target.value)}
          className={inputClass(null, readOnly)} />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Field label="Fecha">
          <input type="date" value={form.date ?? ''} readOnly={readOnly}
            onChange={(e) => set('date', e.target.value)}
            className={inputClass(null, readOnly)} />
        </Field>
        <Field label="Inicio">
          <input type="time" value={form.time ?? ''} readOnly={readOnly}
            onChange={(e) => set('time', e.target.value)}
            className={inputClass(null, readOnly)} />
        </Field>
        <Field label="Fin">
          <input type="time" value={form.endTime ?? ''} readOnly={readOnly}
            onChange={(e) => set('endTime', e.target.value)}
            className={inputClass(null, readOnly)} />
        </Field>
      </div>
      <Field label="Lugar">
        <input type="text" value={form.location ?? ''} readOnly={readOnly}
          onChange={(e) => set('location', e.target.value)}
          placeholder="p. ej. Aula Magna"
          className={inputClass(null, readOnly)} />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Categoría">
          {readOnly
            ? <p className={inputClass(null, true)}>{form.category}</p>
            : (
              <select value={form.category ?? ''} onChange={(e) => set('category', e.target.value)} className={inputClass(null)}>
                {EVENT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
        </Field>
        <Field label="Organización">
          {readOnly
            ? <p className={inputClass(null, true)}>{form.organization}</p>
            : (
              <select value={form.organization ?? ''} onChange={(e) => set('organization', e.target.value)} className={inputClass(null)}>
                {orgs.map((o) => <option key={o.slug} value={o.slug}>{o.name}</option>)}
              </select>
            )}
        </Field>
      </div>
      <Field label="Descripción">
        <textarea rows={4} value={form.description ?? ''} readOnly={readOnly}
          onChange={(e) => set('description', e.target.value)}
          className={inputClass(null, readOnly)} />
      </Field>
    </>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function Field({ label, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="font-body text-body-sm font-semibold text-ink-primary">{label}</label>
      {children}
    </div>
  )
}

function inputClass(error, readOnly = false) {
  return [
    'w-full min-h-[44px] px-3 py-2 border rounded-sm font-body text-body text-ink-primary',
    readOnly ? 'bg-surface text-ink-secondary cursor-default' : 'bg-white',
    'focus:outline-none focus:ring-1 transition-colors duration-150',
    error
      ? 'border-red-400 focus:border-red-500 focus:ring-red-300'
      : 'border-border focus:border-primary focus:ring-primary/30',
  ].join(' ')
}
