import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useParams, Link, useBlocker } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ApiError } from '@/api/client'
import {
  Alert, Button, ConfirmDialog, EmptyState, ErrorState, Field, SkeletonForm, Switch, buttonClass, inputClass, textareaClass,
  toast,
} from '@/components/ui'
import { fetchOrganizationBySlug, updateOrganization } from '../../api/organizations'
import { STAFF_SIGN_PATH, orgSignPath } from '../../api/media'
import { isStaff } from '@/store/authStore'
import { getOrganizations } from '@/newsletter/utils/session'
import { useAuth } from '@/hooks/useAuth'
import { setUnsavedChanges, shouldBlockNavigation } from '../../store/unsavedStore'
import AdminSectionHeader from '../../components/admin/AdminSectionHeader'
import OrgSectionLinks from '../../components/admin/OrgSectionLinks'
import ImageUploader from '../../components/ImageUploader'
import { MY_ARTICLES_PATH } from '@/newsletter/paths'
import type { Organization } from '../../types'
import { areaPath } from '@/pages/manage/areas'

// The editable profile fields, as strings for the inputs ('' = empty).
interface OrgForm {
  name: string
  fullName: string
  description: string
  category: string
  color: string
  logoUrl: string
  backgroundUrl: string
  instagram: string
  linkedinUrl: string
  websiteUrl: string
  contactEmail: string
  recruitingOpen: boolean
  recruitingUrl: string
  recruitingText: string
}

type UrlField = 'logoUrl' | 'backgroundUrl' | 'linkedinUrl' | 'websiteUrl' | 'recruitingUrl'

// Same rule as the API's OrganizationRequest/OrganizationPatchRequest:
// blank (clears it) or http(s) with no whitespace, at most 2048 chars. The
// browser's type="url" check alone lets data:, javascript: and ftp: through.
const HTTP_URL = /^(\s*|https?:\/\/\S+)$/
const URL_FIELDS: UrlField[] = ['logoUrl', 'backgroundUrl', 'linkedinUrl', 'websiteUrl', 'recruitingUrl']
const EMAIL = /^(\s*|[^@\s]+@[^@\s]+\.[^@\s]+)$/

function isAcceptedUrl(value: string | null | undefined): boolean {
  return (value ?? '').length <= 2048 && HTTP_URL.test(value ?? '')
}

// The named colour schemes ITBA News renders for an organization (the same
// set and swatches as /manage → Organizaciones).
const COLORS = ['blue', 'amber', 'green', 'violet'] as const
const COLOR_BG: Record<string, string> = {
  blue:   'bg-primary-500',
  amber:  'bg-accent-400',
  green:  'bg-emerald-600',
  violet: 'bg-violet-600',
}

function formFrom(org: Organization): OrgForm {
  return {
    name:          org.name ?? '',
    fullName:      org.fullName ?? '',
    description:   org.description ?? '',
    category:      org.category ?? '',
    color:         org.color ?? 'blue',
    logoUrl:       org.logoUrl ?? '',
    backgroundUrl: org.backgroundUrl ?? '',
    instagram:     org.instagram ?? '',
    linkedinUrl:   org.linkedinUrl ?? '',
    websiteUrl:    org.websiteUrl ?? '',
    contactEmail:  org.contactEmail ?? '',
    recruitingOpen: org.recruitingOpen ?? false,
    recruitingUrl: org.recruitingUrl ?? '',
    recruitingText: org.recruitingText ?? '',
  }
}

const sameForm = (a: OrgForm, b: OrgForm) => (Object.keys(a) as (keyof OrgForm)[]).every((k) => a[k] === b[k])

// The one organization profile editor, for the org's members and for staff
// (who reach any org from /manage → Organizaciones).
export default function OrgProfilePage() {
  // The route is /mine/org/:slug, so the param is always there.
  const { slug = '' } = useParams()
  const { t } = useTranslation()
  const { profile } = useAuth()
  const staff = isStaff(profile)
  const allowed = staff || getOrganizations(profile).some((m) => m.slug === slug)
  const signPath = staff ? STAFF_SIGN_PATH : orgSignPath(slug)

  const [base, setBase]         = useState<OrgForm | null>(null)
  const [form, setForm]         = useState<OrgForm | null>(null)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'notFound' | 'error'>('loading')
  const [reloadKey, setReloadKey] = useState(0)
  const [saving, setSaving]     = useState(false)
  const [apiError, setApiError] = useState('')
  const [urlErrors, setUrlErrors] = useState<Partial<Record<keyof OrgForm, string>>>({})

  useEffect(() => {
    if (!allowed) return
    let cancelled = false
    setLoadState('loading')
    fetchOrganizationBySlug(slug)
      .then((org) => {
        if (cancelled) return
        const loaded = formFrom(org)
        setBase(loaded)
        setForm(loaded)
        setLoadState('ready')
      })
      .catch((err: unknown) => {
        console.error('newsletter admin: organization', err)
        if (!cancelled) setLoadState(err instanceof ApiError && err.status === 404 ? 'notFound' : 'error')
      })
    return () => { cancelled = true }
  }, [slug, allowed, reloadKey])

  const dirty = Boolean(form && base && !sameForm(form, base))

  // Same guard as the article editor: in-app navigation with unsaved edits
  // asks first; closing the tab warns via beforeunload.
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    currentLocation.pathname !== nextLocation.pathname && shouldBlockNavigation())

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

  if (!allowed) {
    return (
      <EmptyState
        title={t('admin.orgProfile.noAccessTitle')}
        body={t('admin.orgProfile.noAccess')}
        action={
          <Link to={MY_ARTICLES_PATH} className={buttonClass({ variant: 'outline' })}>
            {t('admin.orgProfile.backToPanel')}
          </Link>
        }
      />
    )
  }

  if (loadState === 'loading') {
    return (
      <div className="flex flex-col gap-6 max-w-2xl">
        <AdminSectionHeader title={t('admin.orgProfile.title')} />
        <SkeletonForm fields={6} />
      </div>
    )
  }

  if (loadState !== 'ready' || !form) {
    const notFound = loadState === 'notFound'
    return (
      <ErrorState
        title={notFound ? t('admin.orgProfile.notFoundTitle') : t('admin.orgProfile.loadError')}
        message={notFound ? t('admin.orgProfile.notFound') : undefined}
        onRetry={notFound ? undefined : () => setReloadKey((k) => k + 1)}
        backTo={MY_ARTICLES_PATH}
        backLabel={t('admin.orgProfile.backToPanel')}
      />
    )
  }

  function set<K extends keyof OrgForm>(key: K, value: OrgForm[K]) {
    // Only called once the form has loaded.
    setForm((f) => ({ ...(f as OrgForm), [key]: value }))
    if (urlErrors[key] && typeof value === 'string' && (key === 'contactEmail' ? EMAIL.test(value) : isAcceptedUrl(value))) {
      setUrlErrors((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    // Rendered (and so submittable) only once the form has loaded.
    const loaded = form as OrgForm
    // Rows saved before the API validated these URLs may hold anything; the
    // API now rejects every PATCH that carries one, so flag it here with a
    // readable message instead of the raw "logoUrl: must be …" 400.
    const invalid: Partial<Record<keyof OrgForm, string>> = Object.fromEntries(
      URL_FIELDS.filter((k) => !isAcceptedUrl(loaded[k])).map((k) => [k, t('admin.form.errors.httpUrl')]),
    )
    if (!EMAIL.test(loaded.contactEmail)) invalid.contactEmail = t('admin.orgProfile.errors.email')
    setUrlErrors(invalid)
    if (Object.keys(invalid).length) return
    setSaving(true)
    setApiError('')
    try {
      const next = formFrom(await updateOrganization(slug, loaded))
      setBase(next)
      setForm(next)
      toast.success(t('admin.orgProfile.saved'))
    } catch (err) {
      console.error('newsletter admin: save organization', err)
      setApiError(
        err instanceof ApiError && err.status === 403 ? t('admin.orgProfile.errors.forbidden')
          : err instanceof ApiError && err.status === 400 && /instagram/i.test(err.message) ? t('admin.orgProfile.errors.instagram')
          : t('admin.orgProfile.errors.save'),
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <AdminSectionHeader
        title={t('admin.orgProfile.title')}
        subtitle={form.name || base?.name}
        // Staff come here from /manage → Organizaciones.
        back={staff ? { to: areaPath('organizations'), label: t('admin.orgProfile.backToManage') } : undefined}
      />
      <OrgSectionLinks slug={slug} current="profile" />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-8">
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5 max-w-2xl">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label={t('admin.orgProfile.fields.name')} hint={staff ? undefined : t('admin.orgProfile.namesStaffOnly')}>
              {(p) => <input {...p} type="text" value={form.name} onChange={(e) => set('name', e.target.value)} disabled={!staff} className={inputClass()} />}
            </Field>
            <Field label={t('admin.orgProfile.fields.fullName')} hint={staff ? undefined : t('admin.orgProfile.namesStaffOnly')}>
              {(p) => <input {...p} type="text" value={form.fullName} onChange={(e) => set('fullName', e.target.value)} disabled={!staff} className={inputClass()} />}
            </Field>
          </div>

          <Field label={t('admin.orgProfile.fields.description')}>
            {(p) => <textarea {...p} rows={4} value={form.description} onChange={(e) => set('description', e.target.value)} className={textareaClass()} />}
          </Field>

          <Field label={t('admin.orgProfile.fields.category')} hint={t('admin.orgProfile.fields.categoryHint')}>
            {(p) => <input {...p} type="text" value={form.category} onChange={(e) => set('category', e.target.value)} className={inputClass()} />}
          </Field>

          <fieldset className="flex flex-col gap-2" aria-describedby="org-profile-color-hint">
            <legend className="mb-1 font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
              {t('admin.orgProfile.fields.color')}
            </legend>
            <div className="flex flex-wrap gap-3">
              {COLORS.map((c) => (
                <label key={c} className="cursor-pointer">
                  <input
                    type="radio"
                    name="org-profile-color"
                    value={c}
                    checked={form.color === c}
                    onChange={() => set('color', c)}
                    className="peer sr-only"
                  />
                  <span
                    className={`flex items-center gap-2 min-h-[44px] pl-1.5 pr-3 py-1 rounded-sm border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-1 dark:peer-focus-visible:ring-offset-night-bg ${
                      form.color === c
                        ? 'border-primary dark:border-primary-300 text-ink-primary dark:text-night-text'
                        : 'border-border dark:border-night-border text-ink-secondary dark:text-night-muted hover:border-primary'
                    }`}
                  >
                    <span aria-hidden="true" className={`w-6 h-6 rounded-sm ${COLOR_BG[c]}`} />
                    <span className="font-body text-body-sm">{t(`admin.colors.${c}`)}</span>
                  </span>
                </label>
              ))}
            </div>
            <p id="org-profile-color-hint" className="font-body text-label text-ink-secondary dark:text-night-muted">
              {t('admin.orgProfile.fields.colorHint')}
            </p>
          </fieldset>

          <ImageField label={t('admin.orgProfile.fields.logoUrl')} hint={t('admin.orgProfile.fields.logoHint')} error={urlErrors.logoUrl}>
            <ImageUploader value={form.logoUrl} onChange={(v) => set('logoUrl', v)} signPath={signPath} previewClassName="w-24 h-24" />
          </ImageField>

          <ImageField label={t('admin.orgProfile.fields.backgroundUrl')} hint={t('admin.orgProfile.fields.backgroundHint')} error={urlErrors.backgroundUrl}>
            <ImageUploader value={form.backgroundUrl} onChange={(v) => set('backgroundUrl', v)} signPath={signPath} />
          </ImageField>

          <fieldset className="flex flex-col gap-4">
            <legend className="mb-3 font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
              {t('admin.orgProfile.contactTitle')}
            </legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label={t('admin.orgProfile.fields.instagram')} hint={t('admin.orgProfile.fields.instagramHint')}>
                {(p) => <input {...p} type="text" value={form.instagram} onChange={(e) => set('instagram', e.target.value)} placeholder="@organizacion" className={inputClass()} />}
              </Field>
              <Field label={t('admin.orgProfile.fields.contactEmail')} error={urlErrors.contactEmail}>
                {(p) => <input {...p} type="email" value={form.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} placeholder="organizacion@itba.edu.ar" className={inputClass({ invalid: !!urlErrors.contactEmail })} />}
              </Field>
              <Field label={t('admin.orgProfile.fields.linkedinUrl')} error={urlErrors.linkedinUrl}>
                {(p) => <input {...p} type="url" value={form.linkedinUrl} onChange={(e) => set('linkedinUrl', e.target.value)} placeholder="https://www.linkedin.com/company/…" className={inputClass({ invalid: !!urlErrors.linkedinUrl })} />}
              </Field>
              <Field label={t('admin.orgProfile.fields.websiteUrl')} error={urlErrors.websiteUrl}>
                {(p) => <input {...p} type="url" value={form.websiteUrl} onChange={(e) => set('websiteUrl', e.target.value)} placeholder="https://…" className={inputClass({ invalid: !!urlErrors.websiteUrl })} />}
              </Field>
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-4">
            <legend className="mb-3 font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
              {t('admin.orgProfile.recruitingTitle')}
            </legend>
            <Switch
              checked={form.recruitingOpen}
              onChange={(v) => set('recruitingOpen', v)}
              label={t('admin.orgProfile.fields.recruitingOpen')}
              hint={t('admin.orgProfile.fields.recruitingOpenHint')}
            />
            {form.recruitingOpen && (
              <>
                <Field label={t('admin.orgProfile.fields.recruitingText')} hint={t('admin.orgProfile.fields.recruitingTextHint')}>
                  {(p) => <textarea {...p} rows={2} maxLength={280} value={form.recruitingText} onChange={(e) => set('recruitingText', e.target.value)} className={textareaClass()} />}
                </Field>
                <Field label={t('admin.orgProfile.fields.recruitingUrl')} error={urlErrors.recruitingUrl}>
                  {(p) => <input {...p} type="url" value={form.recruitingUrl} onChange={(e) => set('recruitingUrl', e.target.value)} placeholder="https://forms.gle/…" className={inputClass({ invalid: !!urlErrors.recruitingUrl })} />}
                </Field>
              </>
            )}
          </fieldset>

          {apiError && <Alert tone="error">{apiError}</Alert>}

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" loading={saving} loadingLabel={t('admin.form.saving')} disabled={!dirty}>
              {t('admin.form.saveChanges')}
            </Button>
            <span className="font-body text-body-sm text-ink-secondary dark:text-night-muted" aria-live="polite">
              {dirty ? t('admin.orgProfile.unsaved') : t('admin.orgProfile.upToDate')}
            </span>
          </div>
        </form>

        <aside className="lg:sticky lg:top-24 self-start flex flex-col gap-3">
          <p className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
            {t('admin.orgProfile.preview')}
          </p>
          <div className="border border-border dark:border-night-border rounded-card overflow-hidden bg-white dark:bg-night-surface">
            <div
              className={`h-32 ${COLOR_BG[form.color] ?? COLOR_BG.blue}`}
              style={form.backgroundUrl
                ? { backgroundImage: `url(${form.backgroundUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                : undefined}
              aria-hidden="true"
            />
            <div className="p-4 flex items-start gap-3">
              {form.logoUrl
                ? <img src={form.logoUrl} alt="" className="w-12 h-12 rounded-sm object-cover bg-page-bg dark:bg-night-raised" />
                : <div className="w-12 h-12 rounded-sm bg-page-bg dark:bg-night-raised" aria-hidden="true" />}
              <div className="min-w-0">
                <p className="font-display text-body font-bold text-ink-primary dark:text-night-text truncate">
                  {form.name || base?.name}
                </p>
                {form.fullName && (
                  <p className="font-mono text-label text-ink-secondary dark:text-night-muted">{form.fullName}</p>
                )}
                {form.description && (
                  <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted mt-2 line-clamp-3">{form.description}</p>
                )}
              </div>
            </div>
          </div>
        </aside>
      </div>

      {blocker.state === 'blocked' && (
        <ConfirmDialog
          title={t('admin.orgProfile.leave.title')}
          body={t('admin.orgProfile.leave.body')}
          confirmLabel={t('admin.orgProfile.leave.discard')}
          cancelLabel={t('admin.orgProfile.leave.stay')}
          onConfirm={() => blocker.proceed()}
          onCancel={() => blocker.reset()}
        />
      )}
    </div>
  )
}

// A labelled block around an ImageUploader (it has its own inputs, so it
// can't be a <Field> child).
function ImageField({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">{label}</p>
      {hint && <p className="font-body text-label text-ink-secondary dark:text-night-muted">{hint}</p>}
      {children}
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  )
}
