import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useParams, useNavigate, useBlocker, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  fetchArticleById,
  createArticle,
  updateArticle,
} from '../../api/articles'
import { fetchOrganizations } from '../../api/organizations'
import { getOrganizations, isStaff } from '../../store/authStore'
import { useAuthSession } from '../../hooks/useAuthSession'
import { allowNextNavigation, setUnsavedChanges, shouldBlockNavigation } from '../../store/unsavedStore'
import { useDialogFocus } from '../../hooks/useDialogFocus'
import { DEFAULT_CATEGORY, categoryOptions, isCanonicalCategory } from '../../constants/categories'
import { useCategoryLabel } from '../../hooks/useCategoryLabel'
import ImageUploader from '../../components/ImageUploader'
import ArticleLivePreview from '../../components/admin/ArticleLivePreview'
import LoadErrorState from '../../components/admin/LoadErrorState'
import RichTextEditor from '../../components/admin/editor/RichTextEditor'
import { formatDate, todayISO } from '../../utils/dates'
import { bodyToMarkdown, markdownToPlainText, readingTimeFor } from '../../utils/articleBody'

const COLOR_SCHEMES = [
  { value: 'blue',   bg: 'bg-primary-500' },
  { value: 'amber',  bg: 'bg-accent-400'  },
  { value: 'green',  bg: 'bg-emerald-600' },
  { value: 'violet', bg: 'bg-violet-600'  },
]

// Roughly what the article cards show before line-clamp cuts the copete:
// two lines on a regular card, three on the featured one.
const EXCERPT_CARD_CHARS = 110
const EXCERPT_FEATURED_CHARS = 180

function buildEmptyForm(profile) {
  const myOrgs = getOrganizations(profile)
  return {
    title:        '',
    excerpt:      '',
    body:         '',
    category:     DEFAULT_CATEGORY,
    // '' = independent (no organization): the default for writers who
    // don't belong to one.
    organization: myOrgs[0]?.slug ?? (isStaff(profile) ? 'ceitba' : ''),
    authors:      profile?.name ? [profile.name] : [],
    date:         todayISO(),
    readingTime:  '',
    featured:     false,
    colorScheme:  'blue',
    coverImage:   '',
  }
}

// Only what the API accepts — the loaded article also carries id, status,
// timestamps, etc.
function toPayload(form, status) {
  return {
    title:        form.title.trim(),
    excerpt:      form.excerpt.trim(),
    body:         form.body.trim() ? [form.body.trim()] : [],
    category:     form.category,
    organization: form.organization || null,
    authors:      form.authors.map((a) => a.trim()).filter(Boolean),
    date:         form.date,
    readingTime:  form.readingTime,
    featured:     form.featured,
    colorScheme:  form.colorScheme,
    coverImage:   form.coverImage,
    status,
  }
}

function formatTime(date, lang) {
  return date.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })
}

export default function AdminArticleFormPage() {
  const { id: routeId } = useParams()
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()
  const categoryLabel = useCategoryLabel()
  const { profile } = useAuthSession()

  // The id of the article being edited. A new article gets one on its first
  // save (draft or publish); the URL then switches to /edit without
  // reloading the form.
  const [articleId, setArticleId] = useState(routeId ?? null)
  const loadedIdRef = useRef(null)
  // Bumped on every edit, so a save only marks the form clean when nothing
  // changed while the request was in flight.
  const editVersionRef = useRef(0)
  const redirectTimerRef = useRef(null)
  const isEdit = Boolean(articleId)

  // Edit mode: 'loading' → 'ready' | 'notFound' | 'error'. Saving is only
  // possible once the article loaded, so a failed load can't overwrite it.
  const [loadState, setLoadState] = useState(routeId ? 'loading' : 'ready')
  const [reloadKey, setReloadKey] = useState(0)

  const [form, setForm]               = useState(() => buildEmptyForm(profile))
  const [savedStatus, setSavedStatus] = useState(null) // null = never saved
  const [autoReading, setAutoReading] = useState(true)
  const [editorKey, setEditorKey]     = useState(0)    // remounts the editor with loaded content
  const [orgs, setOrgs]               = useState([])
  const [errors, setErrors]           = useState({})
  const [attempted, setAttempted]     = useState(null) // status of a failed save attempt
  const [originalOrg, setOriginalOrg] = useState(null) // organization when loaded (null = independent)
  const [saving, setSaving]           = useState(null) // status being saved
  const [dirty, setDirty]             = useState(false)
  const [lastSaved, setLastSaved]     = useState(null)
  const [doneStatus, setDoneStatus]   = useState(null) // 'published' | 'pending_review' once sent
  const [apiError, setApiError]       = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)

  useEffect(() => {
    fetchOrganizations()
      .then(({ data }) => setOrgs(data ?? []))
      .catch(() => {})
  }, [])

  // The session can arrive after the page mounted: default the byline to
  // whoever is writing, unless they already typed authors.
  useEffect(() => {
    if (routeId || !profile?.name) return
    setForm((f) => (f.authors.length ? f : { ...f, authors: [profile.name] }))
  }, [profile?.name, routeId])

  useEffect(() => {
    if (!routeId || loadedIdRef.current === routeId) return
    let cancelled = false
    setLoadState('loading')
    fetchArticleById(routeId)
      .then((existing) => {
        if (cancelled) return
        // No excerpt fallback: drafts saved before the body was written
        // store the title as copete, which must not turn into body text.
        const body = bodyToMarkdown(existing.body)
        const readingTime = existing.readingTime ?? ''
        setForm({
          ...buildEmptyForm(profile),
          title:        existing.title ?? '',
          excerpt:      existing.excerpt ?? '',
          body,
          category:     existing.category || DEFAULT_CATEGORY,
          organization: existing.organization ?? '',
          authors:      Array.isArray(existing.authors) ? existing.authors.filter(Boolean) : [],
          date:         existing.date ?? todayISO(),
          readingTime,
          featured:     Boolean(existing.featured),
          colorScheme:  existing.colorScheme ?? 'blue',
          coverImage:   existing.coverImage ?? '',
        })
        setAutoReading(!readingTime || readingTime === readingTimeFor(body))
        setSavedStatus(existing.status ?? 'published')
        setOriginalOrg(existing.organization ?? null)
        setArticleId(routeId)
        loadedIdRef.current = routeId
        setEditorKey((k) => k + 1)
        setDirty(false)
        setLoadState('ready')
      })
      .catch((err) => {
        if (!cancelled) setLoadState(err?.status === 404 ? 'notFound' : 'error')
      })
    return () => { cancelled = true }
    // profile only seeds defaults for missing fields; don't refetch on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId, reloadKey])

  // Reading time follows the body unless the editor typed their own.
  const computedReading = useMemo(() => readingTimeFor(form.body), [form.body])
  const readingTime = autoReading ? computedReading : form.readingTime

  // Any in-app navigation (links, sidebar, back/forward) with unsaved
  // changes asks first; closing or reloading the tab is beforeunload's job.
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    currentLocation.pathname !== nextLocation.pathname && shouldBlockNavigation())

  const stayHere = useCallback(() => blocker.reset?.(), [blocker])
  const closePreview = useCallback(() => setPreviewOpen(false), [])

  useEffect(() => {
    setUnsavedChanges(dirty)
    return () => setUnsavedChanges(false)
  }, [dirty])

  useEffect(() => {
    if (!dirty) return
    const warn = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  // After a failed save attempt, errors follow the form as it is edited.
  useEffect(() => {
    if (attempted) setErrors(validate(form, attempted))
    // validate only reads form/autoReading and the translations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, autoReading, attempted])

  useEffect(() => () => clearTimeout(redirectTimerRef.current), [])

  // Leaving the editor for a new article (e.g. a future "Nuevo" link while
  // editing) reuses this instance: start over instead of editing the old one.
  useEffect(() => {
    if (routeId || !articleId) return
    loadedIdRef.current = null
    setArticleId(null)
    setForm(buildEmptyForm(profile))
    setSavedStatus(null)
    setAutoReading(true)
    setErrors({})
    setAttempted(null)
    setDirty(false)
    setLastSaved(null)
    setEditorKey((k) => k + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId])

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
    editVersionRef.current += 1
    setDirty(true)
  }

  // Publishing needs the whole article; a draft only needs a title so it can
  // be found again in the list.
  function validate(values, status) {
    const e = {}
    if (!values.title.trim()) e.title = t('admin.articleForm.errors.title')
    if (status === 'published' || status === 'pending_review') {
      if (!values.excerpt.trim())                 e.excerpt  = t('admin.articleForm.errors.excerpt')
      if (!values.authors.some((a) => a.trim()))   e.authors  = t('admin.articleForm.errors.authors')
      if (!values.date)                            e.date     = t('admin.articleForm.errors.date')
      if (!markdownToPlainText(values.body))       e.body     = t('admin.articleForm.errors.body')
      if (!autoReading && !values.readingTime.trim()) e.readingTime = t('admin.articleForm.errors.readingTime')
    }
    if (!isCanonicalCategory(values.category)) e.category = t('admin.form.errors.category')
    return e
  }

  async function save(status) {
    if (loadState !== 'ready' || saving) return
    const e = validate(form, status)
    setErrors(e)
    setAttempted(status)
    if (Object.keys(e).length) {
      document.querySelector(`[data-field="${Object.keys(e)[0]}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }

    setSaving(status)
    const versionAtSave = editVersionRef.current
    setApiError('')
    try {
      const payload = toPayload({ ...form, readingTime }, status)
      // The API requires a copete and an author on every article, drafts
      // included: fill a draft's blanks from what's already written.
      if (!payload.excerpt) payload.excerpt = markdownToPlainText(form.body).slice(0, EXCERPT_CARD_CHARS) || payload.title
      if (!payload.authors.length) payload.authors = [profile?.name || payload.organization || 'CEITBA']

      const saved = isEdit ? await updateArticle(articleId, payload) : await createArticle(payload)
      setSavedStatus(saved?.status ?? status)
      if (editVersionRef.current === versionAtSave) setDirty(false)
      setAttempted(null)
      setLastSaved(new Date())
      // Show the filled-in blanks; they are what got saved.
      setForm((f) => ({
        ...f,
        excerpt: f.excerpt.trim() ? f.excerpt : payload.excerpt,
        authors: f.authors.length ? f.authors : payload.authors,
      }))
      setOriginalOrg(saved?.organization ?? (payload.organization || null))
      if (!isEdit && saved?.id) {
        loadedIdRef.current = saved.id
        setArticleId(saved.id)
        allowNextNavigation()
        navigate(`/admin/articles/${saved.id}/edit`, { replace: true })
      }
      if (status === 'published' || status === 'pending_review') {
        setDoneStatus(status)
        redirectTimerRef.current = setTimeout(() => { allowNextNavigation(); navigate('/admin/articles') }, 1200)
      }
    } catch {
      setApiError(t('admin.articleForm.saveError'))
    } finally {
      setSaving(null)
    }
  }

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

  if (doneStatus) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-3 animate-fade-in">
        <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <p className="font-display text-h5 font-bold text-ink-primary">
          {doneStatus === 'pending_review' ? t('admin.articleForm.submittedDone') : t('admin.articleForm.publishedDone')}
        </p>
        {doneStatus === 'pending_review' && (
          <p className="font-body text-body-sm text-ink-secondary max-w-sm text-center">{t('admin.articleForm.submittedHint')}</p>
        )}
      </div>
    )
  }

  const isPublished = savedStatus === 'published'
  const isPending = savedStatus === 'pending_review'
  const staff = isStaff(profile)
  const myOrgs = getOrganizations(profile)
  const allowedSlugs = new Set(myOrgs.map((m) => m.slug))
  const visibleOrgs = staff ? orgs : orgs.filter((o) => allowedSlugs.has(o.slug))
  // An org article can't be made independent (the API keeps its org), so
  // the option only exists for new and already-independent articles.
  const canBeIndependent = !isEdit || !originalOrg
  const orgLocked = isEdit && Boolean(originalOrg) && !staff && myOrgs.length === 1
  // Independent articles by non-staff go through staff review; once staff
  // publish one, its author can no longer change it.
  const moderated = !staff && !form.organization
  const lockedForAuthor = moderated && isPublished
  const previewArticle = { ...form, readingTime, id: 'preview', body: [form.body] }
  const errorCount = Object.keys(errors).length

  const primaryAction = moderated
    ? { status: 'pending_review', label: isPending ? t('admin.articleForm.updateSubmission') : t('admin.articleForm.submitForReview') }
    : isPublished
      ? { status: 'published', label: t('admin.articleForm.saveChanges') }
      : { status: 'published', label: t('admin.articleForm.publish') }
  const secondaryAction = isPublished && !moderated
    ? { status: 'draft', label: t('admin.articleForm.unpublish') }
    : { status: 'draft', label: isPending ? t('admin.articleForm.backToDraft') : t('admin.articleForm.saveDraft') }
  const statusHelp = lockedForAuthor ? t('admin.articleForm.statusHelp.lockedForAuthor')
    : moderated ? (isPending ? t('admin.articleForm.statusHelp.independentPending') : t('admin.articleForm.statusHelp.independent'))
    : isPending ? t('admin.articleForm.statusHelp.reviewByStaff')
    : isPublished ? t('admin.articleForm.statusHelp.published')
    : savedStatus ? t('admin.articleForm.statusHelp.draft')
    : t('admin.articleForm.statusHelp.new')

  return (
    <div className="flex flex-col gap-6 max-w-[80rem]">
      {/* Header: where you are, what state the article is in, and actions */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex flex-col gap-2 min-w-0">
          <Link to="/admin/articles" className="self-start font-mono text-label text-ink-secondary hover:text-primary transition-colors duration-150 underline underline-offset-2">
            {t('admin.articleForm.back')}
          </Link>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="font-display text-h4 font-bold text-ink-primary">
              {!isEdit
                ? t('admin.articleForm.newTitle')
                : isPublished ? t('admin.articleForm.editPublishedTitle')
                : isPending ? t('admin.articleForm.editPendingTitle')
                : t('admin.articleForm.editDraftTitle')}
            </h1>
            <StatusPill status={savedStatus} />
          </div>
          <p className="font-mono text-label text-ink-secondary" aria-live="polite">
            {saving
              ? t('admin.form.saving')
              : dirty
                ? t('admin.articleForm.unsaved')
                : lastSaved
                  ? t('admin.articleForm.savedAt', { time: formatTime(lastSaved, i18n.language) })
                  : isEdit ? t('admin.articleForm.upToDate') : t('admin.articleForm.notSavedYet')}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="min-h-[40px] px-3 flex items-center gap-2 rounded-sm border border-border text-ink-secondary font-body text-body-sm font-semibold hover:border-primary hover:text-primary transition-colors duration-150"
          >
            <IconEye /> {t('admin.articleForm.preview')}
          </button>
          <button
            type="button"
            onClick={() => save(secondaryAction.status)}
            disabled={Boolean(saving) || lockedForAuthor}
            className="min-h-[40px] px-4 bg-white border border-border text-ink-primary font-body text-body-sm font-semibold rounded-sm hover:border-primary hover:text-primary transition-colors duration-150 disabled:opacity-60"
          >
            {saving === secondaryAction.status ? t('admin.form.saving') : secondaryAction.label}
          </button>
          <button
            type="button"
            onClick={() => save(primaryAction.status)}
            disabled={Boolean(saving) || lockedForAuthor}
            className="min-h-[40px] px-5 bg-primary text-surface font-body text-body-sm font-semibold rounded-sm hover:bg-primary-600 transition-colors duration-150 disabled:opacity-60"
          >
            {saving === primaryAction.status ? t('admin.form.saving') : primaryAction.label}
          </button>
        </div>
      </div>

      {(apiError || errorCount > 0) && (
        <div role="alert" className="font-body text-body-sm text-red-700 bg-red-50 border border-red-200 rounded-sm px-4 py-3">
          {apiError || t('admin.articleForm.fixErrors', { count: errorCount })}
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-8 lg:items-start">
        {/* Writing column — laid out like the published article */}
        <div className="flex-1 min-w-0 flex flex-col gap-5 max-w-3xl">
          <div data-field="title">
            <AutoGrowTextarea
              value={form.title}
              onChange={(v) => set('title', v.replace(/\n/g, ' '))}
              placeholder={t('admin.articleForm.titlePlaceholder')}
              ariaLabel={t('admin.articleForm.title')}
              className="font-display text-h3 sm:text-h2 font-bold text-ink-primary leading-tight"
            />
            {errors.title && <FieldError>{errors.title}</FieldError>}
          </div>

          <div data-field="excerpt">
            <AutoGrowTextarea
              value={form.excerpt}
              onChange={(v) => set('excerpt', v.replace(/\n/g, ' '))}
              placeholder={t('admin.articleForm.excerptPlaceholder')}
              ariaLabel={t('admin.articleForm.excerpt')}
              className="font-body text-body-lg text-ink-secondary leading-relaxed"
            />
            <ExcerptMeter value={form.excerpt} featured={form.featured} />
            {errors.excerpt && <FieldError>{errors.excerpt}</FieldError>}
          </div>

          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-5 border-b border-border font-body text-body-sm text-ink-secondary">
            <span>
              {t('articles.meta.by')}{' '}
              <strong className="text-ink-primary font-semibold">
                {form.authors.filter(Boolean).join(', ') || t('admin.articleForm.noAuthors')}
              </strong>
            </span>
            <span className="text-border" aria-hidden="true">·</span>
            <span className="font-mono text-label">{formatDate(form.date, i18n.language)}</span>
            <span className="text-border" aria-hidden="true">·</span>
            <span className="font-mono text-label">{t('articles.meta.readingTime', { time: readingTime || '—' })}</span>
          </p>

          <div data-field="body">
            <RichTextEditor
              key={editorKey}
              value={form.body}
              onChange={(md) => set('body', md)}
              canUpload={isStaff(profile)}
              invalid={Boolean(errors.body)}
            />
            {errors.body && <FieldError>{errors.body}</FieldError>}
          </div>
        </div>

        {/* Settings */}
        <aside className="lg:w-80 flex-shrink-0 flex flex-col gap-4 lg:sticky lg:top-20">
          <SidebarCard title={t('admin.articleForm.publication')}>
            <p className="font-body text-body-sm text-ink-secondary leading-relaxed">
              {statusHelp}
            </p>
            <div className="mt-3" data-field="date">
              <FieldLabel>{t('admin.articleForm.date')}</FieldLabel>
              <input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} className={inputClass(errors.date)} />
              {errors.date && <FieldError>{errors.date}</FieldError>}
            </div>
          </SidebarCard>

          <SidebarCard title={t('admin.articleForm.placement')}>
            <div className="flex flex-col gap-3">
              <div data-field="category">
                <FieldLabel>{t('admin.form.category')}</FieldLabel>
                <select value={form.category} onChange={(e) => set('category', e.target.value)} className={selectClass()}>
                  {categoryOptions(form.category).map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}
                </select>
                {errors.category && <FieldError>{errors.category}</FieldError>}
              </div>
              <div>
                <FieldLabel>{t('admin.form.organization')}</FieldLabel>
                <select value={form.organization} onChange={(e) => set('organization', e.target.value)} disabled={orgLocked} className={selectClass()}>
                  {canBeIndependent && <option value="">{t('admin.articleForm.independent')}</option>}
                  {visibleOrgs.map((o) => <option key={o.slug} value={o.slug}>{o.name}</option>)}
                </select>
                {moderated && (
                  <p className="mt-1.5 font-body text-body-sm text-ink-secondary">{t('admin.articleForm.independentHint')}</p>
                )}
              </div>
              {!moderated && (<>
              <label className="flex items-center gap-3 cursor-pointer pt-1">
                <span className="relative">
                  <input type="checkbox" checked={form.featured} onChange={(e) => set('featured', e.target.checked)} className="sr-only peer" />
                  <span className="block w-10 h-5 bg-border rounded-full peer-checked:bg-primary transition-colors duration-150" />
                  <span className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-150 peer-checked:translate-x-5" />
                </span>
                <span className="font-body text-body-sm text-ink-primary">{t('admin.articleForm.featured')}</span>
              </label>
              {form.featured && (
                <p className="font-mono text-label text-ink-secondary leading-relaxed">{t('admin.articleForm.featuredHint')}</p>
              )}
              </>)}
            </div>
          </SidebarCard>

          <SidebarCard title={t('admin.articleForm.byline')}>
            <div className="flex flex-col gap-3">
              <div data-field="authors">
                <FieldLabel>{t('admin.articleForm.authors')}</FieldLabel>
                <AuthorsInput value={form.authors} onChange={(v) => set('authors', v)} invalid={Boolean(errors.authors)} />
                {errors.authors && <FieldError>{errors.authors}</FieldError>}
              </div>
              <div data-field="readingTime">
                <div className="flex items-baseline justify-between gap-2">
                  <FieldLabel>{t('admin.articleForm.readingTime')}</FieldLabel>
                  <button
                    type="button"
                    onClick={() => {
                      if (!autoReading) { setAutoReading(true); editVersionRef.current += 1; setDirty(true) }
                      else { setAutoReading(false); set('readingTime', computedReading) }
                    }}
                    className="font-mono text-label text-primary underline underline-offset-2"
                  >
                    {autoReading ? t('admin.articleForm.readingTimeEdit') : t('admin.articleForm.readingTimeAuto')}
                  </button>
                </div>
                {autoReading ? (
                  <p className="font-body text-body-sm text-ink-primary">
                    {computedReading}
                    <span className="text-ink-secondary"> · {t('admin.articleForm.readingTimeComputed')}</span>
                  </p>
                ) : (
                  <input type="text" value={form.readingTime} onChange={(e) => set('readingTime', e.target.value)} placeholder={t('admin.articleForm.readingTimePlaceholder')} className={inputClass(errors.readingTime)} />
                )}
                {errors.readingTime && <FieldError>{errors.readingTime}</FieldError>}
              </div>
            </div>
          </SidebarCard>

          <SidebarCard title={t('admin.articleForm.cover')}>
            <ImageUploader value={form.coverImage} onChange={(v) => set('coverImage', v)} />
            {!form.coverImage && (
              <div className="mt-3">
                <FieldLabel>{t('admin.articleForm.coverColor')}</FieldLabel>
                <div className="grid grid-cols-4 gap-2">
                  {COLOR_SCHEMES.map(({ value, bg }) => (
                    <button key={value} type="button" onClick={() => set('colorScheme', value)} aria-label={t(`admin.articleForm.colors.${value}`)} aria-pressed={form.colorScheme === value} className={['h-9 rounded-sm transition-all duration-150 relative', bg, form.colorScheme === value ? 'ring-2 ring-offset-2 ring-primary' : 'opacity-70 hover:opacity-100'].join(' ')}>
                      {form.colorScheme === value && (
                        <svg className="absolute inset-0 m-auto" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </SidebarCard>
        </aside>
      </div>

      {previewOpen && (
        <PreviewDialog onClose={closePreview}>
          <ArticleLivePreview article={previewArticle} orgs={orgs} />
        </PreviewDialog>
      )}

      {/* After the preview so it stacks above it (a link in the preview
          can trigger it). */}
      {blocker.state === 'blocked' && (
        <LeaveDialog
          onStay={stayHere}
          onLeave={() => { setPreviewOpen(false); blocker.proceed() }}
        />
      )}
    </div>
  )
}

function LeaveDialog({ onStay, onLeave }) {
  const { t } = useTranslation()
  const stayRef = useRef(null)
  useDialogFocus(stayRef, onStay)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onMouseDown={(e) => { if (e.target === e.currentTarget) onStay() }}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="leave-title" aria-describedby="leave-body" className="w-full max-w-sm bg-white rounded-card shadow-card-hover p-6 flex flex-col gap-3">
        <h2 id="leave-title" className="font-display text-h5 font-bold text-ink-primary">{t('admin.articleForm.leave.title')}</h2>
        <p id="leave-body" className="font-body text-body-sm text-ink-secondary leading-relaxed">{t('admin.articleForm.leave.body')}</p>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onLeave} className="min-h-[40px] px-4 rounded-sm font-body text-body-sm font-semibold text-red-600 hover:bg-red-50">
            {t('admin.articleForm.leave.discard')}
          </button>
          <button ref={stayRef} type="button" onClick={onStay} className="min-h-[40px] px-4 bg-primary text-surface rounded-sm font-body text-body-sm font-semibold hover:bg-primary-600">
            {t('admin.articleForm.leave.stay')}
          </button>
        </div>
      </div>
    </div>
  )
}

function StatusPill({ status }) {
  const { t } = useTranslation()
  const styles = {
    published:      'bg-emerald-50 text-emerald-700',
    draft:          'bg-amber-50 text-amber-700',
    pending_review: 'bg-primary-50 text-primary',
  }
  const dot = { published: 'bg-emerald-600', draft: 'bg-amber-500', pending_review: 'bg-accent' }
  return (
    <span className={['inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm font-mono text-label uppercase tracking-widest', styles[status] ?? 'bg-surface text-ink-secondary border border-border'].join(' ')}>
      <span className={['w-1.5 h-1.5 rounded-full', dot[status] ?? 'bg-border'].join(' ')} aria-hidden="true" />
      {status ? t(`admin.status.${status}`, { defaultValue: status }) : t('admin.articleForm.unsavedStatus')}
    </span>
  )
}

function ExcerptMeter({ value, featured }) {
  const { t } = useTranslation()
  const length = value.trim().length
  const limit = featured ? EXCERPT_FEATURED_CHARS : EXCERPT_CARD_CHARS
  const over = length > limit
  return (
    <p className={['mt-1 font-mono text-label', over ? 'text-amber-700' : 'text-ink-secondary'].join(' ')} aria-live="polite">
      {length}/{limit}
      {' · '}
      {over
        ? t('admin.articleForm.excerptTruncated', { shown: value.trim().slice(0, limit).trimEnd() })
        : t('admin.articleForm.excerptHint')}
    </p>
  )
}

function AuthorsInput({ value, onChange, invalid }) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState('')

  function add() {
    const name = draft.trim()
    if (!name) return
    if (!value.includes(name)) onChange([...value, name])
    setDraft('')
  }

  return (
    <div className={['flex flex-wrap items-center gap-1.5 p-1.5 border rounded-sm bg-white', invalid ? 'border-red-400' : 'border-border focus-within:border-primary'].join(' ')}>
      {value.map((name) => (
        <span key={name} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-sm bg-primary-50 text-primary font-body text-body-sm">
          {name}
          <button
            type="button"
            onClick={() => onChange(value.filter((a) => a !== name))}
            aria-label={t('admin.articleForm.removeAuthor', { name })}
            className="w-5 h-5 flex items-center justify-center rounded-sm hover:bg-primary-100"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add() }
          if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1))
        }}
        onBlur={add}
        placeholder={value.length ? t('admin.articleForm.addAuthor') : t('admin.articleForm.authorPlaceholder')}
        aria-label={t('admin.articleForm.addAuthor')}
        className="flex-1 min-w-[8rem] min-h-[30px] px-1.5 font-body text-body-sm text-ink-primary bg-transparent focus:outline-none"
      />
    </div>
  )
}

function AutoGrowTextarea({ value, onChange, placeholder, ariaLabel, className }) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className={['w-full resize-none overflow-hidden bg-transparent border-0 p-0 focus:outline-none focus:ring-0 placeholder:text-ink-secondary/50', className].join(' ')}
    />
  )
}

function PreviewDialog({ onClose, children }) {
  const { t } = useTranslation()
  const closeRef = useRef(null)
  useDialogFocus(closeRef, onClose)
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])
  return (
    <div className="fixed inset-0 z-50 flex justify-center items-start bg-black/50 p-3 sm:p-8" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-label={t('admin.articleForm.preview')} className="w-full max-w-4xl max-h-full flex flex-col bg-surface rounded-card shadow-card-hover">
        <div className="flex-shrink-0 flex items-center justify-between gap-3 px-5 py-3 border-b border-border">
          <p className="font-mono text-label uppercase tracking-widest text-ink-secondary flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-accent" aria-hidden="true" />
            {t('admin.articleForm.previewTitle')}
          </p>
          <button ref={closeRef} type="button" onClick={onClose} className="min-h-[36px] px-3 rounded-sm border border-border font-body text-body-sm text-ink-secondary hover:border-primary hover:text-primary">
            {t('admin.articleForm.closePreview')}
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-5 sm:p-8">{children}</div>
      </div>
    </div>
  )
}

function IconEye() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> }

function SidebarCard({ title, children }) {
  return (
    <section className="bg-white rounded-card border border-border shadow-card p-4">
      <h2 className="font-mono text-label uppercase tracking-widest text-ink-secondary mb-3">{title}</h2>
      {children}
    </section>
  )
}

function FieldLabel({ children }) {
  return <span className="block mb-1.5 font-body text-body-sm font-semibold text-ink-primary">{children}</span>
}

function FieldError({ children }) {
  return <span role="alert" className="mt-1.5 block font-body text-body-sm text-red-600">{children}</span>
}

function inputClass(error) {
  return ['w-full min-h-[40px] px-3 py-2 border rounded-sm font-body text-body-sm text-ink-primary bg-white', 'focus:outline-none focus:ring-1 transition-colors duration-150', error ? 'border-red-400 focus:border-red-500 focus:ring-red-300' : 'border-border focus:border-primary focus:ring-primary/30'].join(' ')
}

function selectClass() {
  return 'w-full min-h-[40px] px-3 py-2 border border-border rounded-sm font-body text-body-sm text-ink-primary bg-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors duration-150 disabled:opacity-70'
}
