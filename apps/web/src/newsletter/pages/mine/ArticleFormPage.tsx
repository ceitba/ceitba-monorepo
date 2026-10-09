import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useParams, useNavigate, useBlocker, useLocation, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  fetchArticleById,
  createArticle,
  updateArticle,
} from '../../api/articles'
import { isStaff } from '@/store/authStore'
import { STAFF_DEFAULT_ORG, getOrganizations } from '@/newsletter/utils/session'
import { useAuth } from '@/hooks/useAuth'
import { allowNextNavigation, setUnsavedChanges, shouldBlockNavigation } from '../../store/unsavedStore'
import { DEFAULT_CATEGORY, categoryOptions, isCanonicalCategory } from '../../constants/categories'
import { useCategoryLabel } from '../../hooks/useCategoryLabel'
import ImageUploader from '../../components/ImageUploader'
import { STAFF_SIGN_PATH, orgSignPath } from '../../api/media'
import ArticleLivePreview from '../../components/admin/ArticleLivePreview'
import ArticleStatusBadge from '../../components/admin/ArticleStatusBadge'
import AdminSectionHeader from '../../components/admin/AdminSectionHeader'
import RichTextEditor from '../../components/admin/editor/RichTextEditor'
import { useAdminContext } from '../../admin/adminContext'
import { formatDate } from '../../utils/dates'
import { bodyToMarkdown, markdownToPlainText, readingTimeFor } from '../../utils/articleBody'
import { ADMIN_PATH, MY_ARTICLES_PATH, REVIEW_PATH, articleEditPath, newsletterPath } from '@/newsletter/paths'
import { ApiError } from '@/api/client'
import {
  Alert, Button, ConfirmDialog, EmptyState, ErrorState, Field, LoadingRegion, Modal, Skeleton, SkeletonForm, Switch,
  buttonClass, iconButtonClass, inputClass, selectClass,
} from '@/components/ui'
import type { UserProfile } from '@/store/authStore'
import type { ArticleInput, ArticleStatus, IsoDate } from '../../types'
import { useQueueOptional } from '@/pages/manage/review/queueContext'

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

interface ArticleForm {
  title: string
  excerpt: string
  // Markdown (the API's body blocks joined).
  body: string
  category: string
  // '' = independent.
  organization: string
  authors: string[]
  // '' = no date yet: publishing fills in that day's.
  date: string
  readingTime: string
  featured: boolean
  colorScheme: string
  coverImage: string
}

type ArticleFormErrors = Partial<Record<keyof ArticleForm, string>>

// toPayload's result: an ArticleInput with every field set.
interface ArticlePayload extends ArticleInput {
  title: string
  excerpt: string
  body: string[]
  category: string
  organization: string | null
  authors: string[]
  date: IsoDate | null
  readingTime: string
  featured: boolean
  colorScheme: string
  coverImage: string
  status: ArticleStatus
}

function buildEmptyForm(profile: UserProfile | null): ArticleForm {
  const myOrgs = getOrganizations(profile)
  return {
    title:        '',
    excerpt:      '',
    body:         '',
    category:     DEFAULT_CATEGORY,
    // '' = independent (no organization): the default for writers who
    // don't belong to one.
    organization: myOrgs[0]?.slug ?? (isStaff(profile) ? STAFF_DEFAULT_ORG : ''),
    authors:      profile?.name ? [profile.name] : [],
    date:         '',
    readingTime:  '',
    featured:     false,
    colorScheme:  'blue',
    coverImage:   '',
  }
}

// Only what the API accepts — the loaded article also carries id, status,
// timestamps, etc. An empty date is sent as null (clearing one the writer
// emptied): the API dates an article the day it's published. Filling in
// today here would back-date a draft or submission that staff publish later.
function toPayload(form: ArticleForm, status: ArticleStatus): ArticlePayload {
  return {
    title:        form.title.trim(),
    excerpt:      form.excerpt.trim(),
    body:         form.body.trim() ? [form.body.trim()] : [],
    category:     form.category,
    organization: form.organization || null,
    authors:      form.authors.map((a) => a.trim()).filter(Boolean),
    date:         form.date || null,
    readingTime:  form.readingTime,
    featured:     form.featured,
    colorScheme:  form.colorScheme,
    coverImage:   form.coverImage,
    status,
  }
}

function formatTime(date: Date, lang: string) {
  return date.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })
}

// One editor, two entry points: Mis publicaciones (/mine/articles/new,
// /mine/articles/:id/edit) and the staff review queue
// (/manage/newsletter/review/:id).
// "Volver" leads back to wherever it was opened from.
export default function ArticleFormPage() {
  const reviewQueue = useQueueOptional()
  const { id: routeId } = useParams()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const fromReview = pathname.startsWith(`${ADMIN_PATH}/`)
  const { t, i18n } = useTranslation()
  const categoryLabel = useCategoryLabel()
  const { profile } = useAuth()
  const { orgs } = useAdminContext()

  // The id of the article being edited. A new article gets one on its first
  // save (draft or publish); the URL then switches to /edit without
  // reloading the form.
  const [articleId, setArticleId] = useState<string | null>(routeId ?? null)
  const loadedIdRef = useRef<string | null>(null)
  // Bumped on every edit, so a save only marks the form clean when nothing
  // changed while the request was in flight.
  const editVersionRef = useRef(0)
  const isEdit = Boolean(articleId)

  // Edit mode: 'loading' → 'ready' | 'notFound' | 'error'. Saving is only
  // possible once the article loaded, so a failed load can't overwrite it.
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'notFound' | 'error'>(routeId ? 'loading' : 'ready')
  const [reloadKey, setReloadKey] = useState(0)

  const [form, setForm]               = useState(() => buildEmptyForm(profile))
  const [savedStatus, setSavedStatus] = useState<ArticleStatus | null>(null) // null = never saved
  const [autoReading, setAutoReading] = useState(true)
  const [editorKey, setEditorKey]     = useState(0)    // remounts the editor with loaded content
  const [errors, setErrors]           = useState<ArticleFormErrors>({})
  const [attempted, setAttempted]     = useState<ArticleStatus | null>(null) // status of a failed save attempt
  const [originalOrg, setOriginalOrg] = useState<string | null>(null) // organization when loaded (null = independent)
  const [saving, setSaving]           = useState<ArticleStatus | null>(null) // status being saved
  const [dirty, setDirty]             = useState(false)
  const [lastSaved, setLastSaved]     = useState<Date | null>(null)
  const [doneStatus, setDoneStatus]   = useState<ArticleStatus | null>(null) // 'published' | 'pending_review' once sent
  const [apiError, setApiError]       = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)

  // The session can arrive after the page mounted: default the byline to
  // whoever is writing, unless they already typed authors.
  useEffect(() => {
    if (routeId || !profile?.name) return
    // Non-null: checked just above (the narrowing doesn't reach the updater).
    setForm((f) => (f.authors.length ? f : { ...f, authors: [profile.name!] }))
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
          date:         existing.date ?? '',
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
        if (!cancelled) setLoadState(err instanceof ApiError && err.status === 404 ? 'notFound' : 'error')
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

  // Only one dialog at a time: a link inside the preview can trigger the
  // leave confirmation, so the preview closes first.
  const blocked = blocker.state === 'blocked'
  useEffect(() => { if (blocked) setPreviewOpen(false) }, [blocked])

  useEffect(() => {
    setUnsavedChanges(dirty)
    return () => setUnsavedChanges(false)
  }, [dirty])

  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  // After a failed save attempt, errors follow the form as it is edited.
  useEffect(() => {
    if (attempted) setErrors(validate(form, attempted))
    // validate only reads form/autoReading/savedStatus and the translations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, autoReading, savedStatus, attempted])

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

  function set<K extends keyof ArticleForm>(key: K, value: ArticleForm[K]) {
    setForm((f) => ({ ...f, [key]: value }))
    editVersionRef.current += 1
    setDirty(true)
  }

  // Publishing needs the whole article; a draft only needs a title so it can
  // be found again in the list.
  function validate(values: ArticleForm, status: ArticleStatus) {
    const e: ArticleFormErrors = {}
    if (!values.title.trim()) e.title = t('admin.articleForm.errors.title')
    if (status === 'published' || status === 'pending_review') {
      if (!values.excerpt.trim())                 e.excerpt  = t('admin.articleForm.errors.excerpt')
      if (!values.authors.some((a) => a.trim()))   e.authors  = t('admin.articleForm.errors.authors')
      if (!markdownToPlainText(values.body))       e.body     = t('admin.articleForm.errors.body')
      if (!autoReading && !values.readingTime.trim()) e.readingTime = t('admin.articleForm.errors.readingTime')
    }
    // An empty date only means "the day it's published" before the first
    // publish: clearing it on a live article would silently move it to today.
    if (status === 'published' && savedStatus === 'published' && !values.date) {
      e.date = t('admin.articleForm.errors.date')
    }
    if (!isCanonicalCategory(values.category)) e.category = t('admin.form.errors.category')
    return e
  }

  async function save(status: ArticleStatus) {
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

      // Non-null: isEdit means articleId is set. Conditional on the status
      // this editor last saw: if someone moved the article since (an author
      // pulling it back, staff publishing it), the API answers 409 instead of
      // overwriting their change with this copy.
      const saved = isEdit
        ? await updateArticle(articleId!, payload, { expectedStatus: savedStatus ?? undefined })
        : await createArticle(payload)
      // Inside Administración: publishing or re-filing changes the review queue.
      reviewQueue?.reloadSource('articles')
      setSavedStatus(saved?.status ?? status)
      if (editVersionRef.current === versionAtSave) setDirty(false)
      setAttempted(null)
      setLastSaved(new Date())
      // Show the filled-in blanks; they are what got saved.
      setForm((f) => ({
        ...f,
        excerpt: f.excerpt.trim() ? f.excerpt : payload.excerpt,
        authors: f.authors.length ? f.authors : payload.authors,
        date:    f.date || (saved?.date ?? ''),
      }))
      setOriginalOrg(saved?.organization ?? (payload.organization || null))
      if (!isEdit && saved?.id) {
        loadedIdRef.current = saved.id
        setArticleId(saved.id)
        allowNextNavigation()
        navigate(articleEditPath(saved.id), { replace: true })
      }
      // A confirmation with what to do next (no auto-redirect).
      if (status === 'published' || status === 'pending_review') setDoneStatus(status)
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setApiError(t('admin.articleForm.conflict'))
      } else {
        console.error('newsletter admin: save article', err)
        setApiError(t('admin.articleForm.saveError'))
      }
    } finally {
      setSaving(null)
    }
  }

  const back = fromReview
    ? { to: REVIEW_PATH, label: t('admin.articleForm.backToReview') }
    : { to: MY_ARTICLES_PATH, label: t('admin.articleForm.back') }

  if (loadState === 'loading') {
    return (
      <div className="flex flex-col gap-6">
        <AdminSectionHeader title={t('admin.articleForm.editDraftTitle')} back={back} />
        <div className="flex flex-col lg:flex-row gap-8">
          <LoadingRegion className="flex-1 flex flex-col gap-4 max-w-3xl">
            <Skeleton className="h-12 w-3/4" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-96 w-full rounded-card" />
          </LoadingRegion>
          <SkeletonForm fields={4} className="lg:w-80" />
        </div>
      </div>
    )
  }

  if (loadState === 'notFound' || loadState === 'error') {
    const notFound = loadState === 'notFound'
    return (
      <ErrorState
        title={notFound ? t('admin.form.notFoundTitle') : t('admin.form.loadErrorTitle')}
        message={notFound ? t('admin.form.notFoundMessage') : t('admin.form.loadErrorMessage')}
        onRetry={notFound ? undefined : () => setReloadKey((k) => k + 1)}
        backTo={back.to}
        backLabel={back.label}
      />
    )
  }

  if (doneStatus) {
    const published = doneStatus === 'published'
    return (
      <EmptyState
        title={published ? t('admin.articleForm.publishedDone') : t('admin.articleForm.submittedDone')}
        body={published ? t('admin.articleForm.publishedHint') : t('admin.articleForm.submittedHint')}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {published && articleId && (
              <Link to={newsletterPath(`/articles/${articleId}`)} className={buttonClass()}>
                {t('admin.articleForm.viewArticle')}
              </Link>
            )}
            <Link to={back.to} className={buttonClass({ variant: 'outline' })}>
              {fromReview ? t('admin.articleForm.backToReviewList') : t('admin.articleForm.backToList')}
            </Link>
            <Button variant="ghost" onClick={() => setDoneStatus(null)}>
              {t('admin.articleForm.keepEditing')}
            </Button>
          </div>
        }
      />
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
  // Independent articles by non-staff go through staff review; once staff
  // publish one, its author can no longer change it (nor move it into an
  // org to get around that: the API refuses).
  const moderated = !staff && !form.organization
  const lockedForAuthor = !staff && !originalOrg && isEdit && isPublished
  const orgLocked = lockedForAuthor || (isEdit && Boolean(originalOrg) && !staff && myOrgs.length === 1)
  // The current org may not be in the list yet (orgs still loading, or the
  // request failed): keep it selectable so the select shows the truth.
  const orgMissing = form.organization && !visibleOrgs.some((o) => o.slug === form.organization)
  // Staff sign anywhere; members sign under the article's organization.
  const signPath = staff ? STAFF_SIGN_PATH
    : form.organization && allowedSlugs.has(form.organization) ? orgSignPath(form.organization)
    : null
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
    <div className="flex flex-col gap-6">
      {/* Header: where you are, what state the article is in, and actions */}
      <AdminSectionHeader
        back={back}
        title={!isEdit
          ? t('admin.articleForm.newTitle')
          : isPublished ? t('admin.articleForm.editPublishedTitle')
          : isPending ? t('admin.articleForm.editPendingTitle')
          : t('admin.articleForm.editDraftTitle')}
        badge={<ArticleStatusBadge status={savedStatus} />}
        subtitle={
          <span className="font-mono text-label" aria-live="polite">
            {saving
              ? t('admin.form.saving')
              : dirty
                ? t('admin.articleForm.unsaved')
                : lastSaved
                  ? t('admin.articleForm.savedAt', { time: formatTime(lastSaved, i18n.language) })
                  : isEdit ? t('admin.articleForm.upToDate') : t('admin.articleForm.notSavedYet')}
          </span>
        }
        action={
          <>
            <Button variant="ghost" onClick={() => setPreviewOpen(true)}>
              <IconEye /> {t('admin.articleForm.preview')}
            </Button>
            <Button
              variant="outline"
              onClick={() => save(secondaryAction.status)}
              loading={saving === secondaryAction.status}
              loadingLabel={t('admin.form.saving')}
              disabled={Boolean(saving) || lockedForAuthor}
            >
              {secondaryAction.label}
            </Button>
            <Button
              onClick={() => save(primaryAction.status)}
              loading={saving === primaryAction.status}
              loadingLabel={t('admin.form.saving')}
              disabled={Boolean(saving) || lockedForAuthor}
            >
              {primaryAction.label}
            </Button>
          </>
        }
      />

      {lockedForAuthor && <Alert tone="info">{t('admin.articleForm.statusHelp.lockedForAuthor')}</Alert>}

      {(apiError || errorCount > 0) && (
        <Alert tone="error">{apiError || t('admin.articleForm.fixErrors', { count: errorCount })}</Alert>
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
              invalid={Boolean(errors.title)}
              className="font-display text-h3 sm:text-h2 font-bold text-ink-primary dark:text-night-text leading-tight"
            />
            {errors.title && <FieldError>{errors.title}</FieldError>}
          </div>

          <div data-field="excerpt">
            <AutoGrowTextarea
              value={form.excerpt}
              onChange={(v) => set('excerpt', v.replace(/\n/g, ' '))}
              placeholder={t('admin.articleForm.excerptPlaceholder')}
              ariaLabel={t('admin.articleForm.excerpt')}
              invalid={Boolean(errors.excerpt)}
              className="font-body text-body-lg text-ink-secondary dark:text-night-muted leading-relaxed"
            />
            <ExcerptMeter value={form.excerpt} featured={form.featured} />
            {errors.excerpt && <FieldError>{errors.excerpt}</FieldError>}
          </div>

          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-5 border-b border-border dark:border-night-border font-body text-body-sm text-ink-secondary dark:text-night-muted">
            <span>
              {t('articles.meta.by')}{' '}
              <strong className="text-ink-primary dark:text-night-text font-semibold">
                {form.authors.filter(Boolean).join(', ') || t('admin.articleForm.noAuthors')}
              </strong>
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-label">{form.date ? formatDate(form.date, i18n.language) : t('admin.articleForm.dateOnPublish')}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-label">{t('articles.meta.readingTime', { time: readingTime || '—' })}</span>
          </p>

          <div data-field="body">
            <RichTextEditor
              key={editorKey}
              value={form.body}
              onChange={(md) => set('body', md)}
              signPath={signPath}
              invalid={Boolean(errors.body)}
            />
            {errors.body && <FieldError>{errors.body}</FieldError>}
          </div>
        </div>

        {/* Settings */}
        <aside className="lg:w-80 flex-shrink-0 flex flex-col gap-4 lg:sticky lg:top-24">
          <SidebarCard title={t('admin.articleForm.publication')}>
            <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted leading-relaxed mb-3">
              {statusHelp}
            </p>
            <div data-field="date">
              <Field label={t('admin.articleForm.date')} hint={t('admin.articleForm.dateHint')} error={errors.date}>
                {(p) => <input {...p} type="date" value={form.date} onChange={(e) => set('date', e.target.value)} className={inputClass({ invalid: !!errors.date })} />}
              </Field>
            </div>
          </SidebarCard>

          <SidebarCard title={t('admin.articleForm.placement')}>
            <div className="flex flex-col gap-4">
              <div data-field="category">
                <Field label={t('admin.form.category')} error={errors.category}>
                  {(p) => (
                    <select {...p} value={form.category} onChange={(e) => set('category', e.target.value)} className={selectClass({ invalid: !!errors.category })}>
                      {categoryOptions(form.category).map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}
                    </select>
                  )}
                </Field>
              </div>
              <Field
                label={t('admin.form.organization')}
                hint={moderated ? t('admin.articleForm.independentHint') : orgLocked ? t('admin.articleForm.orgLocked') : undefined}
              >
                {(p) => (
                  <select {...p} value={form.organization} onChange={(e) => set('organization', e.target.value)} disabled={orgLocked} className={selectClass()}>
                    {canBeIndependent && <option value="">{t('admin.articleForm.independent')}</option>}
                    {orgMissing && <option value={form.organization}>{form.organization}</option>}
                    {visibleOrgs.map((o) => <option key={o.slug} value={o.slug}>{o.name}</option>)}
                  </select>
                )}
              </Field>
              {!moderated && (
                <Switch
                  checked={form.featured}
                  onChange={(v) => set('featured', v)}
                  label={t('admin.articleForm.featured')}
                  hint={form.featured ? t('admin.articleForm.featuredHint') : undefined}
                />
              )}
            </div>
          </SidebarCard>

          <SidebarCard title={t('admin.articleForm.byline')}>
            <div className="flex flex-col gap-4">
              <div data-field="authors">
                <Field label={t('admin.articleForm.authors')} error={errors.authors} hint={t('admin.articleForm.authorsHint')}>
                  {(p) => <AuthorsInput inputProps={p} value={form.authors} onChange={(v) => set('authors', v)} invalid={Boolean(errors.authors)} />}
                </Field>
              </div>
              <div data-field="readingTime" className="flex flex-col gap-1.5">
                {autoReading ? (
                  <>
                    <p className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">{t('admin.articleForm.readingTime')}</p>
                    <p className="font-body text-body-sm text-ink-primary dark:text-night-text">
                      {t('admin.articleForm.readingTimeAutoValue', { time: computedReading })}
                    </p>
                  </>
                ) : (
                  <Field label={t('admin.articleForm.readingTime')} error={errors.readingTime}>
                    {(p) => (
                      <input {...p} type="text" value={form.readingTime} onChange={(e) => set('readingTime', e.target.value)} placeholder={t('admin.articleForm.readingTimePlaceholder')} className={inputClass({ invalid: !!errors.readingTime })} />
                    )}
                  </Field>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="self-start -ml-3"
                  onClick={() => {
                    if (!autoReading) { setAutoReading(true); editVersionRef.current += 1; setDirty(true) }
                    else { setAutoReading(false); set('readingTime', computedReading) }
                  }}
                >
                  {autoReading ? t('admin.articleForm.readingTimeEdit') : t('admin.articleForm.readingTimeAuto')}
                </Button>
              </div>
            </div>
          </SidebarCard>

          <SidebarCard title={t('admin.articleForm.cover')}>
            <ImageUploader value={form.coverImage} onChange={(v) => set('coverImage', v)} signPath={signPath} />
            {!form.coverImage && (
              <fieldset className="mt-4">
                <legend className="mb-1.5 font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
                  {t('admin.articleForm.coverColor')}
                </legend>
                <div className="grid grid-cols-4 gap-2">
                  {COLOR_SCHEMES.map(({ value, bg }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => set('colorScheme', value)}
                      aria-label={t(`admin.colors.${value}`)}
                      aria-pressed={form.colorScheme === value}
                      className={[
                        'h-11 rounded-sm transition-shadow duration-150 relative',
                        bg,
                        form.colorScheme === value ? 'ring-2 ring-offset-2 ring-primary dark:ring-primary-300 dark:ring-offset-night-surface' : '',
                      ].join(' ')}
                    >
                      {form.colorScheme === value && (
                        <svg className="absolute inset-0 m-auto text-white" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                      )}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}
          </SidebarCard>
        </aside>
      </div>

      {previewOpen && (
        <Modal
          title={t('admin.articleForm.previewTitle')}
          size="4xl"
          onClose={() => setPreviewOpen(false)}
          footer={<Button variant="outline" onClick={() => setPreviewOpen(false)}>{t('admin.articleForm.closePreview')}</Button>}
        >
          <ArticleLivePreview article={previewArticle} orgs={orgs} />
        </Modal>
      )}

      {blocked && (
        <ConfirmDialog
          title={t('admin.articleForm.leave.title')}
          body={t('admin.articleForm.leave.body')}
          confirmLabel={t('admin.articleForm.leave.discard')}
          cancelLabel={t('admin.articleForm.leave.stay')}
          onConfirm={() => blocker.proceed?.()}
          onCancel={() => blocker.reset?.()}
        />
      )}
    </div>
  )
}

interface ExcerptMeterProps {
  value: string
  featured: boolean
}

function ExcerptMeter({ value, featured }: ExcerptMeterProps) {
  const { t } = useTranslation()
  const length = value.trim().length
  const limit = featured ? EXCERPT_FEATURED_CHARS : EXCERPT_CARD_CHARS
  const over = length > limit
  return (
    <p className={['mt-1 font-mono text-label', over ? 'text-amber-800 dark:text-amber-300' : 'text-ink-secondary dark:text-night-muted'].join(' ')} aria-live="polite">
      {over
        ? t('admin.articleForm.excerptTruncated', { length, limit, shown: value.trim().slice(0, limit).trimEnd() })
        : t('admin.articleForm.excerptHint', { length, limit })}
    </p>
  )
}

interface AuthorsInputProps {
  inputProps: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }
  value: string[]
  onChange: (authors: string[]) => void
  invalid: boolean
}

// Author chips plus a text box: Enter or comma adds, Backspace on an empty
// box removes the last one.
function AuthorsInput({ inputProps, value, onChange, invalid }: AuthorsInputProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState('')

  function add() {
    const name = draft.trim()
    if (!name) return
    if (!value.includes(name)) onChange([...value, name])
    setDraft('')
  }

  return (
    <div className={[
      'flex flex-wrap items-center gap-1.5 p-1.5 border rounded-sm bg-white dark:bg-night-surface',
      invalid ? 'border-red-400 dark:border-red-500' : 'border-border dark:border-night-border focus-within:border-primary',
    ].join(' ')}>
      {value.map((name) => (
        <span key={name} className="inline-flex items-center gap-0.5 pl-2 rounded-sm bg-primary-50 dark:bg-primary-900 text-primary-700 dark:text-primary-200 font-body text-body-sm">
          {name}
          <button
            type="button"
            onClick={() => onChange(value.filter((a) => a !== name))}
            aria-label={t('admin.articleForm.removeAuthor', { name })}
            className={iconButtonClass({ size: 'sm', className: '!text-current hover:!bg-primary-100 dark:hover:!bg-primary-800' })}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </span>
      ))}
      <input
        {...inputProps}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add() }
          if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1))
        }}
        onBlur={add}
        placeholder={value.length ? t('admin.articleForm.addAuthor') : t('admin.articleForm.authorPlaceholder')}
        className="flex-1 min-w-[8rem] min-h-[36px] px-1.5 font-body text-body-sm text-ink-primary dark:text-night-text placeholder:text-ink-secondary dark:placeholder:text-night-muted bg-transparent focus:outline-none"
      />
    </div>
  )
}

interface AutoGrowTextareaProps {
  value: string
  onChange: (value: string) => void
  placeholder: string
  ariaLabel: string
  invalid: boolean
  className: string
}

function AutoGrowTextarea({ value, onChange, placeholder, ariaLabel, invalid, className }: AutoGrowTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null)
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
      aria-invalid={invalid || undefined}
      className={['w-full resize-none overflow-hidden bg-transparent border-0 p-0 focus:outline-none focus:ring-0 placeholder:text-ink-secondary/60 dark:placeholder:text-night-muted/70', className].join(' ')}
    />
  )
}

function IconEye() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> }

interface SidebarCardProps {
  title: string
  children: ReactNode
}

function SidebarCard({ title, children }: SidebarCardProps) {
  return (
    <section className="bg-white dark:bg-night-surface rounded-card border border-border dark:border-night-border shadow-card p-4">
      <h3 className="font-display text-h5 font-bold text-ink-primary dark:text-night-text mb-3">{title}</h3>
      {children}
    </section>
  )
}

function FieldError({ children }: { children: ReactNode }) {
  return <span className="mt-1.5 block font-body text-body-sm text-red-600 dark:text-red-400">{children}</span>
}
