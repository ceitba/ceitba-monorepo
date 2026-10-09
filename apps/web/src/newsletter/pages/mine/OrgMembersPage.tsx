import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ApiError } from '@/api/client'
import {
  Alert, Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, LoadingRegion, Modal, Skeleton, Switch,
  ToggleGroup, buttonClass, inputClass, selectClass, textareaClass, toast,
} from '@/components/ui'
import { getSession, isStaff } from '@/store/authStore'
import { useAuth } from '@/hooks/useAuth'
import { canViewFollowers } from '@/newsletter/utils/session'
import { MY_ARTICLES_PATH, orgAreaPath } from '@/newsletter/paths'
import {
  fetchOrgMembers, inviteOrgMembers, leaveOrganization, removeOrgMember, revokeOrgInvite, transferOrgAdmin,
  updateOrgMember, type OrgMemberPatch,
} from '../../api/organizations'
import AdminSectionHeader from '../../components/admin/AdminSectionHeader'
import OrgSectionLinks from '../../components/admin/OrgSectionLinks'
import { useAdminContext } from '../../admin/adminContext'
import type { MembershipRole, OrgMember, OrgMembers } from '../../types'

type Confirm =
  | { kind: 'remove'; member: OrgMember }
  | { kind: 'leave' }
  | { kind: 'transfer'; member: OrgMember }

// What POST .../members/invites takes at once (OrganizationMembershipService).
const MAX_INVITES = 50

// Emails typed or pasted one per line, or separated by commas/spaces.
function parseEmails(raw: string): string[] {
  return [...new Set(raw.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))]
}

// The org's admins (and staff) manage who belongs to it: invite by email
// (existing users join at once, others when they first sign in), roles, the
// board titles shown on the portal, removal and the admin handover. The API
// refuses to leave an org without an admin (409 LastOrgAdmin).
export default function OrgMembersPage() {
  // The route is /mine/org/:slug/members, so the param is always there.
  const { slug = '' } = useParams()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { orgName } = useAdminContext()
  const staff = isStaff(profile)
  const allowed = canViewFollowers(slug, profile)

  const [data, setData] = useState<OrgMembers | null>(null)
  const [loadError, setLoadError] = useState<'' | 'forbidden' | 'error'>('')
  const [reloadKey, setReloadKey] = useState(0)
  const [busyId, setBusyId] = useState('')
  const [inviting, setInviting] = useState(false)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [confirmError, setConfirmError] = useState('')

  useEffect(() => {
    if (!allowed) return
    let cancelled = false
    setLoadError('')
    fetchOrgMembers(slug)
      .then((d) => { if (!cancelled) setData(d) })
      .catch((e: unknown) => {
        console.error('newsletter: org members', e)
        if (!cancelled) setLoadError(e instanceof ApiError && e.status === 403 ? 'forbidden' : 'error')
      })
    return () => { cancelled = true }
  }, [slug, allowed, reloadKey])

  function errorMessage(e: unknown): string {
    if (e instanceof ApiError && e.code === 'LastOrgAdmin') return t('admin.members.errors.lastAdmin')
    if (e instanceof ApiError && e.status === 403) return t('admin.members.errors.forbidden')
    return t('admin.members.errors.save')
  }

  function replaceMember(next: OrgMember) {
    setData((d) => d && { ...d, members: d.members.map((m) => (m.userId === next.userId ? next : m)) })
  }

  async function patchMember(member: OrgMember, patch: OrgMemberPatch) {
    setBusyId(member.userId)
    try {
      replaceMember(await updateOrgMember(slug, member.userId, patch))
      // Stepped down to member: no longer allowed here, like after a transfer.
      if (member.userId === profile?.id && member.role === 'admin' && patch.role === 'member' && !staff) {
        await getSession({ force: true })
        navigate(orgAreaPath(slug), { replace: true })
      }
    } catch (e) {
      console.error('newsletter: update member', e)
      toast.error(errorMessage(e))
    } finally {
      setBusyId('')
    }
  }

  async function revoke(email: string) {
    setBusyId(email)
    try {
      await revokeOrgInvite(slug, email)
      setData((d) => d && { ...d, invites: d.invites.filter((i) => i.email !== email) })
    } catch (e) {
      console.error('newsletter: revoke invite', e)
      toast.error(errorMessage(e))
    } finally {
      setBusyId('')
    }
  }

  async function runConfirm() {
    if (!confirm) return
    setConfirmBusy(true)
    setConfirmError('')
    try {
      if (confirm.kind === 'remove') {
        await removeOrgMember(slug, confirm.member.userId)
        setData((d) => d && { ...d, members: d.members.filter((m) => m.userId !== confirm.member.userId) })
        toast.success(t('admin.members.removed'))
        setConfirm(null)
      } else if (confirm.kind === 'transfer') {
        await transferOrgAdmin(slug, confirm.member.userId)
        await getSession({ force: true })
        toast.success(t('admin.members.transferred', { name: confirm.member.name || confirm.member.email }))
        setConfirm(null)
        // No longer an admin: back to the profile, which members can edit.
        navigate(orgAreaPath(slug), { replace: true })
      } else {
        await leaveOrganization(slug)
        await getSession({ force: true })
        toast.success(t('admin.members.left', { org: orgName(slug) }))
        setConfirm(null)
        navigate(MY_ARTICLES_PATH, { replace: true })
      }
    } catch (e) {
      console.error('newsletter: member action', e)
      setConfirmError(errorMessage(e))
    } finally {
      setConfirmBusy(false)
    }
  }

  const header = (
    <>
      <AdminSectionHeader
        title={t('admin.members.title')}
        subtitle={orgName(slug)}
        action={allowed && data ? (
          <Button onClick={() => setInviting(true)}>{t('admin.members.invite')}</Button>
        ) : undefined}
      />
      <OrgSectionLinks slug={slug} current="members" />
    </>
  )

  if (!allowed || loadError === 'forbidden') {
    return (
      <EmptyState
        title={t('admin.members.noAccessTitle')}
        body={t('admin.members.noAccess')}
        action={<Link to={orgAreaPath(slug)} className={buttonClass({ variant: 'outline' })}>{t('admin.followers.backToProfileLong')}</Link>}
      />
    )
  }

  if (loadError) {
    return (
      <ErrorState
        title={t('admin.members.loadError')}
        onRetry={() => setReloadKey((k) => k + 1)}
        backTo={orgAreaPath(slug)}
        backLabel={t('admin.followers.backToProfileLong')}
      />
    )
  }

  const me = data?.members.find((m) => m.userId === profile?.id)
  const others = data?.members.filter((m) => m.userId !== profile?.id) ?? []

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      {header}

      {!data ? (
        <LoadingRegion className="flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
        </LoadingRegion>
      ) : (
        <>
          <ul className="flex flex-col list-none m-0 p-0 border border-border dark:border-night-border rounded-card bg-white dark:bg-night-surface divide-y divide-border dark:divide-night-border">
            {data.members.map((m) => (
              <MemberRow
                key={m.userId}
                member={m}
                isMe={m.userId === profile?.id}
                busy={busyId === m.userId}
                onPatch={(patch) => patchMember(m, patch)}
                onRemove={() => { setConfirmError(''); setConfirm({ kind: 'remove', member: m }) }}
                onTransfer={me?.role === 'admin' && m.role !== 'admin'
                  ? () => { setConfirmError(''); setConfirm({ kind: 'transfer', member: m }) }
                  : undefined}
              />
            ))}
          </ul>

          {data.invites.length > 0 && (
            <section aria-labelledby="org-invites-title" className="flex flex-col gap-3">
              <h3 id="org-invites-title" className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
                {t('admin.members.pendingTitle', { count: data.invites.length })}
              </h3>
              <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('admin.members.pendingHint')}</p>
              <ul className="flex flex-col list-none m-0 p-0 border border-border dark:border-night-border rounded-card bg-white dark:bg-night-surface divide-y divide-border dark:divide-night-border">
                {data.invites.map((i) => (
                  <li key={i.email} className="flex flex-wrap items-center gap-3 p-3">
                    <span className="font-mono text-body-sm text-ink-primary dark:text-night-text truncate flex-1 min-w-0">{i.email}</span>
                    <Badge tone={i.role === 'admin' ? 'info' : 'neutral'}>{t(`admin.members.roles.${i.role}`)}</Badge>
                    <Button variant="ghost" size="sm" loading={busyId === i.email} onClick={() => revoke(i.email)}>
                      {t('admin.members.revoke')}
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {me && (
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Button variant="outline" onClick={() => { setConfirmError(''); setConfirm({ kind: 'leave' }) }}>
                {t('admin.members.leave')}
              </Button>
              {me.role === 'admin' && others.length === 0 && (
                <span className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('admin.members.onlyYou')}</span>
              )}
            </div>
          )}
          {staff && !me && (
            <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('admin.members.staffNote')}</p>
          )}
        </>
      )}

      {inviting && (
        <InviteModal
          slug={slug}
          onClose={() => setInviting(false)}
          onDone={(added, pending) => {
            setInviting(false)
            setData((d) => d && {
              members: [...d.members, ...added],
              invites: [...d.invites.filter((i) => !pending.some((p) => p.email === i.email)), ...pending]
                .sort((a, b) => a.email.localeCompare(b.email)),
            })
            toast.success(t('admin.members.invited', { added: added.length, pending: pending.length }))
          }}
        />
      )}

      {confirm && (
        <ConfirmDialog
          title={t(`admin.members.confirm.${confirm.kind}.title`)}
          body={t(`admin.members.confirm.${confirm.kind}.body`, {
            name: confirm.kind === 'leave' ? '' : confirm.member.name || confirm.member.email,
            org: orgName(slug),
          })}
          confirmLabel={t(`admin.members.confirm.${confirm.kind}.confirm`)}
          danger={confirm.kind !== 'transfer'}
          busy={confirmBusy}
          error={confirmError}
          onConfirm={runConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  )
}

function MemberRow({ member, isMe, busy, onPatch, onRemove, onTransfer }: {
  member: OrgMember
  isMe: boolean
  busy: boolean
  onPatch: (patch: OrgMemberPatch) => void
  onRemove: () => void
  onTransfer?: () => void
}) {
  const { t } = useTranslation()
  const [title, setTitle] = useState(member.title ?? '')

  function saveTitle() {
    if (title.trim() !== (member.title ?? '')) onPatch({ title: title.trim() })
  }

  return (
    <li className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        {member.avatarUrl
          ? <img src={member.avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover bg-page-bg dark:bg-night-raised" />
          : <div className="w-9 h-9 rounded-full bg-page-bg dark:bg-night-raised" aria-hidden="true" />}
        <div className="min-w-0 flex-1">
          <p className="font-display text-body font-bold text-ink-primary dark:text-night-text truncate">
            {member.name || member.email}{isMe && <span className="font-body font-normal text-ink-secondary dark:text-night-muted"> · {t('admin.members.you')}</span>}
          </p>
          {member.name && <p className="font-mono text-label text-ink-secondary dark:text-night-muted truncate">{member.email}</p>}
        </div>
        <ToggleGroup<MembershipRole>
          joined
          label={t('admin.members.roleLabel', { name: member.name || member.email })}
          value={member.role}
          onChange={(role) => { if (role !== member.role) onPatch({ role }) }}
          options={[
            { value: 'member', label: t('admin.members.roles.member') },
            { value: 'admin', label: t('admin.members.roles.admin') },
          ]}
        />
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <Field label={t('admin.members.titleLabel')} hint={t('admin.members.titleHint')}>
          {(p) => (
            <input
              {...p}
              type="text"
              maxLength={60}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveTitle() } }}
              disabled={busy}
              className={inputClass({ className: 'w-56' })}
            />
          )}
        </Field>
        <Switch
          checked={member.showOnPortal}
          onChange={(showOnPortal) => onPatch({ showOnPortal })}
          label={t('admin.members.showOnPortal')}
          disabled={busy}
        />
        <div className="flex flex-wrap gap-2 ml-auto">
          {onTransfer && (
            <Button variant="outline" size="sm" onClick={onTransfer} disabled={busy}>{t('admin.members.transfer')}</Button>
          )}
          {!isMe && (
            <Button variant="dangerGhost" size="sm" onClick={onRemove} disabled={busy}>{t('admin.members.remove')}</Button>
          )}
        </div>
      </div>
    </li>
  )
}

function InviteModal({ slug, onClose, onDone }: {
  slug: string
  onClose: () => void
  onDone: (added: OrgMember[], pending: OrgMembers['invites']) => void
}) {
  const { t } = useTranslation()
  const [raw, setRaw] = useState('')
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
      const res = await inviteOrgMembers(slug, emails, role)
      onDone(res.added, res.pending)
    } catch (err) {
      console.error('newsletter: invite', err)
      // 400 names the offending email ("… 'x@gmail.com': is not allowed to sign in").
      setError(err instanceof ApiError && err.status === 400
        ? t('admin.members.errors.invalidEmails')
        : t('admin.members.errors.save'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={t('admin.members.inviteTitle')}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{t('admin.common.cancel')}</Button>
          <Button type="submit" form="org-invite-form" loading={busy} disabled={!emails.length || tooMany}>
            {t('admin.members.inviteSubmit', { count: emails.length })}
          </Button>
        </>
      }
    >
      <form id="org-invite-form" onSubmit={submit} className="flex flex-col gap-4">
        <Field label={t('admin.members.emailsLabel')} hint={t('admin.members.emailsHint')}>
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
        <Field label={t('admin.members.roleField')}>
          {(p) => (
            <select {...p} value={role} onChange={(e) => setRole(e.target.value as MembershipRole)} className={selectClass()}>
              <option value="member">{t('admin.members.roles.member')}</option>
              <option value="admin">{t('admin.members.roles.admin')}</option>
            </select>
          )}
        </Field>
        {tooMany && <Alert tone="error">{t('admin.members.errors.tooMany', { max: MAX_INVITES })}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}
      </form>
    </Modal>
  )
}
