import { useState, useEffect, type FormEvent } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { fetchEventById, createEvent, deleteEvent, updateEvent } from '../../api/events'
import { STAFF_SIGN_PATH, orgSignPath } from '../../api/media'
import ImageUploader from '../../components/ImageUploader'
import type { SignupMode } from '../../types'
import { isStaff } from '@/store/authStore'
import { getOrganizations } from '@/newsletter/utils/session'
import { useAuth } from '@/hooks/useAuth'
import { DEFAULT_CATEGORY, categoryOptions, isCanonicalCategory } from '../../constants/categories'
import { useCategoryLabel } from '../../hooks/useCategoryLabel'
import AdminSectionHeader from '../../components/admin/AdminSectionHeader'
import { useAdminContext } from '../../admin/adminContext'
import { todayISO } from '../../utils/dates'
import { newsletterPath } from '@/newsletter/paths'
import { ApiError } from '@/api/client'
import {
  Alert, Button, ConfirmDialog, ErrorState, Field, SkeletonForm, ToggleGroup, buttonClass, inputClass, selectClass,
  textareaClass, toast,
} from '@/components/ui'

interface EventForm {
  title: string
  date: string
  time: string
  endTime: string
  location: string
  category: string
  // null when an independent event is loaded for editing.
  organization: string | null
  description: string
  coverImage: string
  onlineUrl: string
  signupMode: SignupMode
  signupUrl: string
  // Digits as typed; '' = no limit.
  capacity: string
}

const HTTP_URL = /^https?:\/\/\S+$/

type EventFormErrors = Partial<Record<keyof EventForm, string>>

function buildEmptyForm(): EventForm {
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
    coverImage:   '',
    onlineUrl:    '',
    signupMode:   'none',
    signupUrl:    '',
    capacity:     '',
  }
}

export default function EventFormPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const isEdit   = Boolean(id)
  const { t } = useTranslation()
  const categoryLabel = useCategoryLabel()
  const { profile } = useAuth()
  const { orgs } = useAdminContext()
  // Edit mode: 'loading' → 'ready' | 'notFound' | 'error'. Saving is only
  // possible once the event loaded, so a failed load can't overwrite it.
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'notFound' | 'error'>(isEdit ? 'loading' : 'ready')
  const [reloadKey, setReloadKey] = useState(0)

  const [form, setForm]         = useState(buildEmptyForm)
  const [errors, setErrors]     = useState<EventFormErrors>({})
  const [touched, setTouched]   = useState(false)
  const [saving, setSaving]     = useState(false)
  const [apiError, setApiError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

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
          coverImage:  existing.coverImage ?? '',
          onlineUrl:   existing.onlineUrl ?? '',
          signupMode:  existing.signupMode ?? 'none',
          signupUrl:   existing.signupUrl ?? '',
          capacity:    existing.capacity != null ? String(existing.capacity) : '',
        })
        setLoadState('ready')
      })
      .catch((err) => {
        if (!cancelled) setLoadState(err instanceof ApiError && err.status === 404 ? 'notFound' : 'error')
      })
    return () => { cancelled = true }
  }, [id, isEdit, reloadKey])

  function set<K extends keyof EventForm>(key: K, value: EventForm[K]) {
    const next = { ...form, [key]: value }
    setForm(next)
    if (touched) validate(next)
  }

  function validate(values: EventForm = form) {
    const e: EventFormErrors = {}
    if (!values.title.trim())    e.title    = t('admin.eventForm.errors.title')
    if (!values.date)            e.date     = t('admin.eventForm.errors.date')
    if (!values.time)            e.time     = t('admin.eventForm.errors.time')
    if (!values.endTime)         e.endTime  = t('admin.eventForm.errors.endTime')
    if (!values.location.trim()) e.location = t('admin.eventForm.errors.location')
    if (values.time && values.endTime && values.time >= values.endTime) e.endTime = t('admin.eventForm.errors.endBeforeStart')
    if (!isCanonicalCategory(values.category)) e.category = t('admin.form.errors.category')
    if (values.onlineUrl.trim() && !HTTP_URL.test(values.onlineUrl.trim())) e.onlineUrl = t('admin.form.errors.httpUrl')
    if (values.signupMode === 'external' && !HTTP_URL.test(values.signupUrl.trim())) e.signupUrl = t('admin.eventForm.errors.signupUrl')
    if (values.signupMode === 'rsvp' && values.capacity.trim() && !/^[1-9]\d{0,4}$/.test(values.capacity.trim())) {
      e.capacity = t('admin.eventForm.errors.capacity')
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (loadState !== 'ready') return
    setTouched(true)
    if (!validate()) return

    setSaving(true)
    setApiError('')
    try {
      const payload = {
        title: form.title, date: form.date, time: form.time, endTime: form.endTime, location: form.location,
        category: form.category, organization: form.organization, description: form.description,
        coverImage: form.coverImage, onlineUrl: form.onlineUrl.trim(), signupMode: form.signupMode,
        signupUrl: form.signupMode === 'external' ? form.signupUrl.trim() : null,
        capacity: form.signupMode === 'rsvp' && form.capacity.trim() ? Number(form.capacity.trim()) : null,
      }
      if (isEdit) {
        await updateEvent(id, payload)
      } else {
        await createEvent(payload)
      }
      toast.success(isEdit ? t('admin.eventForm.updated') : t('admin.eventForm.created'))
      navigate(newsletterPath('/mine/events'))
    } catch (err) {
      console.error('newsletter admin: save event', err)
      setApiError(t('admin.eventForm.saveError'))
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    setDeleteError('')
    try {
      await deleteEvent(id)
      toast.success(t('admin.eventForm.deleted'))
      navigate(newsletterPath('/mine/events'))
    } catch (err) {
      console.error('newsletter admin: delete event', err)
      setDeleteError(t('admin.events.deleteError'))
      setDeleting(false)
    }
  }

  const back = { to: newsletterPath('/mine/events'), label: t('admin.eventForm.back') }
  const title = isEdit ? t('admin.eventForm.editTitle') : t('admin.eventForm.newTitle')

  if (loadState === 'loading') {
    return (
      <div className="flex flex-col gap-6 max-w-2xl">
        <AdminSectionHeader title={title} back={back} />
        <SkeletonForm fields={6} />
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

  const staff = isStaff(profile)
  const myOrgs = getOrganizations(profile)
  const allowedSlugs = new Set(myOrgs.map((m) => m.slug))
  const visibleOrgs = staff ? orgs : orgs.filter((o) => allowedSlugs.has(o.slug))
  const orgLocked = !staff && myOrgs.length === 1
  // The current org may not be in the list yet (still loading or the
  // request failed): keep it selectable so the select shows the truth.
  const orgMissing = form.organization && !visibleOrgs.some((o) => o.slug === form.organization)
  // Staff sign anywhere; members sign under the event's organization.
  const signPath = staff ? STAFF_SIGN_PATH
    : form.organization && allowedSlugs.has(form.organization) ? orgSignPath(form.organization)
    : null

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6 max-w-2xl">
      <AdminSectionHeader title={title} back={back} />

      <div className="bg-white dark:bg-night-surface rounded-card border border-border dark:border-night-border shadow-card p-4 sm:p-6 flex flex-col gap-5">
        {apiError && <Alert tone="error">{apiError}</Alert>}

        <Field label={t('admin.eventForm.title')} error={errors.title} required>
          {(p) => (
            <input {...p} type="text" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder={t('admin.eventForm.titlePlaceholder')} className={inputClass({ invalid: !!errors.title })} />
          )}
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label={t('admin.form.date')} error={errors.date} required>
            {(p) => <input {...p} type="date" value={form.date} onChange={(e) => set('date', e.target.value)} className={inputClass({ invalid: !!errors.date })} />}
          </Field>
          <Field label={t('admin.eventForm.start')} error={errors.time} required>
            {(p) => <input {...p} type="time" value={form.time} onChange={(e) => set('time', e.target.value)} className={inputClass({ invalid: !!errors.time })} />}
          </Field>
          <Field label={t('admin.eventForm.end')} error={errors.endTime} required>
            {(p) => <input {...p} type="time" value={form.endTime} onChange={(e) => set('endTime', e.target.value)} className={inputClass({ invalid: !!errors.endTime })} />}
          </Field>
        </div>

        <Field label={t('admin.eventForm.location')} error={errors.location} required>
          {(p) => (
            <input {...p} type="text" value={form.location} onChange={(e) => set('location', e.target.value)} placeholder={t('admin.eventForm.locationPlaceholder')} className={inputClass({ invalid: !!errors.location })} />
          )}
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={t('admin.form.category')} error={errors.category}>
            {(p) => (
              <select {...p} value={form.category} onChange={(e) => set('category', e.target.value)} className={selectClass({ invalid: !!errors.category })}>
                {categoryOptions(form.category).map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}
              </select>
            )}
          </Field>
          <Field label={t('admin.form.organization')} hint={orgLocked ? t('admin.eventForm.orgLocked') : undefined}>
            {(p) => (
              <select
                {...p}
                value={form.organization ?? ''}
                onChange={(e) => set('organization', e.target.value)}
                disabled={orgLocked}
                className={selectClass()}
              >
                {orgMissing && <option value={form.organization ?? ''}>{form.organization}</option>}
                {visibleOrgs.map((o) => <option key={o.slug} value={o.slug}>{o.name}</option>)}
              </select>
            )}
          </Field>
        </div>

        <Field label={t('admin.eventForm.description')} hint={t('admin.eventForm.descriptionHint')}>
          {(p) => (
            <textarea {...p} rows={4} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder={t('admin.eventForm.descriptionPlaceholder')} className={textareaClass()} />
          )}
        </Field>

        <Field label={t('admin.eventForm.onlineUrl')} hint={t('admin.eventForm.onlineUrlHint')} error={errors.onlineUrl}>
          {(p) => (
            <input {...p} type="url" value={form.onlineUrl} onChange={(e) => set('onlineUrl', e.target.value)} placeholder="https://meet.google.com/…" className={inputClass({ invalid: !!errors.onlineUrl })} />
          )}
        </Field>

        <div className="flex flex-col gap-2">
          <p className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">{t('admin.eventForm.cover')}</p>
          <ImageUploader value={form.coverImage} onChange={(v) => set('coverImage', v)} signPath={signPath} />
        </div>
      </div>

      <div className="bg-white dark:bg-night-surface rounded-card border border-border dark:border-night-border shadow-card p-4 sm:p-6 flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <p id="event-signup-label" className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">{t('admin.eventForm.signup')}</p>
          <ToggleGroup<SignupMode>
            joined
            className="self-start"
            labelledBy="event-signup-label"
            value={form.signupMode}
            onChange={(v) => set('signupMode', v)}
            options={[
              { value: 'none', label: t('admin.eventForm.signupModes.none') },
              { value: 'external', label: t('admin.eventForm.signupModes.external') },
              { value: 'rsvp', label: t('admin.eventForm.signupModes.rsvp') },
            ]}
          />
          <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{t(`admin.eventForm.signupHints.${form.signupMode}`)}</p>
        </div>
        {form.signupMode === 'external' && (
          <Field label={t('admin.eventForm.signupUrl')} error={errors.signupUrl} required>
            {(p) => (
              <input {...p} type="url" value={form.signupUrl} onChange={(e) => set('signupUrl', e.target.value)} placeholder="https://forms.gle/…" className={inputClass({ invalid: !!errors.signupUrl })} />
            )}
          </Field>
        )}
        {form.signupMode === 'rsvp' && (
          <Field label={t('admin.eventForm.capacity')} hint={t('admin.eventForm.capacityHint')} error={errors.capacity}>
            {(p) => (
              <input {...p} type="number" inputMode="numeric" min={1} value={form.capacity} onChange={(e) => set('capacity', e.target.value)} className={inputClass({ invalid: !!errors.capacity, className: 'w-40' })} />
            )}
          </Field>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={saving} loadingLabel={t('admin.form.saving')}>
          {isEdit ? t('admin.form.saveChanges') : t('admin.eventForm.create')}
        </Button>
        <Link to={back.to} className={buttonClass({ variant: 'ghost' })}>
          {t('admin.common.cancel')}
        </Link>
        {isEdit && (
          <Button variant="dangerGhost" className="ml-auto" onClick={() => { setDeleteError(''); setConfirmDelete(true) }}>
            {t('admin.common.delete')}
          </Button>
        )}
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={t('admin.events.deleteDialog.title')}
          body={t('admin.events.deleteDialog.body', { title: form.title })}
          confirmLabel={t('admin.events.deleteDialog.confirm')}
          danger
          busy={deleting}
          error={deleteError}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </form>
  )
}
