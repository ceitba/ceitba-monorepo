import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import LoadErrorState from '../../components/admin/LoadErrorState'
import { fetchEventById, createEvent, updateEvent } from '../../api/events'
import { fetchOrganizations } from '../../api/organizations'
import { getOrganizations, isStaff } from '../../store/authStore'
import { DEFAULT_CATEGORY, categoryOptions, isCanonicalCategory } from '../../constants/categories'
import { useCategoryLabel } from '../../components/CategoryBadge'
import { todayISO } from '../../utils/dates'


function buildEmptyForm() {
  const myOrgs = getOrganizations()
  return {
    title:        '',
    date:         todayISO(),
    time:         '09:00',
    endTime:      '10:00',
    location:     '',
    category:     DEFAULT_CATEGORY,
    organization: myOrgs[0]?.slug ?? 'ceitba',
    description:  '',
  }
}

export default function AdminEventFormPage() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const isEdit   = Boolean(id)
  const { t } = useTranslation()
  const categoryLabel = useCategoryLabel()
  // Edit mode: 'loading' → 'ready' | 'notFound' | 'error'. Saving is only
  // possible once the event loaded, so a failed load can't overwrite it.
  const [loadState, setLoadState] = useState(isEdit ? 'loading' : 'ready')
  const [reloadKey, setReloadKey] = useState(0)

  const [form, setForm]         = useState(buildEmptyForm)
  const [orgs, setOrgs]         = useState([])
  const [errors, setErrors]     = useState({})
  const [touched, setTouched]   = useState(false)
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)
  const [apiError, setApiError] = useState('')

  useEffect(() => {
    fetchOrganizations()
      .then(({ data }) => setOrgs(data ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!isEdit) return
    let cancelled = false
    setLoadState('loading')
    fetchEventById(id)
      .then((existing) => {
        if (cancelled) return
        setForm({
          ...buildEmptyForm(),
          ...existing,
          // LocalTime may come back as HH:MM:SS; <input type="time"> wants HH:MM.
          time:        (existing.time ?? '').slice(0, 5),
          endTime:     (existing.endTime ?? '').slice(0, 5),
          location:    existing.location ?? '',
          description: existing.description ?? '',
          category: existing.category || DEFAULT_CATEGORY,
        })
        setLoadState('ready')
      })
      .catch((err) => {
        if (!cancelled) setLoadState(err?.status === 404 ? 'notFound' : 'error')
      })
    return () => { cancelled = true }
  }, [id, isEdit, reloadKey])

  function set(key, value) {
    const next = { ...form, [key]: value }
    setForm(next)
    if (touched) validate(next)
  }

  function validate(values = form) {
    const e = {}
    if (!values.title.trim())    e.title    = t('admin.eventForm.errors.title')
    if (!values.date)            e.date     = t('admin.eventForm.errors.date')
    if (!values.time)            e.time     = t('admin.eventForm.errors.time')
    if (!values.endTime)         e.endTime  = t('admin.eventForm.errors.endTime')
    if (!values.location.trim()) e.location = t('admin.eventForm.errors.location')
    if (values.time && values.endTime && values.time >= values.endTime) e.endTime = t('admin.eventForm.errors.endBeforeStart')
    if (!isCanonicalCategory(values.category)) e.category = t('admin.form.errors.category')
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (loadState !== 'ready') return
    setTouched(true)
    if (!validate()) return

    setSaving(true)
    setApiError('')
    try {
      if (isEdit) {
        await updateEvent(id, form)
      } else {
        await createEvent(form)
      }
      setSaved(true)
      setTimeout(() => navigate('/admin/events'), 800)
    } catch {
      setApiError(t('admin.eventForm.saveError'))
    } finally {
      setSaving(false)
    }
  }

  if (loadState === 'loading') {
    return (
      <div className="flex items-center justify-center py-32" aria-busy="true">
        <p className="font-mono text-label text-ink-secondary uppercase tracking-widest">{t('admin.eventForm.loading')}</p>
      </div>
    )
  }

  if (loadState === 'notFound' || loadState === 'error') {
    return (
      <LoadErrorState
        notFound={loadState === 'notFound'}
        backTo="/admin/events"
        backLabel={t('admin.eventForm.back')}
        onRetry={() => setReloadKey((k) => k + 1)}
      />
    )
  }

  if (saved) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-3 animate-fade-in">
        <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <p className="font-display text-h5 font-bold text-ink-primary">
          {isEdit ? t('admin.eventForm.updated') : t('admin.eventForm.created')}
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6 max-w-2xl">
      <div className="flex items-center gap-4">
        <Link to="/admin/events" className="font-mono text-label text-ink-secondary hover:text-primary transition-colors duration-150 underline underline-offset-2">
          {t('admin.eventForm.back')}
        </Link>
        <h1 className="font-display text-h3 font-bold text-ink-primary">
          {isEdit ? t('admin.eventForm.editTitle') : t('admin.eventForm.newTitle')}
        </h1>
      </div>

      <div className="bg-white rounded-card border border-border shadow-card p-6 flex flex-col gap-5">
        {apiError && (
          <p role="alert" className="font-body text-body-sm text-red-600 bg-red-50 px-3 py-2 rounded-sm">
            {apiError}
          </p>
        )}

        <Field label={t('admin.eventForm.title')} error={errors.title} required>
          <input type="text" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder={t('admin.eventForm.titlePlaceholder')} className={inputClass(errors.title)} />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label={t('admin.form.date')} error={errors.date} required>
            <input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} className={inputClass(errors.date)} />
          </Field>
          <Field label={t('admin.eventForm.start')} error={errors.time} required>
            <input type="time" value={form.time} onChange={(e) => set('time', e.target.value)} className={inputClass(errors.time)} />
          </Field>
          <Field label={t('admin.eventForm.end')} error={errors.endTime} required>
            <input type="time" value={form.endTime} onChange={(e) => set('endTime', e.target.value)} className={inputClass(errors.endTime)} />
          </Field>
        </div>

        <Field label={t('admin.eventForm.location')} error={errors.location} required>
          <input type="text" value={form.location} onChange={(e) => set('location', e.target.value)} placeholder={t('admin.eventForm.locationPlaceholder')} className={inputClass(errors.location)} />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={t('admin.form.category')} error={errors.category}>
            <select value={form.category} onChange={(e) => set('category', e.target.value)} className={inputClass(errors.category)}>
              {categoryOptions(form.category).map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}
            </select>
          </Field>
          <Field label={t('admin.form.organization')}>
            {(() => {
              const myOrgs = getOrganizations()
              const allowedSlugs = new Set(myOrgs.map((m) => m.slug))
              const visibleOrgs = isStaff() ? orgs : orgs.filter((o) => allowedSlugs.has(o.slug))
              const locked = !isStaff() && myOrgs.length === 1
              return (
                <select
                  value={form.organization}
                  onChange={(e) => set('organization', e.target.value)}
                  disabled={locked}
                  className={inputClass(null)}
                >
                  {visibleOrgs.map((o) => <option key={o.slug} value={o.slug}>{o.name}</option>)}
                </select>
              )
            })()}
          </Field>
        </div>

        <Field label={t('admin.eventForm.description')} hint={t('admin.eventForm.descriptionHint')}>
          <textarea rows={4} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder={t('admin.eventForm.descriptionPlaceholder')} className={inputClass(null)} />
        </Field>
      </div>

      <div className="flex gap-3">
        <button type="submit" disabled={saving || loadState !== 'ready'} className="min-h-[44px] px-6 bg-primary text-surface font-body font-semibold rounded-sm hover:bg-primary-600 transition-colors duration-150 disabled:opacity-60 focus-visible:rounded">
          {saving ? t('admin.form.saving') : isEdit ? t('admin.form.saveChanges') : t('admin.eventForm.create')}
        </button>
        <Link to="/admin/events" className="min-h-[44px] px-6 inline-flex items-center bg-white border border-border text-ink-secondary font-body font-semibold rounded-sm hover:border-primary hover:text-primary transition-colors duration-150 focus-visible:rounded">
          {t('admin.common.cancel')}
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
        {hint  && <span className="font-body text-body-sm text-ink-secondary">{hint}</span>}
        {error && <span className="font-body text-body-sm text-red-600">{error}</span>}
      </div>
      {children}
    </div>
  )
}

function inputClass(error) {
  return ['w-full min-h-[44px] px-3 py-2 border rounded-sm font-body text-body text-ink-primary bg-white', 'focus:outline-none focus:ring-1 transition-colors duration-150', error ? 'border-red-400 focus:border-red-500 focus:ring-red-300' : 'border-border focus:border-primary focus:ring-primary/30'].join(' ')
}
