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
import { Alert, Badge, Button, CloseIcon, Field, IconButton, Modal, selectClass, textareaClass, toast } from '../../components/ui'
import { adminErrorMessage } from './adminErrors'

// What POST .../members/invites takes at once (OrganizationMembershipService).
const MAX_INVITES = 50

// Emails typed or pasted one per line, or separated by commas/spaces.
function parseEmails(raw: string): string[] {
  return [...new Set(raw.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))]
}

// The org's pending invites (people who haven't signed in yet), each
// revocable. Renders nothing while there are none. `tick` refetches.
export function PendingOrgInvites({ org, tick }: { org: OrganizationSummary; tick: number }) {
  const { t } = useTranslation()
  const [invites, setInvites] = useState<OrgInvite[]>([])
  const [revoking, setRevoking] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    fetchOrgInvites(org.slug)
      .then((list) => { if (active) setInvites(list) })
      .catch((e) => { if (active) toast.error(adminErrorMessage(e, t)) })
    return () => { active = false }
  }, [org.slug, tick, t])

  async function revoke(email: string) {
    setRevoking(email)
    try {
      await revokeOrgInvite(org.slug, email)
      setInvites((list) => list.filter((i) => i.email !== email))
      toast.success(t('manage.users.invites.revoked', { email, org: org.name }))
    } catch (e) {
      toast.error(adminErrorMessage(e, t))
    } finally {
      setRevoking(null)
    }
  }

  if (invites.length === 0) return null

  return (
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
              disabled={revoking === i.email}
              onClick={() => revoke(i.email)}
              aria-label={t('manage.users.invites.revokeAria', { email: i.email, org: org.name })}
              className="hover:!text-red-600 dark:hover:!text-red-400"
            >
              <CloseIcon size={16} />
            </IconButton>
          </li>
        ))}
      </ul>
    </section>
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
      toast.success(t('manage.users.invites.done', { added: res.added.length, pending: res.pending.length }))
      onDone()
    } catch (err) {
      // 400 names the offending email; don't show the raw server text.
      setError(err instanceof ApiError && err.status === 400
        ? t('manage.users.invites.invalidEmails')
        : adminErrorMessage(err, t))
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
