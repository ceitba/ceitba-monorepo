import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ApiError } from '@/api/client'
import {
  Alert, Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, LoadingRegion, Skeleton, buttonClass,
  inputClass, textareaClass, toast,
} from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { canViewFollowers, isOrgAdmin } from '@/newsletter/utils/session'
import { orgAreaPath } from '@/newsletter/paths'
import {
  connectOrgMail, createAnnouncement, deleteAnnouncement, disconnectOrgMail, fetchAnnouncements, fetchOrgMailStatus,
  sendAnnouncement, sendAnnouncementTest, updateAnnouncement,
} from '../../api/orgMail'
import AdminSectionHeader from '../../components/admin/AdminSectionHeader'
import OrgSectionLinks from '../../components/admin/OrgSectionLinks'
import { useAdminContext } from '../../admin/adminContext'
import { formatArtDateTime } from '../../utils/digest'
import type { OrgAnnouncement, OrgMailStatus } from '../../types'

const POLL_MS = 5000
const MAX_SUBJECT = 150

type Confirm = { kind: 'send'; id: number } | { kind: 'delete'; id: number } | { kind: 'disconnect' }

// An organization's emails to its followers, for its admins: connect the
// org's own @itba.edu.ar Gmail account, write an announcement, send it to
// yourself as a test, then to every follower who didn't opt out.
export default function OrgMailPage() {
  // The route is /mine/org/:slug/mail, so the param is always there.
  const { slug = '' } = useParams()
  const { t, i18n } = useTranslation()
  const { profile } = useAuth()
  const { orgName } = useAdminContext()
  const navigate = useNavigate()
  const location = useLocation()
  const allowed = canViewFollowers(slug, profile)
  // Connecting needs the org's own admin (the callback checks it again).
  const canConnect = isOrgAdmin(slug, profile)

  const [status, setStatus] = useState<OrgMailStatus | null>(null)
  const [items, setItems] = useState<OrgAnnouncement[] | null>(null)
  const [loadError, setLoadError] = useState<'' | 'forbidden' | 'error'>('')
  const [mailResult, setMailResult] = useState<{ ok: boolean; reason: string | null } | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState<'' | 'save' | 'test' | 'connect'>('')
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [confirmError, setConfirmError] = useState('')

  const load = useCallback(() => {
    return Promise.all([fetchOrgMailStatus(slug), fetchAnnouncements(slug)])
      .then(([s, list]) => { setStatus(s); setItems(list); setLoadError('') })
      .catch((e: unknown) => {
        console.error('newsletter: org mail', e)
        setLoadError(e instanceof ApiError && e.status === 403 ? 'forbidden' : 'error')
      })
  }, [slug])

  useEffect(() => { if (allowed) load() }, [allowed, load])

  // Back from Google: ?mail=connected | ?mail=error&reason=<code>; shown
  // once, then stripped so a reload doesn't repeat it.
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const mail = params.get('mail')
    if (mail !== 'connected' && mail !== 'error') return
    setMailResult({ ok: mail === 'connected', reason: params.get('reason') })
    navigate({ pathname: location.pathname, search: '' }, { replace: true })
  }, [location.pathname, location.search, navigate])

  const anySending = items?.some((a) => a.status === 'sending') ?? false
  useEffect(() => {
    if (!anySending) return
    const id = setInterval(() => { load() }, POLL_MS)
    return () => clearInterval(id)
  }, [anySending, load])

  function errorText(e: unknown): string {
    const code = e instanceof ApiError ? e.code : undefined
    const known = ['OrgMailNotConnected', 'OrgMailWeeklyLimit', 'OrgMailNoRecipients', 'MailDisabled',
      'OrgMailNotDraft', 'OrgMailTestFailed', 'MAIL_QUOTA_EXHAUSTED', 'MAIL_SENDER_NOT_CONNECTED']
    if (code && known.includes(code)) return t(`admin.orgMail.errors.${code}`)
    if (e instanceof ApiError && e.status === 400) return t('admin.orgMail.errors.invalid')
    return t('admin.orgMail.errors.generic')
  }

  function resetForm() {
    setEditing(null)
    setSubject('')
    setBody('')
  }

  // Saves the form as a draft (new or the one being edited); returns its id.
  async function saveDraft(): Promise<number | null> {
    if (!subject.trim() || !body.trim()) {
      setError(t('admin.orgMail.errors.empty'))
      return null
    }
    const saved = editing == null
      ? await createAnnouncement(slug, subject, body)
      : await updateAnnouncement(slug, editing, subject, body)
    setEditing(saved.id)
    await load()
    return saved.id
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    setBusy('save')
    setError('')
    try {
      if (await saveDraft() != null) toast.success(t('admin.orgMail.saved'))
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy('')
    }
  }

  async function handleTest() {
    setBusy('test')
    setError('')
    try {
      const id = await saveDraft()
      if (id == null) return
      await sendAnnouncementTest(slug, id)
      toast.success(t('admin.orgMail.testSent', { email: profile?.email ?? '' }))
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy('')
    }
  }

  async function askSend() {
    setError('')
    try {
      const id = await saveDraft()
      if (id != null) { setConfirmError(''); setConfirm({ kind: 'send', id }) }
    } catch (err) {
      setError(errorText(err))
    }
  }

  async function handleConnect() {
    setBusy('connect')
    try {
      const { authorizationUrl } = await connectOrgMail(slug)
      window.location.assign(authorizationUrl)
    } catch (err) {
      console.error('newsletter: connect org mail', err)
      setError(errorText(err))
      setBusy('')
    }
  }

  async function runConfirm() {
    if (!confirm) return
    setConfirmBusy(true)
    setConfirmError('')
    try {
      if (confirm.kind === 'send') {
        await sendAnnouncement(slug, confirm.id)
        toast.success(t('admin.orgMail.sending'))
        resetForm()
      } else if (confirm.kind === 'delete') {
        await deleteAnnouncement(slug, confirm.id)
        if (editing === confirm.id) resetForm()
      } else {
        await disconnectOrgMail(slug)
      }
      setConfirm(null)
      await load()
    } catch (err) {
      setConfirmError(errorText(err))
    } finally {
      setConfirmBusy(false)
    }
  }

  const header = (
    <>
      <AdminSectionHeader title={t('admin.orgMail.title')} subtitle={orgName(slug)} />
      <OrgSectionLinks slug={slug} current="mail" />
    </>
  )

  if (!allowed || loadError === 'forbidden') {
    return (
      <EmptyState
        title={t('admin.orgMail.noAccessTitle')}
        body={t('admin.orgMail.noAccess')}
        action={<Link to={orgAreaPath(slug)} className={buttonClass({ variant: 'outline' })}>{t('admin.followers.backToProfileLong')}</Link>}
      />
    )
  }
  if (loadError) {
    return (
      <div className="flex flex-col gap-6 max-w-3xl">
        {header}
        <ErrorState title={t('admin.orgMail.loadError')} onRetry={() => { load() }} />
      </div>
    )
  }
  if (!status || !items) {
    return (
      <div className="flex flex-col gap-6 max-w-3xl">
        {header}
        <LoadingRegion className="flex flex-col gap-4">
          <Skeleton className="h-28 w-full rounded-card" />
          <Skeleton className="h-64 w-full rounded-card" />
        </LoadingRegion>
      </div>
    )
  }

  const account = status.account
  const connected = account?.status === 'connected'
  const when = (iso: string | null) => (iso ? formatArtDateTime(iso, i18n.language) : '')
  const weeklyLeft = Math.max(0, status.weeklyLimit - status.sentThisWeek)
  const confirmName = confirm?.kind === 'send' || confirm?.kind === 'delete'
    ? items.find((a) => a.id === confirm.id)?.subject ?? '' : ''

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      {header}

      {mailResult && (
        <Alert tone={mailResult.ok ? 'success' : 'error'} onDismiss={() => setMailResult(null)}>
          {mailResult.ok
            ? t('admin.orgMail.connected')
            : t(`admin.orgMail.connectErrors.${mailResult.reason ?? 'exchange_failed'}`, {
              defaultValue: t('admin.orgMail.connectErrors.exchange_failed'),
              domain: status.allowedDomain,
            })}
        </Alert>
      )}

      {!status.mailEnabled && <Alert tone="warning">{t('admin.orgMail.errors.MailDisabled')}</Alert>}

      {/* The org's Gmail account */}
      <section className="bg-white dark:bg-night-surface rounded-card border border-border dark:border-night-border shadow-card p-4 sm:p-5 flex flex-col gap-3">
        <h3 className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">{t('admin.orgMail.accountTitle')}</h3>
        {!account ? (
          <>
            <p className="font-body text-body-sm text-ink-primary dark:text-night-text">{t('admin.orgMail.missing', { domain: status.allowedDomain })}</p>
            <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('admin.orgMail.missingHelp')}</p>
          </>
        ) : (
          <>
            <p className="font-body text-body font-semibold text-ink-primary dark:text-night-text break-all">{account.email}</p>
            <p className={`font-body text-body-sm font-semibold ${connected ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-800 dark:text-amber-300'}`}>
              {t(connected ? 'admin.orgMail.statusConnected' : 'admin.orgMail.statusBroken')}
            </p>
            <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-body text-body-sm">
              <div>
                <dt className="text-ink-secondary dark:text-night-muted">{t('admin.orgMail.quota')}</dt>
                <dd className="text-ink-primary dark:text-night-text tabular-nums">
                  {status.quota ? t('admin.orgMail.quotaValue', { remaining: status.quota.remaining, limit: status.quota.limit }) : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-ink-secondary dark:text-night-muted">{t('admin.orgMail.weekly')}</dt>
                <dd className="text-ink-primary dark:text-night-text tabular-nums">{t('admin.orgMail.weeklyValue', { left: weeklyLeft, limit: status.weeklyLimit })}</dd>
              </div>
              <div>
                <dt className="text-ink-secondary dark:text-night-muted">{t('admin.orgMail.audience')}</dt>
                <dd className="text-ink-primary dark:text-night-text tabular-nums">{t('admin.orgMail.audienceValue', { count: status.recipientEstimate })}</dd>
              </div>
            </dl>
          </>
        )}
        <div className="flex flex-wrap gap-2">
          {canConnect && (!account || !connected) && (
            <Button variant="accent" onClick={handleConnect} loading={busy === 'connect'}>
              {account ? t('admin.orgMail.reconnect') : t('admin.orgMail.connect')}
            </Button>
          )}
          {account && (
            <Button variant="dangerGhost" onClick={() => { setConfirmError(''); setConfirm({ kind: 'disconnect' }) }}>
              {t('admin.orgMail.disconnect')}
            </Button>
          )}
        </div>
        {!canConnect && !account && (
          <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('admin.orgMail.adminOnlyConnect')}</p>
        )}
      </section>

      {/* Compose */}
      <form onSubmit={handleSave} className="bg-white dark:bg-night-surface rounded-card border border-border dark:border-night-border shadow-card p-4 sm:p-6 flex flex-col gap-4">
        <h3 className="font-display text-h5 font-bold text-ink-primary dark:text-night-text">
          {editing == null ? t('admin.orgMail.newTitle') : t('admin.orgMail.editTitle')}
        </h3>
        <Field label={t('admin.orgMail.subject')}>
          {(p) => <input {...p} type="text" maxLength={MAX_SUBJECT} value={subject} onChange={(e) => setSubject(e.target.value)} className={inputClass()} />}
        </Field>
        <Field label={t('admin.orgMail.body')} hint={t('admin.orgMail.bodyHint')}>
          {(p) => <textarea {...p} rows={10} value={body} onChange={(e) => setBody(e.target.value)} className={textareaClass()} />}
        </Field>
        {error && <Alert tone="error">{error}</Alert>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="outline" loading={busy === 'save'}>{t('admin.orgMail.saveDraft')}</Button>
          <Button variant="outline" onClick={handleTest} loading={busy === 'test'} disabled={!connected}>
            {t('admin.orgMail.sendTest')}
          </Button>
          <Button onClick={askSend} disabled={!connected || weeklyLeft === 0 || busy !== ''}>
            {t('admin.orgMail.send')}
          </Button>
          {editing != null && (
            <Button variant="ghost" onClick={resetForm}>{t('admin.orgMail.newInstead')}</Button>
          )}
        </div>
        <p className="font-body text-label text-ink-secondary dark:text-night-muted">{t('admin.orgMail.footerNote')}</p>
      </form>

      {/* History */}
      <section className="flex flex-col gap-3">
        <h3 className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">{t('admin.orgMail.history')}</h3>
        {items.length === 0 ? (
          <EmptyState compact title={t('admin.orgMail.noHistory')} />
        ) : (
          <ul className="flex flex-col list-none m-0 p-0 border border-border dark:border-night-border rounded-card bg-white dark:bg-night-surface divide-y divide-border dark:divide-night-border">
            {items.map((a) => (
              <li key={a.id} className="flex flex-col sm:flex-row sm:items-center gap-2 p-3">
                <div className="min-w-0 flex-1">
                  <p className="font-body text-body-sm font-semibold text-ink-primary dark:text-night-text truncate">{a.subject}</p>
                  <p className="font-mono text-label text-ink-secondary dark:text-night-muted">
                    {a.status === 'draft'
                      ? t('admin.orgMail.draftOf', { when: when(a.createdAt) })
                      : t('admin.orgMail.progress', { sent: a.sent, failed: a.failed, pending: a.pending, when: when(a.sentAt) })}
                  </p>
                </div>
                <Badge tone={a.status === 'sent' ? 'success' : a.status === 'sending' ? 'info' : 'neutral'}>
                  {t(`admin.orgMail.status.${a.status}`)}
                </Badge>
                {a.status === 'draft' && (
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => { setEditing(a.id); setSubject(a.subject); setBody(a.body); setError('') }}>
                      {t('admin.common.edit')}
                    </Button>
                    <Button variant="dangerGhost" size="sm" onClick={() => { setConfirmError(''); setConfirm({ kind: 'delete', id: a.id }) }}>
                      {t('admin.common.delete')}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {confirm && (
        <ConfirmDialog
          title={t(`admin.orgMail.confirm.${confirm.kind}.title`)}
          body={t(`admin.orgMail.confirm.${confirm.kind}.body`, {
            count: status.recipientEstimate, subject: confirmName, email: account?.email ?? '',
          })}
          confirmLabel={t(`admin.orgMail.confirm.${confirm.kind}.confirm`)}
          danger={confirm.kind !== 'send'}
          busy={confirmBusy}
          error={confirmError}
          onConfirm={runConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  )
}
