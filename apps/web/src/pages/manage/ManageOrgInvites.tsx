import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  fetchOrgInvites,
  inviteToOrganization,
  revokeOrgInvite,
  type MembershipRole,
  type OrganizationSummary,
  type OrgInvite,
} from '../../api/admin'
import { ApiError } from '../../api/client'
import {
  Alert, Badge, Button, CloseIcon, ConfirmDialog, ErrorState, Field, IconButton, LoadingRegion, Modal, Skeleton,
  selectClass, textareaClass, toast,
} from '../../components/ui'
import { adminErrorMessage } from './adminErrors'

// What POST .../members/invites takes at once (OrganizationMembershipService).
const MAX_INVITES = 50

// Emails typed or pasted one per line, or separated by commas/spaces.
function parseEmails(raw: string): string[] {
  return [...new Set(raw.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))]
}

// The org's pending invites (people who haven't signed in yet), each
// revocable. Renders nothing once loaded with none. `tick` refetches. Key it
// by org slug so switching orgs never shows (or revokes) the previous one's.
export function PendingOrgInvites({ org, tick }: { org: OrganizationSummary; tick: number }) {
  const { t } = useTranslation()
  const [invites, setInvites] = useState<OrgInvite[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [retry, setRetry] = useState(0)
  const [revoking, setRevoking] = useState<OrgInvite | null>(null)
  const [revokeBusy, setRevokeBusy] = useState(false)
  const [revokeError, setRevokeError] = useState('')

  useEffect(() => {
    let active = true
    fetchOrgInvites(org.slug)
      .then((list) => { if (active) { setInvites(list); setLoadError('') } })
      .catch((e) => { if (active) setLoadError(adminErrorMessage(e, t)) })
    return () => { active = false }
  }, [org.slug, tick, retry, t])

  async function revoke(invite: OrgInvite) {
    setRevokeBusy(true)
    setRevokeError('')
    try {
      await revokeOrgInvite(org.slug, invite.email)
      setInvites((list) => list && list.filter((i) => i.email !== invite.email))
      setRevoking(null)
      toast.success(t('manage.users.invites.revoked', { email: invite.email, org: org.name }))
    } catch (e) {
      setRevokeError(adminErrorMessage(e, t))
    } finally {
      setRevokeBusy(false)
    }
  }

  if (loadError) {
    return (
      <ErrorState
        compact
        title={t('manage.users.invites.loadFailed', { org: org.name })}
        message={loadError}
        onRetry={() => { setLoadError(''); setRetry((n) => n + 1) }}
      />
    )
  }
  if (!invites) {
    return (
      <LoadingRegion className="rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface px-4 py-3 flex flex-col gap-2">
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-4 w-1/2" />
      </LoadingRegion>
    )
  }
  if (invites.length === 0) return null

  return (
    <>
    <section
      aria-labelledby="org-pending-invites"
      className="rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface px-4 py-3"
    >
      <h3 id="org-pending-invites" className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted mb-1">
        {t('manage.users.invites.pendingTitle', { count: invites.length, org: org.name })}
      </h3>
      <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted mb-2">
        {t('manage.users.invites.pendingHint')}
      </p>
      <ul className="flex flex-col gap-1">
        {invites.map((i) => (
          <li key={i.email} className="flex flex-wrap items-center gap-x-2 gap-y-1 font-body text-body-sm">
            <span className="font-mono text-ink-primary dark:text-night-text">{i.email}</span>
            <Badge tone={i.role === 'admin' ? 'info' : 'neutral'}>
              {t(i.role === 'admin' ? 'manage.users.orgAdmin' : 'manage.users.orgMember')}
            </Badge>
            <IconButton
              size="sm"
              onClick={() => { setRevokeError(''); setRevoking(i) }}
              aria-label={t('manage.users.invites.revokeAria', { email: i.email, org: org.name })}
              className="hover:!text-red-600 dark:hover:!text-red-400"
            >
              <CloseIcon size={16} />
            </IconButton>
          </li>
        ))}
      </ul>
    </section>
    {revoking && (
      <ConfirmDialog
        title={t('manage.users.invites.revokeTitle')}
        body={t('manage.users.invites.revokeBody', { email: revoking.email, org: org.name })}
        confirmLabel={t('manage.users.invites.revokeConfirm')}
        busy={revokeBusy}
        error={revokeError}
        onConfirm={() => revoke(revoking)}
        onCancel={() => setRevoking(null)}
      />
    )}
    </>
  )
}

// Invite by email: people who already signed in join the org right away,
// everyone else joins on their first login.
export function InviteToOrgModal({ org, initial, onClose, onDone }: {
  org: OrganizationSummary
  initial: string
  onClose: () => void
  onDone: () => void
}) {
  const { t } = useTranslation()
  const [raw, setRaw] = useState(initial)
  const [role, setRole] = useState<MembershipRole>('member')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const emails = parseEmails(raw)
  const tooMany = emails.length > MAX_INVITES

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!emails.length || tooMany) return
    setBusy(true)
    setError('')
    try {
      const res = await inviteToOrganization(org.slug, emails, role)
      // The API skips people who already belong to the org: nothing to report but that.
      toast.success(res.added.length + res.pending.length === 0
        ? t('manage.users.invites.alreadyMembers')
        : t('manage.users.invites.done', { added: res.added.length, pending: res.pending.length }))
      onDone()
    } catch (err) {
      // A 400 names the offending email ("... 'x@gmail.com': is not allowed to
      // sign in"): show that when the server sent one.
      if (err instanceof ApiError && err.status === 400) {
        console.error(err)
        setError(err.message && !err.message.startsWith('Request failed') ? err.message : t('manage.users.invites.invalidEmails'))
      } else {
        setError(adminErrorMessage(err, t))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={t('manage.users.invites.title', { org: org.name })}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{t('ui.cancel')}</Button>
          <Button type="submit" form="manage-org-invite-form" loading={busy} disabled={!emails.length || tooMany}>
            {t('manage.users.invites.submit', { count: emails.length })}
          </Button>
        </>
      }
    >
      <form id="manage-org-invite-form" onSubmit={submit} className="flex flex-col gap-4">
        <Field label={t('manage.users.invites.emailsLabel')} hint={t('manage.users.invites.emailsHint')}>
          {(p) => (
            <textarea
              {...p}
              rows={4}
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder="nombre@itba.edu.ar"
              className={textareaClass()}
            />
          )}
        </Field>
        <Field label={t('manage.users.invites.roleLabel')}>
          {(p) => (
            <select {...p} value={role} onChange={(e) => setRole(e.target.value as MembershipRole)} className={selectClass()}>
              <option value="member">{t('manage.users.orgMember')}</option>
              <option value="admin">{t('manage.users.orgAdmin')}</option>
            </select>
          )}
        </Field>
        {tooMany && <Alert tone="error">{t('manage.users.invites.tooMany', { max: MAX_INVITES })}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}
      </form>
    </Modal>
  )
}
