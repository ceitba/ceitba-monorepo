import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import {
  createOrganization,
  listOrganizations,
  type CreateOrganizationPayload,
  type Organization,
} from '../../api/admin'
import { ApiError } from '../../api/client'
import ErrorBanner from '../../components/ErrorBanner'
import Modal from '../../components/Modal'
import { SLUG_MAX, isValidSlug, slugify } from '../../utils/slug'

// The categories the seeded orgs use (CEITBA-API V7__seed_organizations.sql).
// Stored as-is and shown raw by ITBA News, so they stay untranslated here too.
const CATEGORIES = [
  'General', 'Aerospace', 'Bioengineering', 'Business', 'Community', 'Culture',
  'Energy', 'Engineering', 'Game Dev', 'Innovation', 'Media', 'Tech',
]

// The named colour schemes ITBA News renders (GEO_BG in OrganizationsPage /
// OrgPortalPage); anything else falls back to blue there. Same classes here so
// the swatch matches the org's newsletter hero.
const COLORS = ['blue', 'amber', 'green', 'violet'] as const
type OrgColor = (typeof COLORS)[number]
const COLOR_BG: Record<OrgColor, string> = {
  blue:   'bg-primary-500',
  amber:  'bg-accent-400',
  green:  'bg-emerald-600',
  violet: 'bg-violet-600',
}

function colorBg(color: string | null): string {
  return COLOR_BG[(color ?? '') as OrgColor] ?? COLOR_BG.blue
}

const NEWSLETTER_ORG_PREFIX = 'ceitba.org.ar/newsletter/organizations/'

function byName(a: Organization, b: Organization) {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
}

export default function ManageOrganizationsSection({ onAddMembers }: { onAddMembers: (org: Organization) => void }) {
  const { t } = useTranslation()
  const [orgs, setOrgs]           = useState<Organization[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notice, setNotice]       = useState<string | null>(null)
  const [creating, setCreating]   = useState(false)
  // Orgs created in this visit: kept on top of the list with the
  // "Agregar miembros" shortcut, newest first (even if the list fetch
  // resolves after the create).
  const [created, setCreated]     = useState<Organization[]>([])

  // Out-of-order guard: only the latest request may write state.
  const reqIdRef = useRef(0)

  useEffect(() => {
    const id = ++reqIdRef.current
    listOrganizations()
      .then((data) => {
        if (reqIdRef.current !== id) return
        setOrgs([...data].sort(byName))
        setLoadError(null)
      })
      .catch((e: Error) => {
        if (reqIdRef.current !== id) return
        setLoadError(e.message)
      })
  }, [])

  function handleCreated(org: Organization) {
    setCreating(false)
    setCreated((prev) => [org, ...prev.filter((o) => o.slug !== org.slug)])
    setNotice(t('manage.organizations.createdNotice', { name: org.name }))
  }

  const createdSlugs = new Set(created.map((o) => o.slug))
  const rows = [...created, ...(orgs ?? []).filter((o) => !createdSlugs.has(o.slug))]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-3">
        <p className="flex-1 min-w-[240px] font-body text-body-sm text-ink-secondary dark:text-night-muted">
          {t('manage.organizations.intro')}
        </p>
        <button
          type="button"
          onClick={() => { setNotice(null); setCreating(true) }}
          className="px-3 py-1.5 rounded-sm bg-primary text-white font-mono text-label uppercase tracking-widest hover:bg-primary-600 transition-colors"
        >
          {t('manage.organizations.add')}
        </button>
      </div>

      {loadError && <ErrorBanner onDismiss={() => setLoadError(null)}>{loadError}</ErrorBanner>}
      {notice && (
        <div
          role="status"
          className="flex items-start gap-3 px-3 py-2 rounded-sm border font-body text-body-sm bg-green-50 text-green-800 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-900"
        >
          <p className="flex-1">{notice}</p>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label={t('errors.dismiss')}
            className="flex-shrink-0 leading-none text-h5 opacity-70 hover:opacity-100"
          >
            ×
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-card border border-border dark:border-night-border">
        <table className="w-full font-body text-body-sm">
          <thead className="bg-page-bg dark:bg-night-bg">
            <tr className="text-left">
              <th className="px-3 py-2 font-mono text-label uppercase tracking-widest">{t('manage.organizations.col.organization')}</th>
              <th className="px-3 py-2 font-mono text-label uppercase tracking-widest">{t('manage.organizations.col.slug')}</th>
              <th className="px-3 py-2 font-mono text-label uppercase tracking-widest">{t('manage.organizations.col.category')}</th>
              <th className="px-3 py-2 font-mono text-label uppercase tracking-widest">
                <span className="sr-only">{t('manage.organizations.col.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => {
              const isNew = createdSlugs.has(o.slug)
              return (
                <tr
                  key={o.slug}
                  className={`border-t border-border dark:border-night-border align-middle ${isNew ? 'bg-green-50/60 dark:bg-green-950/20' : ''}`}
                >
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-3">
                      <OrgBadge org={o} />
                      <div className="min-w-0">
                        <p className="font-semibold text-ink-primary dark:text-night-text">
                          {o.name}
                          {isNew && (
                            <span className="ml-2 px-1.5 py-0.5 rounded-sm border border-green-300 dark:border-green-800 text-green-800 dark:text-green-300 font-mono text-label uppercase tracking-widest align-middle">
                              {t('manage.organizations.newBadge')}
                            </span>
                          )}
                        </p>
                        <p className="text-ink-secondary dark:text-night-muted">{o.fullName}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 font-mono text-label text-ink-secondary dark:text-night-muted whitespace-nowrap">
                    {o.slug}
                  </td>
                  <td className="px-3 py-3 text-ink-secondary dark:text-night-muted">
                    {o.category || '—'}
                  </td>
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    {isNew && (
                      <button
                        type="button"
                        onClick={() => onAddMembers(o)}
                        aria-label={t('manage.organizations.addMembersAria', { name: o.name })}
                        className="px-3 py-1 rounded-sm font-mono text-label uppercase tracking-widest border border-border dark:border-night-border hover:border-primary hover:text-primary transition-colors"
                      >
                        {t('manage.organizations.addMembers')}
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
            {orgs === null && !loadError && rows.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-ink-secondary dark:text-night-muted">{t('manage.loading')}</td></tr>
            )}
            {orgs !== null && rows.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-ink-secondary dark:text-night-muted">{t('manage.organizations.empty')}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {creating && (
        <CreateOrganizationModal
          onCancel={() => setCreating(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  )
}

function OrgBadge({ org }: { org: Organization }) {
  if (org.logoUrl) {
    return (
      <img
        src={org.logoUrl}
        alt=""
        className="w-9 h-9 flex-shrink-0 rounded-sm object-cover border border-border dark:border-night-border bg-white"
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      className={`w-9 h-9 flex-shrink-0 rounded-sm flex items-center justify-center font-display font-bold text-white ${colorBg(org.color)}`}
    >
      {org.name.trim().charAt(0).toUpperCase()}
    </span>
  )
}

type FieldKey = 'slug' | 'name' | 'fullName' | 'description' | 'category' | 'color'
const FIELD_KEYS: FieldKey[] = ['slug', 'name', 'fullName', 'description', 'category', 'color']

// Bean-validation 400s come as "field: message; field2: message".
function parseFieldErrors(message: string): Partial<Record<FieldKey, string>> {
  const out: Partial<Record<FieldKey, string>> = {}
  for (const part of message.split(';')) {
    const idx = part.indexOf(':')
    if (idx < 0) continue
    const field = part.slice(0, idx).trim() as FieldKey
    if (FIELD_KEYS.includes(field) && !out[field]) out[field] = part.slice(idx + 1).trim()
  }
  return out
}

function CreateOrganizationModal({
  onCancel,
  onCreated,
}: {
  onCancel: () => void
  onCreated: (org: Organization) => void
}) {
  const { t } = useTranslation()
  const [name, setName]               = useState('')
  const [fullName, setFullName]       = useState('')
  const [slug, setSlug]               = useState('')
  // Once the slug is edited by hand it stops following the name.
  const [slugManual, setSlugManual]   = useState(false)
  const [editingSlug, setEditingSlug] = useState(false)
  const [description, setDescription] = useState('')
  const [category, setCategory]       = useState('')
  const [color, setColor]             = useState<OrgColor>('blue')
  const [busy, setBusy]               = useState(false)
  const [attempted, setAttempted]     = useState(false)
  const [formError, setFormError]     = useState<string | null>(null)
  const [serverErrors, setServerErrors] = useState<Partial<Record<FieldKey, string>>>({})

  const nameRef = useRef<HTMLInputElement>(null)
  const slugRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingSlug) slugRef.current?.focus()
  }, [editingSlug])

  function onNameChange(v: string) {
    setName(v)
    setServerErrors((e) => ({ ...e, name: undefined }))
    if (!slugManual) {
      setSlug(slugify(v))
      setServerErrors((e) => ({ ...e, slug: undefined }))
    }
  }

  const trimmedName = name.trim()
  const trimmedFullName = fullName.trim()

  const clientErrors: Partial<Record<FieldKey, string>> = {}
  if (!trimmedName) clientErrors.name = t('manage.organizations.errors.nameRequired')
  if (!trimmedFullName) clientErrors.fullName = t('manage.organizations.errors.fullNameRequired')
  if (!slug) clientErrors.slug = t('manage.organizations.errors.slugRequired')
  else if (!isValidSlug(slug)) clientErrors.slug = t('manage.organizations.errors.slugFormat', { max: SLUG_MAX })

  // Required-field errors wait for a submit attempt; a malformed slug the
  // user is typing by hand is flagged right away. An auto-generated one is
  // not (typing the first letter of the name would otherwise flash a
  // "2 to 40 characters" error under a field the user hasn't touched).
  const shown = (k: FieldKey): string | undefined => {
    if (serverErrors[k]) return serverErrors[k]
    if (k === 'slug' && slugManual && slug && clientErrors.slug) return clientErrors.slug
    return attempted ? clientErrors[k] : undefined
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setAttempted(true)
    setFormError(null)
    setServerErrors({})
    if (Object.keys(clientErrors).length > 0) {
      if (clientErrors.slug && !clientErrors.name) setEditingSlug(true)
      return
    }
    const payload: CreateOrganizationPayload = {
      slug,
      name: trimmedName,
      fullName: trimmedFullName,
      color,
    }
    if (description.trim()) payload.description = description.trim()
    if (category) payload.category = category
    setBusy(true)
    try {
      const org = await createOrganization(payload)
      onCreated(org)
    } catch (err) {
      setBusy(false)
      if (err instanceof ApiError && (err.code === 'ResourceAlreadyExists' || err.status === 409)) {
        setServerErrors({ slug: t('manage.organizations.errors.duplicate') })
        setEditingSlug(true)
        return
      }
      if (err instanceof ApiError && err.code === 'ValidationError') {
        const fields = localizeFieldErrors(parseFieldErrors(err.message))
        if (Object.keys(fields).length > 0) {
          setServerErrors(fields)
          if (fields.slug) setEditingSlug(true)
          return
        }
      }
      setFormError((err as Error).message)
    }
  }

  // The API's bean-validation messages are English ("slug: must be 2-40
  // characters"); show our own copy for the fields we know how to explain and
  // keep the raw text only for anything unexpected.
  function localizeFieldErrors(fields: Partial<Record<FieldKey, string>>): Partial<Record<FieldKey, string>> {
    const out = { ...fields }
    if (out.slug) out.slug = t('manage.organizations.errors.slugFormat', { max: SLUG_MAX })
    if (out.name) out.name = t('manage.organizations.errors.nameRequired')
    if (out.fullName) out.fullName = t('manage.organizations.errors.fullNameRequired')
    return out
  }

  const slugError = shown('slug')

  return (
    <Modal
      title={t('manage.organizations.createTitle')}
      onClose={onCancel}
      busy={busy}
      size="lg"
      initialFocusRef={nameRef}
      footer={
        <>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="px-3 py-1.5 font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted disabled:opacity-50"
          >
            {t('manage.cancel')}
          </button>
          <button
            type="submit"
            form="create-organization-form"
            disabled={busy}
            className="px-3 py-1.5 rounded-sm bg-primary text-white font-mono text-label uppercase tracking-widest disabled:opacity-50"
          >
            {busy ? t('manage.organizations.creating') : t('manage.organizations.create')}
          </button>
        </>
      }
    >
      <form id="create-organization-form" noValidate onSubmit={submit} className="flex flex-col gap-4">
        {formError && <ErrorBanner onDismiss={() => setFormError(null)}>{formError}</ErrorBanner>}

        <TextField
          id="org-name"
          inputRef={nameRef}
          label={t('manage.organizations.fields.name')}
          hint={t('manage.organizations.fields.nameHint')}
          value={name}
          onChange={onNameChange}
          disabled={busy}
          error={shown('name')}
          required
        />

        <TextField
          id="org-full-name"
          label={t('manage.organizations.fields.fullName')}
          hint={t('manage.organizations.fields.fullNameHint')}
          value={fullName}
          onChange={(v) => { setFullName(v); setServerErrors((e) => ({ ...e, fullName: undefined })) }}
          disabled={busy}
          error={shown('fullName')}
          required
        />

        <div className="flex flex-col gap-1">
          <span id="org-slug-label" className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
            {t('manage.organizations.fields.slug')}
          </span>
          {editingSlug ? (
            <div className="flex items-stretch rounded-sm border border-border dark:border-night-border bg-white dark:bg-night-surface focus-within:border-primary">
              <span className="hidden sm:flex items-center pl-3 font-mono text-label text-ink-secondary dark:text-night-muted whitespace-nowrap select-none">
                {NEWSLETTER_ORG_PREFIX}
              </span>
              <input
                ref={slugRef}
                id="org-slug"
                aria-labelledby="org-slug-label"
                aria-invalid={slugError ? true : undefined}
                aria-describedby={slugError ? 'org-slug-error' : 'org-slug-hint'}
                value={slug}
                disabled={busy}
                maxLength={SLUG_MAX}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                onChange={(e) => {
                  // Forgive the obvious slips (capitals, spaces, underscores)
                  // instead of flagging them; anything else is validated.
                  const next = e.target.value.toLowerCase().replace(/[\s_]+/g, '-')
                  setSlug(next)
                  // Clearing the field hands the slug back to the name.
                  setSlugManual(next !== '')
                  setServerErrors((er) => ({ ...er, slug: undefined }))
                }}
                className="flex-1 min-w-0 px-3 sm:pl-0 py-1.5 bg-transparent font-mono text-body-sm focus:outline-none"
              />
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-mono text-body-sm text-ink-primary dark:text-night-text break-all">
                {NEWSLETTER_ORG_PREFIX}
                <strong className="font-semibold">{slug || t('manage.organizations.fields.slugPlaceholder')}</strong>
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => setEditingSlug(true)}
                aria-label={t('manage.organizations.fields.slugEditAria')}
                className="text-primary dark:text-primary-300 font-mono text-label uppercase tracking-widest hover:underline disabled:opacity-50"
              >
                {t('manage.edit')}
              </button>
            </div>
          )}
          {slugError ? (
            <p id="org-slug-error" className="font-body text-body-sm text-red-600 dark:text-red-400">{slugError}</p>
          ) : (
            <p id="org-slug-hint" className="font-body text-body-sm text-ink-secondary dark:text-night-muted">
              {t(slugManual ? 'manage.organizations.fields.slugHintManual' : 'manage.organizations.fields.slugHint')}
            </p>
          )}
        </div>

        <label className="flex flex-col gap-1">
          <span className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
            {t('manage.organizations.fields.description')}
            <span className="normal-case tracking-normal"> {t('manage.organizations.fields.optional')}</span>
          </span>
          <textarea
            value={description}
            disabled={busy}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="px-3 py-2 rounded-sm border border-border dark:border-night-border bg-white dark:bg-night-surface font-body text-body-sm resize-y"
          />
          {shown('description') && <p className="font-body text-body-sm text-red-600 dark:text-red-400">{shown('description')}</p>}
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
            {t('manage.organizations.fields.category')}
            <span className="normal-case tracking-normal"> {t('manage.organizations.fields.optional')}</span>
          </span>
          <select
            value={category}
            disabled={busy}
            onChange={(e) => setCategory(e.target.value)}
            className="px-3 py-1.5 rounded-sm border border-border dark:border-night-border bg-white dark:bg-night-surface font-body text-body-sm"
          >
            <option value="">{t('manage.organizations.fields.noCategory')}</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          {shown('category') && <p className="font-body text-body-sm text-red-600 dark:text-red-400">{shown('category')}</p>}
        </label>

        <fieldset className="flex flex-col gap-2" disabled={busy} aria-describedby="org-color-hint">
          <legend className="mb-1 font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
            {t('manage.organizations.fields.color')}
          </legend>
          <div className="flex flex-wrap gap-3">
            {COLORS.map((c) => (
              <label key={c} className="cursor-pointer">
                <input
                  type="radio"
                  name="org-color"
                  value={c}
                  checked={color === c}
                  onChange={() => setColor(c)}
                  className="peer sr-only"
                />
                <span
                  className={`flex items-center gap-2 pl-1 pr-3 py-1 rounded-sm border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-1 ${
                    color === c
                      ? 'border-primary dark:border-primary-300 text-ink-primary dark:text-night-text'
                      : 'border-border dark:border-night-border text-ink-secondary dark:text-night-muted hover:border-primary'
                  }`}
                >
                  <span aria-hidden="true" className={`w-6 h-6 rounded-sm ${COLOR_BG[c]}`} />
                  <span className="font-body text-body-sm">{t(`manage.organizations.colors.${c}`)}</span>
                </span>
              </label>
            ))}
          </div>
          <p id="org-color-hint" className="font-body text-body-sm text-ink-secondary dark:text-night-muted">
            {t('manage.organizations.fields.colorHint')}
          </p>
          {shown('color') && <p className="font-body text-body-sm text-red-600 dark:text-red-400">{shown('color')}</p>}
        </fieldset>
      </form>
    </Modal>
  )
}

function TextField({
  id,
  label,
  hint,
  value,
  onChange,
  disabled,
  error,
  required,
  inputRef,
}: {
  id: string
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  error?: string
  required?: boolean
  inputRef?: RefObject<HTMLInputElement>
}) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
        {label}
      </label>
      <input
        ref={inputRef}
        id={id}
        value={value}
        disabled={disabled}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
        className={`px-3 py-1.5 rounded-sm border bg-white dark:bg-night-surface font-body text-body-sm focus:outline-none focus:border-primary ${
          error ? 'border-red-400 dark:border-red-700' : 'border-border dark:border-night-border'
        }`}
      />
      {error ? (
        <p id={`${id}-error`} className="font-body text-body-sm text-red-600 dark:text-red-400">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{hint}</p>
      ) : null}
    </div>
  )
}
