import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  fetchArticleById,
  createArticle,
  updateArticle,
} from '../../api/articles'
import { fetchOrganizations } from '../../api/organizations'
import { getOrganizations, isStaff } from '../../store/authStore'
import { DEFAULT_CATEGORY, categoryOptions, isCanonicalCategory } from '../../constants/categories'
import { useCategoryLabel } from '../../hooks/useCategoryLabel'
import ImageUploader from '../../components/ImageUploader'
import ArticleLivePreview from '../../components/admin/ArticleLivePreview'
import LoadErrorState from '../../components/admin/LoadErrorState'
import { todayISO } from '../../utils/dates'

const COLOR_SCHEMES = [
  { value: 'blue',   bg: 'bg-primary-500' },
  { value: 'amber',  bg: 'bg-accent-400'  },
  { value: 'green',  bg: 'bg-emerald-600' },
  { value: 'violet', bg: 'bg-violet-600'  },
]

function buildEmptyForm() {
  const myOrgs = getOrganizations()
  return {
    title:        '',
    excerpt:      '',
    body:         [''],
    category:     DEFAULT_CATEGORY,
    organization: myOrgs[0]?.slug ?? 'ceitba',
    authors:      [''],
    date:         todayISO(),
    readingTime:  '',
    featured:     false,
    colorScheme:  'blue',
    coverImage:   '',
    status:       'published',
  }
}

export default function AdminArticleFormPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = Boolean(id)
  const { t } = useTranslation()
  const categoryLabel = useCategoryLabel()
  // Edit mode: 'loading' → 'ready' | 'notFound' | 'error'. Saving is only
  // possible once the article loaded, so a failed load can't overwrite it.
  const [loadState, setLoadState] = useState(isEdit ? 'loading' : 'ready')
  const [reloadKey, setReloadKey] = useState(0)

  const [form, setForm]         = useState(buildEmptyForm)
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
    let cancelled = false
    setLoadState('loading')
    fetchArticleById(id)
      .then((existing) => {
        if (cancelled) return
        setForm({
          ...buildEmptyForm(),
          ...existing,
          title:       existing.title ?? '',
          excerpt:     existing.excerpt ?? '',
          readingTime: existing.readingTime ?? '',
          coverImage:  existing.coverImage ?? '',
          colorScheme: existing.colorScheme ?? 'blue',
          status:      existing.status ?? 'published',
          category: existing.category || DEFAULT_CATEGORY,
          body: Array.isArray(existing.body) && existing.body.length
            ? existing.body
            : [existing.excerpt ?? ''],
          authors: Array.isArray(existing.authors) && existing.authors.length
            ? existing.authors
            : [''],
        })
        setLoadState('ready')
      })
      .catch((err) => {
        if (!cancelled) setLoadState(err?.status === 404 ? 'notFound' : 'error')
      })
    return () => { cancelled = true }
  }, [id, isEdit, reloadKey])

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
    if (touched) validate({ ...form, [key]: value })
  }

  function validate(values = form) {
    const e = {}
    if (!values.title.trim())       e.title       = t('admin.articleForm.errors.title')
    if (!values.excerpt.trim())     e.excerpt     = t('admin.articleForm.errors.excerpt')
    if (!values.authors.some((a) => a.trim())) e.authors = t('admin.articleForm.errors.authors')
    if (!values.date)               e.date        = t('admin.articleForm.errors.date')
    if (!values.readingTime.trim()) e.readingTime = t('admin.articleForm.errors.readingTime')
    if (values.body.every((p) => !p.trim())) e.body = t('admin.articleForm.errors.body')
    if (!isCanonicalCategory(values.category)) e.category = t('admin.form.errors.category')
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSubmit(status) {
    if (loadState !== 'ready') return
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
      setApiError(t('admin.articleForm.saveError'))
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

  if (loadState === 'loading') {
    return (
      <div className="flex items-center justify-center py-32" aria-busy="true">
        <p className="font-mono text-label text-ink-secondary uppercase tracking-widest">{t('admin.articleForm.loading')}</p>
      </div>
    )
  }

  if (loadState === 'notFound' || loadState === 'error') {
    return (
      <LoadErrorState
        notFound={loadState === 'notFound'}
        backTo="/admin/articles"
        backLabel={t('admin.articleForm.back')}
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
          {isEdit ? t('admin.articleForm.updated') : t('admin.articleForm.created')}
        </p>
      </div>
    )
  }

  const previewArticle = { ...form, id: 'preview', body: form.body.filter((p) => p.trim()) }

  const formFields = (
    <>
      <div className="flex-1 flex flex-col gap-5">
        <FormField label={t('admin.articleForm.title')} error={errors.title} required>
          <input type="text" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder={t('admin.articleForm.titlePlaceholder')} className={inputClass(errors.title)} />
        </FormField>

        <FormField label={t('admin.articleForm.excerpt')} hint={t('admin.articleForm.excerptHint')} error={errors.excerpt} required>
          <textarea rows={3} value={form.excerpt} onChange={(e) => set('excerpt', e.target.value)} placeholder={t('admin.articleForm.excerptPlaceholder')} className={inputClass(errors.excerpt)} />
        </FormField>

        <div className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <label className="font-body text-body-sm font-semibold text-ink-primary">
              {t('admin.articleForm.body')} <span className="text-red-500" aria-hidden="true">*</span>
            </label>
            {errors.body && <span className="font-body text-body-sm text-red-600">{errors.body}</span>}
          </div>
          {form.body.map((para, i) => (
            <div key={i} className="relative group">
              <textarea rows={5} value={para} onChange={(e) => updatePara(i, e.target.value)} placeholder={t('admin.articleForm.paragraphPlaceholder', { n: i + 1 })} className={[inputClass(null), 'pr-10'].join(' ')} />
              {form.body.length > 1 && (
                <button type="button" onClick={() => removePara(i)} aria-label={t('admin.articleForm.removeParagraph', { n: i + 1 })} className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center rounded text-ink-secondary hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity duration-150">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              )}
            </div>
          ))}
          <button type="button" onClick={addPara} className="self-start min-h-[36px] px-3 flex items-center gap-2 font-body text-body-sm text-primary border border-dashed border-primary/40 hover:border-primary hover:bg-primary-50 rounded-sm transition-colors duration-150 focus-visible:rounded">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            {t('admin.articleForm.addParagraph')}
          </button>
        </div>

        <FormField label={t('admin.articleForm.coverImage')} hint={t('admin.form.optional')}>
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
          <button type="button" onClick={() => handleSubmit('published')} disabled={saving || loadState !== 'ready'} className="min-h-[44px] bg-primary text-surface font-body font-semibold rounded-sm hover:bg-primary-600 transition-colors duration-150 disabled:opacity-60 focus-visible:rounded">
            {saving ? t('admin.form.saving') : isEdit ? t('admin.form.saveChanges') : t('admin.articleForm.publish')}
          </button>
          <button type="button" onClick={() => handleSubmit('draft')} disabled={saving || loadState !== 'ready'} className="min-h-[44px] bg-white border border-border text-ink-secondary font-body font-semibold rounded-sm hover:border-primary hover:text-primary transition-colors duration-150 disabled:opacity-60 focus-visible:rounded">
            {t('admin.articleForm.saveDraft')}
          </button>
        </div>

        <SidebarCard title={t('admin.articleForm.status')}>
          <StatusToggle value={form.status} onChange={(v) => set('status', v)} />
        </SidebarCard>

        <SidebarCard title={t('admin.form.category')}>
          <select value={form.category} onChange={(e) => set('category', e.target.value)} className={selectClass()}>
            {categoryOptions(form.category).map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}
          </select>
          {errors.category && <span role="alert" className="mt-1.5 block font-body text-body-sm text-red-600">{errors.category}</span>}
        </SidebarCard>

        <SidebarCard title={t('admin.form.organization')}>
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
                className={selectClass()}
              >
                {visibleOrgs.map((o) => <option key={o.slug} value={o.slug}>{o.name}</option>)}
              </select>
            )
          })()}
        </SidebarCard>

        <SidebarCard title={t('admin.articleForm.metadata')}>
          <div className="flex flex-col gap-3">
            <FormField label={t('admin.articleForm.authors')} error={errors.authors} required small>
              <div className="flex flex-col gap-2">
                {form.authors.map((author, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <input
                      type="text"
                      value={author}
                      onChange={(e) => updateAuthor(i, e.target.value)}
                      placeholder={t('admin.articleForm.authorPlaceholder', { n: i + 1 })}
                      className={[inputClass(errors.authors), 'flex-1'].join(' ')}
                    />
                    {form.authors.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeAuthor(i)}
                        aria-label={t('admin.articleForm.removeAuthor', { n: i + 1 })}
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
                  {t('admin.articleForm.addAuthor')}
                </button>
              </div>
            </FormField>
            <FormField label={t('admin.form.date')} error={errors.date} required small>
              <input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} className={inputClass(errors.date)} />
            </FormField>
            <FormField label={t('admin.articleForm.readingTime')} error={errors.readingTime} required small>
              <input type="text" value={form.readingTime} onChange={(e) => set('readingTime', e.target.value)} placeholder={t('admin.articleForm.readingTimePlaceholder')} className={inputClass(errors.readingTime)} />
            </FormField>
          </div>
        </SidebarCard>

        <SidebarCard title={t('admin.articleForm.featured')}>
          <label className="flex items-center gap-3 cursor-pointer">
            <div className="relative">
              <input type="checkbox" checked={form.featured} onChange={(e) => set('featured', e.target.checked)} className="sr-only peer" />
              <div className="w-10 h-5 bg-border rounded-full peer-checked:bg-primary transition-colors duration-150" />
              <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-150 peer-checked:translate-x-5" />
            </div>
            <span className="font-body text-body-sm text-ink-secondary">
              {form.featured ? t('admin.articleForm.featuredOn') : t('admin.articleForm.featuredOff')}
            </span>
          </label>
          {form.featured && (
            <p className="mt-2 font-mono text-label text-ink-secondary leading-relaxed">
              {t('admin.articleForm.featuredHint')}
            </p>
          )}
        </SidebarCard>

        <SidebarCard title={t('admin.articleForm.coverColor')}>
          <div className="grid grid-cols-4 gap-2">
            {COLOR_SCHEMES.map(({ value, bg }) => (
              <button key={value} type="button" onClick={() => set('colorScheme', value)} aria-label={t(`admin.articleForm.colors.${value}`)} aria-pressed={form.colorScheme === value} className={['h-10 rounded-sm transition-all duration-150 focus-visible:rounded relative', bg, form.colorScheme === value ? 'ring-2 ring-offset-2 ring-primary' : 'opacity-70 hover:opacity-100'].join(' ')}>
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
            {t('admin.articleForm.back')}
          </Link>
          <h1 className="font-display text-h3 font-bold text-ink-primary">
            {isEdit ? t('admin.articleForm.editTitle') : t('admin.articleForm.newTitle')}
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
          <div className="w-[44%] flex-shrink-0 border-l border-border bg-surface overflow-y-auto px-6 lg:px-8 pt-6 pb-16" style={{ maxHeight: 'calc(100vh - 3.5rem)' }} aria-label={t('admin.articleForm.livePreview')}>
            <p className="font-mono text-label uppercase tracking-widest text-ink-secondary mb-6 flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-accent animate-pulse" aria-hidden="true" />
              {t('admin.articleForm.livePreview')}
            </p>
            <ArticleLivePreview article={previewArticle} orgs={orgs} />
          </div>
        </div>
      )}
    </div>
  )
}

function ViewModeToggle({ value, onChange }) {
  const { t } = useTranslation()
  const modes = [
    { key: 'edit',    label: t('admin.articleForm.viewModes.edit'),    icon: <IconEdit /> },
    { key: 'split',   label: t('admin.articleForm.viewModes.split'),   icon: <IconSplit />, desktopOnly: true },
    { key: 'preview', label: t('admin.articleForm.viewModes.preview'), icon: <IconEye /> },
  ]
  return (
    <div className="flex rounded-sm border border-border overflow-hidden" role="group" aria-label={t('admin.articleForm.viewModes.label')}>
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
  const { t } = useTranslation()
  return (
    <div className="flex rounded-sm border border-border overflow-hidden">
      {['published', 'draft'].map((s) => (
        <button key={s} type="button" onClick={() => onChange(s)} className={['flex-1 min-h-[36px] font-mono text-label uppercase tracking-widest transition-colors duration-150', value === s ? (s === 'published' ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-white') : 'text-ink-secondary hover:bg-surface'].join(' ')}>
          {t(`admin.status.${s}`)}
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
