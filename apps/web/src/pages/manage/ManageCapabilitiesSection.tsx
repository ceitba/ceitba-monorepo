import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { listOrganizations, type Organization } from '../../api/admin'
import {
  getCapabilityGrants,
  grantCapabilityToOrg,
  grantCapabilityToUsers,
  listCapabilities,
  revokeCapabilityFromOrg,
  revokeCapabilityFromUser,
  setCapabilityEnabledForAll,
  type Capability,
  type CapabilityGrants,
} from '../../api/capabilities'
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingRegion,
  SkeletonCards,
  SkeletonText,
  Switch,
  selectClass,
  textareaClass,
} from '../../components/ui'
import { formatDate } from '../../utils/apuntes'
import { adminErrorMessage } from './adminErrors'

const PANEL = 'flex flex-col gap-3 p-3 sm:p-4 rounded-card border border-border dark:border-night-border bg-page-bg dark:bg-night-bg'
const PANEL_TITLE = 'font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Splits a pasted list ("a@x, b@x\nc@x") into unique, lower-cased emails.
function parseEmails(raw: string): { valid: string[]; invalid: string[] } {
  const seen = new Set<string>()
  const valid: string[] = []
  const invalid: string[] = []
  for (const part of raw.split(/[\s,;]+/)) {
    const email = part.trim().toLowerCase()
    if (!email || seen.has(email)) continue
    seen.add(email)
    ;(EMAIL_RE.test(email) ? valid : invalid).push(email)
  }
  return { valid, invalid }
}

// /manage → "Capacidades": feature flags (e.g. Apuntes) enabled for everyone,
// or granted per email / per organization (CEITBA-API /v1/staff/capabilities).
export default function ManageCapabilitiesSection() {
  const { t } = useTranslation()
  const [items, setItems] = useState<Capability[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    setLoadFailed(false)
    listCapabilities()
      .then((data) => { if (active) setItems(data) })
      .catch((e) => { console.error(e); if (active) setLoadFailed(true) })
    return () => { active = false }
  }, [reloadKey])

  function update(next: Capability) {
    setItems((prev) => prev?.map((c) => (c.key === next.key ? next : c)) ?? prev)
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted max-w-3xl">
        {t('manage.capabilities.intro')}
      </p>
      {loadFailed && items === null && (
        <ErrorState message={t('manage.capabilities.loadFailed')} onRetry={() => setReloadKey((k) => k + 1)} />
      )}
      {items === null && !loadFailed && <SkeletonCards count={3} className="flex flex-col gap-3" cardClassName="h-28" />}
      {items !== null && items.length === 0 && (
        <EmptyState title={t('manage.capabilities.empty')} body={t('manage.capabilities.emptyHint')} />
      )}
      <ul className="flex flex-col gap-3">
        {items?.map((c) => (
          <li key={c.key}>
            <CapabilityCard capability={c} onChange={update} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function CapabilityCard({ capability: c, onChange }: { capability: Capability; onChange: (c: Capability) => void }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [confirmOn, setConfirmOn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const panelId = `capability-${c.key}-grants`

  async function setEnabledForAll(value: boolean) {
    setConfirmOn(false)
    setError(null)
    setBusy(true)
    const prev = c
    onChange({ ...c, enabledForAll: value }) // optimistic
    try {
      onChange(await setCapabilityEnabledForAll(c.key, value))
    } catch (e) {
      onChange(prev)
      setError(adminErrorMessage(e, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface">
      <div className="flex flex-col sm:flex-row sm:items-start gap-3 p-4">
        <div className="flex-1 min-w-0">
          <h2 className="font-display font-bold text-h5 text-ink-primary dark:text-night-text">{c.label}</h2>
          {c.description && (
            <p className="mt-1 font-body text-body-sm text-ink-secondary dark:text-night-muted">{c.description}</p>
          )}
          <p className="mt-2 font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
            {c.enabledForAll
              ? t('manage.capabilities.everyone')
              : t('manage.capabilities.counts', {
                  users: t('manage.capabilities.userCount', { count: c.userGrantCount }),
                  orgs: t('manage.capabilities.orgCount', { count: c.orgGrantCount }),
                })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Switch
            checked={c.enabledForAll}
            disabled={busy}
            onChange={(next) => (next ? setConfirmOn(true) : setEnabledForAll(false))}
            label={t('manage.capabilities.enabledForAll')}
          />
          <Button
            variant="outline"
            size="sm"
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? t('manage.capabilities.hideGrants') : t('manage.capabilities.manageGrants')}
          </Button>
        </div>
      </div>
      {error && <Alert tone="error" className="mx-4 mb-4" onDismiss={() => setError(null)}>{error}</Alert>}
      {expanded && (
        <div id={panelId} className="border-t border-border dark:border-night-border p-3 sm:p-4">
          {c.enabledForAll && (
            <p className="mb-3 font-body text-body-sm text-ink-secondary dark:text-night-muted">
              {t('manage.capabilities.everyoneNote')}
            </p>
          )}
          <GrantsPanels
            capabilityKey={c.key}
            onCounts={(users, orgs) => {
              if (users !== c.userGrantCount || orgs !== c.orgGrantCount) {
                onChange({ ...c, userGrantCount: users, orgGrantCount: orgs })
              }
            }}
          />
        </div>
      )}
      {confirmOn && (
        <ConfirmDialog
          title={t('manage.capabilities.confirmTitle', { label: c.label })}
          body={t('manage.capabilities.confirmBody', { label: c.label })}
          confirmLabel={t('manage.capabilities.confirmCta')}
          danger={false}
          onConfirm={() => setEnabledForAll(true)}
          onCancel={() => setConfirmOn(false)}
        />
      )}
    </article>
  )
}

// Shared across cards: the org list only changes from the Organizations tab.
let orgsCache: Promise<Organization[]> | null = null
function loadOrgs(): Promise<Organization[]> {
  if (!orgsCache) {
    orgsCache = listOrganizations()
      .then((list) => [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })))
      .catch((e) => { orgsCache = null; throw e })
  }
  return orgsCache
}

function GrantsPanels({ capabilityKey, onCounts }: { capabilityKey: string; onCounts: (users: number, orgs: number) => void }) {
  const { t, i18n } = useTranslation()
  const [grants, setGrants] = useState<CapabilityGrants | null>(null)
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [emailsRaw, setEmailsRaw] = useState('')
  const [invalid, setInvalid] = useState<string[]>([])
  const [granting, setGranting] = useState(false)
  const [orgSlug, setOrgSlug] = useState('')
  const [addingOrg, setAddingOrg] = useState(false)
  const [pending, setPending] = useState<Set<string>>(new Set())
  const onCountsRef = useRef(onCounts)
  onCountsRef.current = onCounts

  useEffect(() => {
    let active = true
    setLoadFailed(false)
    Promise.all([getCapabilityGrants(capabilityKey), loadOrgs()])
      .then(([g, list]) => { if (active) { setGrants(g); setOrgs(list) } })
      .catch((e) => { console.error(e); if (active) setLoadFailed(true) })
    return () => { active = false }
  }, [capabilityKey, reloadKey])

  // Keep the card's counts in sync with the grant lists.
  useEffect(() => {
    if (grants) onCountsRef.current(grants.users.length, grants.orgs.length)
  }, [grants])

  function markPending(id: string, on: boolean) {
    setPending((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  async function grantUsers(e: FormEvent) {
    e.preventDefault()
    const { valid, invalid: bad } = parseEmails(emailsRaw)
    setInvalid(bad)
    if (bad.length > 0 || valid.length === 0) return
    setError(null)
    setGranting(true)
    try {
      setGrants(await grantCapabilityToUsers(capabilityKey, valid))
      setEmailsRaw('')
    } catch (err) {
      setError(adminErrorMessage(err, t))
    } finally {
      setGranting(false)
    }
  }

  async function revokeUser(email: string) {
    if (!grants) return
    const index = grants.users.findIndex((u) => u.email === email)
    const removed = grants.users[index]
    if (!removed) return
    setError(null)
    markPending(`u:${email}`, true)
    setGrants((g) => (g ? { ...g, users: g.users.filter((u) => u.email !== email) } : g)) // optimistic
    try {
      await revokeCapabilityFromUser(capabilityKey, email)
    } catch (err) {
      // Put back only this item: other revokes may have finished meanwhile.
      setGrants((g) => (g && !g.users.some((u) => u.email === email)
        ? { ...g, users: [...g.users.slice(0, index), removed, ...g.users.slice(index)] }
        : g))
      setError(adminErrorMessage(err, t))
    } finally {
      markPending(`u:${email}`, false)
    }
  }

  async function grantOrg(e: FormEvent) {
    e.preventDefault()
    if (!orgSlug) return
    setError(null)
    setAddingOrg(true)
    try {
      await grantCapabilityToOrg(capabilityKey, orgSlug)
      // Refetch for the member count and grantor name.
      setGrants(await getCapabilityGrants(capabilityKey))
      setOrgSlug('')
    } catch (err) {
      setError(adminErrorMessage(err, t))
    } finally {
      setAddingOrg(false)
    }
  }

  async function revokeOrg(slug: string) {
    if (!grants) return
    const index = grants.orgs.findIndex((o) => o.slug === slug)
    const removed = grants.orgs[index]
    if (!removed) return
    setError(null)
    markPending(`o:${slug}`, true)
    setGrants((g) => (g ? { ...g, orgs: g.orgs.filter((o) => o.slug !== slug) } : g)) // optimistic
    try {
      await revokeCapabilityFromOrg(capabilityKey, slug)
    } catch (err) {
      // Put back only this item: other revokes may have finished meanwhile.
      setGrants((g) => (g && !g.orgs.some((o) => o.slug === slug)
        ? { ...g, orgs: [...g.orgs.slice(0, index), removed, ...g.orgs.slice(index)] }
        : g))
      setError(adminErrorMessage(err, t))
    } finally {
      markPending(`o:${slug}`, false)
    }
  }

  if (loadFailed) {
    return <ErrorState compact message={t('manage.capabilities.grantsLoadFailed')} onRetry={() => setReloadKey((k) => k + 1)} />
  }

  const grantedSlugs = new Set(grants?.orgs.map((o) => o.slug))
  const available = orgs.filter((o) => !grantedSlugs.has(o.slug))
  const loading = <LoadingRegion><SkeletonText lines={2} /></LoadingRegion>
  const meta = (grantedAt: string, by: string | null) =>
    by
      ? t('manage.capabilities.grantedBy', { date: formatDate(grantedAt, i18n.language), name: by })
      : t('manage.capabilities.grantedOn', { date: formatDate(grantedAt, i18n.language) })
  const emailsErrorId = `${capabilityKey}-emails-error`

  return (
    <div className="flex flex-col gap-3">
      {error && <Alert tone="error" onDismiss={() => setError(null)}>{error}</Alert>}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <section className={PANEL} aria-labelledby={`${capabilityKey}-users`}>
          <h3 id={`${capabilityKey}-users`} className={PANEL_TITLE}>
            {t('manage.capabilities.users.title')}
          </h3>
          <form onSubmit={grantUsers} className="flex flex-col gap-2">
            <label htmlFor={`${capabilityKey}-emails`} className="font-body text-body-sm text-ink-secondary dark:text-night-muted">
              {t('manage.capabilities.users.help')}
            </label>
            <textarea
              id={`${capabilityKey}-emails`}
              value={emailsRaw}
              onChange={(e) => { setEmailsRaw(e.target.value); if (invalid.length) setInvalid([]) }}
              rows={3}
              placeholder={t('manage.capabilities.users.placeholder')}
              aria-invalid={invalid.length > 0}
              aria-describedby={invalid.length > 0 ? emailsErrorId : undefined}
              className={textareaClass({ invalid: invalid.length > 0 })}
            />
            {invalid.length > 0 && (
              <p id={emailsErrorId} role="alert" className="font-body text-body-sm text-red-700 dark:text-red-400">
                {t('manage.capabilities.users.invalid', { emails: invalid.join(', ') })}
              </p>
            )}
            <div>
              <Button type="submit" size="sm" loading={granting} disabled={!emailsRaw.trim()}>
                {t('manage.capabilities.users.grant')}
              </Button>
            </div>
          </form>
          {grants === null ? loading : grants.users.length === 0 ? (
            <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('manage.capabilities.users.empty')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border dark:divide-night-border">
              {grants.users.map((u) => (
                <li key={u.email} className="flex items-start gap-2 py-2">
                  <div className="flex-1 min-w-0">
                    {u.name && <p className="font-body text-body-sm font-semibold text-ink-primary dark:text-night-text truncate">{u.name}</p>}
                    <p className="font-mono text-label text-ink-secondary dark:text-night-muted break-all">
                      {u.email}
                      {!u.userId && <Badge className="ml-2">{t('manage.capabilities.users.neverLoggedIn')}</Badge>}
                    </p>
                    <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{meta(u.grantedAt, u.grantedByName)}</p>
                  </div>
                  <Button
                    variant="dangerGhost"
                    size="sm"
                    loading={pending.has(`u:${u.email}`)}
                    onClick={() => revokeUser(u.email)}
                    aria-label={t('manage.capabilities.removeAria', { name: u.name ?? u.email })}
                  >
                    {t('manage.capabilities.remove')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={PANEL} aria-labelledby={`${capabilityKey}-orgs`}>
          <h3 id={`${capabilityKey}-orgs`} className={PANEL_TITLE}>
            {t('manage.capabilities.orgs.title')}
          </h3>
          <form onSubmit={grantOrg} className="flex flex-col sm:flex-row gap-2">
            <label htmlFor={`${capabilityKey}-org`} className="sr-only">{t('manage.capabilities.orgs.pick')}</label>
            <select
              id={`${capabilityKey}-org`}
              value={orgSlug}
              onChange={(e) => setOrgSlug(e.target.value)}
              className={selectClass({ className: 'sm:flex-1 min-w-0' })}
            >
              <option value="">{t('manage.capabilities.orgs.pick')}</option>
              {available.map((o) => (
                <option key={o.slug} value={o.slug}>{o.name}</option>
              ))}
            </select>
            <Button type="submit" variant="outline" className="flex-shrink-0" loading={addingOrg} disabled={!orgSlug}>
              {t('manage.capabilities.orgs.add')}
            </Button>
          </form>
          {grants === null ? loading : grants.orgs.length === 0 ? (
            <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('manage.capabilities.orgs.empty')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border dark:divide-night-border">
              {grants.orgs.map((o) => (
                <li key={o.slug} className="flex items-start gap-2 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-body text-body-sm font-semibold text-ink-primary dark:text-night-text truncate">{o.name}</p>
                    <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">
                      {t('manage.capabilities.orgs.meta', {
                        members: t('manage.capabilities.orgs.members', { count: o.memberCount }),
                        granted: meta(o.grantedAt, o.grantedByName),
                      })}
                    </p>
                  </div>
                  <Button
                    variant="dangerGhost"
                    size="sm"
                    loading={pending.has(`o:${o.slug}`)}
                    onClick={() => revokeOrg(o.slug)}
                    aria-label={t('manage.capabilities.removeAria', { name: o.name })}
                  >
                    {t('manage.capabilities.remove')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
