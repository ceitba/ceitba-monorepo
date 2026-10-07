import { useEffect, useState, type FormEvent } from 'react'
import { useParams, Link, useBlocker } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ApiError } from '@/api/client'
import {
  Alert, Button, ConfirmDialog, EmptyState, ErrorState, Field, SkeletonForm, buttonClass, inputClass, textareaClass, toast,
} from '@/components/ui'
import { fetchOrganizationBySlug, updateOrganization } from '../../api/organizations'
import { canViewFollowers, getOrganizations, isStaff } from '../../store/authStore'
import { useAuthSession } from '../../hooks/useAuthSession'
import { setUnsavedChanges, shouldBlockNavigation } from '../../store/unsavedStore'
import AdminSectionHeader from '../../components/admin/AdminSectionHeader'
import { MY_ARTICLES_PATH, newsletterPath } from '@/newsletter/paths'
import type { Organization } from '../../types'

// The editable profile fields, as strings for the inputs ('' = empty).
interface OrgForm {
  name: string
  fullName: string
  description: string
  category: string
  color: string
  logoUrl: string
  backgroundUrl: string
}

type UrlField = 'logoUrl' | 'backgroundUrl'

// Same rule as the API's OrganizationRequest/OrganizationPatchRequest:
// blank (clears it) or http(s) with no whitespace, at most 2048 chars. The
// browser's type="url" check alone lets data:, javascript: and ftp: through.
const HTTP_URL = /^(\s*|https?:\/\/\S+)$/
const URL_FIELDS: UrlField[] = ['logoUrl', 'backgroundUrl']

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
  }
}

const sameForm = (a: OrgForm, b: OrgForm) => (Object.keys(a) as (keyof OrgForm)[]).every((k) => a[k] === b[k])

// The one organization profile editor, for the org's members and for staff
// (who reach any org from /manage → Organizaciones).
export default function OrgProfilePage() {
  // The route is /mine/org/:slug, so the param is always there.
  const { slug = '' } = useParams()
  const { t } = useTranslation()
  const { profile } = useAuthSession()
  const staff = isStaff(profile)
  const allowed = staff || getOrganizations(profile).some((m) => m.slug === slug)
  // Plain members can edit the profile but not see followers (admins/staff only).
  const showFollowers = canViewFollowers(slug, profile)

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

  function set(key: keyof OrgForm, value: string) {
    // Only called once the form has loaded.
    setForm((f) => ({ ...(f as OrgForm), [key]: value }))
    if (urlErrors[key] && isAcceptedUrl(value)) {
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
    const invalid = Object.fromEntries(
      URL_FIELDS.filter((k) => !isAcceptedUrl(loaded[k])).map((k) => [k, t('admin.form.errors.httpUrl')]),
    )
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
      setApiError(err instanceof ApiError && err.status === 403 ? t('admin.orgProfile.errors.forbidden') : t('admin.orgProfile.errors.save'))
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
        back={staff ? { to: '/manage', label: t('admin.orgProfile.backToManage') } : undefined}
        action={showFollowers ? (
          <Link to={newsletterPath(`/mine/org/${slug}/followers`)} className={buttonClass({ variant: 'outline' })}>
            {t('admin.followers.link')}
          </Link>
        ) : undefined}
      />

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

          <Field label={t('admin.orgProfile.fields.logoUrl')} error={urlErrors.logoUrl}>
            {(p) => <input {...p} type="url" value={form.logoUrl} onChange={(e) => set('logoUrl', e.target.value)} placeholder="https://…" className={inputClass({ invalid: !!urlErrors.logoUrl })} />}
          </Field>

          <Field label={t('admin.orgProfile.fields.backgroundUrl')} error={urlErrors.backgroundUrl}>
            {(p) => <input {...p} type="url" value={form.backgroundUrl} onChange={(e) => set('backgroundUrl', e.target.value)} placeholder="https://…" className={inputClass({ invalid: !!urlErrors.backgroundUrl })} />}
          </Field>

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
