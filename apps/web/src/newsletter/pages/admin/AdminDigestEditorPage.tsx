import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useBlocker, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ApiError } from '@/api/client'
import {
  Alert, Button, ConfirmDialog, ErrorState, Field, LoadingRegion, Skeleton, SkeletonForm, inputClass, textareaClass, toast,
} from '@/components/ui'
import {
  cancelDigest, deleteDigest, fetchDigest, fetchDigestQuota, fetchDigestPreview, sendDigestNow, sendDigestTest, updateDigest,
} from '../../api/digests'
import { isStaff } from '../../store/authStore'
import { setUnsavedChanges, shouldBlockNavigation } from '../../store/unsavedStore'
import AdminSectionHeader from '../../components/admin/AdminSectionHeader'
import DigestStatusBadge from '../../components/admin/DigestStatusBadge'
import DigestCounts from '../../components/admin/DigestCounts'
import DigestStatsPanel from '../../components/admin/DigestStatsPanel'
import { formatDate } from '../../utils/dates'
import {
  SENDING_POLL_MS, artInputToInstant, defaultAutoSendInput, digestErrorMessage, formatArtDateTime,
  formatWeekRange, instantToArtInput, nowArtInput, shortTime,
} from '../../utils/digest'
import { newsletterPath } from '@/newsletter/paths'
import type { DigestDetail } from '../../types'

// The editable part of a digest, shaped for the inputs.
interface DigestForm {
  subject: string
  intro: string
  excludedArticleIds: string[]
  excludedEventIds: string[]
  autoSend: boolean
  // "YYYY-MM-DDTHH:mm" Buenos Aires wall clock, for <input type="datetime-local">.
  autoSendInput: string
}

type ExcludedKey = 'excludedArticleIds' | 'excludedEventIds'
type LoadState = 'loading' | 'ready' | 'notFound' | 'error'
type BusyAction = 'test' | 'send' | 'cancel' | 'delete'
type DialogKind = 'send' | 'cancel' | 'delete'

function formFrom(digest: DigestDetail): DigestForm {
  return {
    subject: digest.subject ?? '',
    intro: digest.intro ?? '',
    excludedArticleIds: (digest.articles ?? []).filter((a) => a.excluded).map((a) => a.id),
    excludedEventIds: (digest.events ?? []).filter((e) => e.excluded).map((e) => e.id),
    autoSend: Boolean(digest.autoSendAt),
    autoSendInput: digest.autoSendAt
      ? instantToArtInput(digest.autoSendAt)
      : defaultAutoSendInput(digest.weekStart),
  }
}

const sameIds = (a: string[], b: string[]): boolean => a.length === b.length && [...a].sort().join() === [...b].sort().join()

function isDirty(form: DigestForm, base: DigestForm): boolean {
  return form.subject !== base.subject
    || form.intro !== base.intro
    || !sameIds(form.excludedArticleIds, base.excludedArticleIds)
    || !sameIds(form.excludedEventIds, base.excludedEventIds)
    || form.autoSend !== base.autoSend
    || (form.autoSend && form.autoSendInput !== base.autoSendInput)
}

const panel = 'bg-white dark:bg-night-surface rounded-card border border-border dark:border-night-border shadow-card'

export default function AdminDigestEditorPage() {
  // The route is /admin/digests/:id, so the param is always there.
  const { id = '' } = useParams()
  const { t, i18n } = useTranslation()
  const staff = isStaff()
  const navigate = useNavigate()

  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [reloadKey, setReloadKey] = useState(0)
  const [digest, setDigest] = useState<DigestDetail | null>(null)
  const [form, setForm] = useState<DigestForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null)
  const [dialog, setDialog] = useState<DialogKind | null>(null)
  // A failed send/cancel/delete shows inside its open dialog.
  const [dialogError, setDialogError] = useState('')
  const [error, setError] = useState('')
  const [formError, setFormError] = useState('')
  const [previewVersion, setPreviewVersion] = useState(0)
  // 'connected' | 'broken' | 'missing' | null (unknown yet / request failed).
  // Only warns; a send simply waits until a sender is connected.
  const [senderStatus, setSenderStatus] = useState<string | null>(null)
  // Sequence guard: every fetch/mutation takes a number, and a response is
  // applied only if nothing newer started (or finished) since. Stops a slow
  // poll from overwriting the result of a save/send/cancel.
  const seqRef = useRef(0)
  const nextSeq = () => ++seqRef.current

  // Replace the server copy and reset the form to it.
  const applyDigest = useCallback((d: DigestDetail) => {
    setDigest(d)
    setForm(formFrom(d))
  }, [])

  useEffect(() => {
    if (!staff) return
    let cancelled = false
    const seq = ++seqRef.current
    setLoadState('loading')
    fetchDigest(id)
      .then((d) => { if (!cancelled && seq === seqRef.current) { applyDigest(d); setLoadState('ready') } })
      .catch((err: unknown) => { if (!cancelled && seq === seqRef.current) setLoadState(err instanceof ApiError && err.status === 404 ? 'notFound' : 'error') })
    return () => { cancelled = true }
  }, [id, staff, reloadKey, applyDigest])

  // While sending, refresh progress. The form is read-only then, so
  // overwriting it with the server copy loses nothing.
  const sending = digest?.status === 'sending'
  useEffect(() => {
    if (!sending) return
    const timer = setInterval(() => {
      const seq = ++seqRef.current
      fetchDigest(id)
        .then((d) => { if (seq === seqRef.current) applyDigest(d) })
        .catch((err: unknown) => console.error('newsletter admin: digest poll (retrying)', err))
    }, SENDING_POLL_MS)
    return () => clearInterval(timer)
  }, [sending, id, applyDigest])

  useEffect(() => {
    if (!staff) return
    let cancelled = false
    fetchDigestQuota()
      .then((q) => { if (!cancelled) setSenderStatus(q?.senderStatus ?? null) })
      .catch((err: unknown) => console.error('newsletter admin: sender status (notice skipped)', err))
    return () => { cancelled = true }
  }, [staff, id])

  const base = useMemo(() => (digest ? formFrom(digest) : null), [digest])
  const dirty = form && base ? isDirty(form, base) : false

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

  if (!staff) return <Navigate to={newsletterPath('/admin/articles')} replace />

  const back = { to: newsletterPath('/admin/digests'), label: t('admin.digests.back') }

  if (loadState === 'loading') {
    return (
      <div className="flex flex-col gap-6">
        <AdminSectionHeader title={t('admin.nav.digests')} back={back} />
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <SkeletonForm fields={4} />
          <LoadingRegion><Skeleton className="h-[420px] w-full rounded-card" /></LoadingRegion>
        </div>
      </div>
    )
  }

  if (loadState !== 'ready') {
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

  // Unreachable: 'ready' is only set right after applyDigest() filled both.
  if (!digest || !form) return null

  const editable = digest.status === 'draft'
  // The updaters below run only while the form is shown, i.e. loaded.
  const set = <K extends keyof DigestForm>(key: K, value: DigestForm[K]) => { setForm((f) => ({ ...(f as DigestForm), [key]: value })); setFormError('') }

  function toggleExcluded(key: ExcludedKey, itemId: string) {
    setForm((f) => {
      const list = (f as DigestForm)[key]
      return { ...(f as DigestForm), [key]: list.includes(itemId) ? list.filter((x) => x !== itemId) : [...list, itemId] }
    })
  }

  // A 409 means someone (or the auto-send job) moved it out of draft: show
  // the real state instead of a form that can't be saved.
  async function refreshAfterConflict(err: unknown) {
    if (err instanceof ApiError && err.status === 409) {
      const seq = nextSeq()
      try {
        const d = await fetchDigest(id)
        if (seq === seqRef.current) applyDigest(d)
      } catch { /* keep current view */ }
    }
  }

  function openDialog(kind: DialogKind) {
    setDialogError('')
    setDialog(kind)
  }

  async function handleSave(e?: FormEvent<HTMLFormElement>) {
    e?.preventDefault()
    if (!editable || saving) return
    // Never null here (the form is rendered); narrows it for TypeScript.
    if (!form) return
    if (!form.subject.trim()) { setFormError(t('admin.digests.editor.errors.subject')); return }
    const autoSendAt = form.autoSend ? artInputToInstant(form.autoSendInput) : null
    if (form.autoSend && !autoSendAt) { setFormError(t('admin.digests.editor.errors.autoSendAt')); return }
    if (autoSendAt && Date.parse(autoSendAt) <= Date.now()) { setFormError(t('admin.digests.editor.errors.autoSendPast')); return }

    setSaving(true)
    setError('')
    nextSeq()
    try {
      const updated = await updateDigest(id, {
        subject: form.subject.trim(),
        intro: form.intro,
        excludedArticleIds: form.excludedArticleIds,
        excludedEventIds: form.excludedEventIds,
        autoSendAt,
      })
      nextSeq()
      applyDigest(updated)
      setPreviewVersion((v) => v + 1)
      toast.success(t('admin.digests.editor.saved'))
    } catch (err) {
      setError(digestErrorMessage(err, t, 'admin.digests.errors.save'))
      await refreshAfterConflict(err)
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    setBusyAction('test')
    setError('')
    try {
      const { sentTo } = await sendDigestTest(id)
      toast.success(t('admin.digests.editor.testSent', { email: sentTo }))
    } catch (err) {
      // 429 MAIL_QUOTA_EXHAUSTED: says when the quota frees up.
      // 409 MAIL_SENDER_NOT_CONNECTED / MAIL_DISABLED have their own messages.
      if (err instanceof ApiError && err.code === 'MAIL_SENDER_NOT_CONNECTED') setSenderStatus((s) => (s === 'broken' ? s : 'missing'))
      setError(digestErrorMessage(err, t, 'admin.digests.errors.test', i18n.language))
    } finally {
      setBusyAction(null)
    }
  }

  async function handleSendNow() {
    setBusyAction('send')
    setDialogError('')
    nextSeq()
    try {
      const sent = await sendDigestNow(id)
      nextSeq()
      applyDigest(sent)
      setDialog(null)
      toast.success(t('admin.digests.editor.sendStarted'))
    } catch (err) {
      setDialogError(digestErrorMessage(err, t, 'admin.digests.errors.send'))
      await refreshAfterConflict(err)
    } finally {
      setBusyAction(null)
    }
  }

  async function handleCancel() {
    setBusyAction('cancel')
    setDialogError('')
    nextSeq()
    try {
      const cancelled = await cancelDigest(id)
      nextSeq()
      applyDigest(cancelled)
      setDialog(null)
      toast.success(sending ? t('admin.digests.editor.stopped') : t('admin.digests.editor.cancelled'))
    } catch (err) {
      setDialogError(digestErrorMessage(err, t, 'admin.digests.errors.cancel'))
      await refreshAfterConflict(err)
    } finally {
      setBusyAction(null)
    }
  }

  async function handleDelete() {
    setBusyAction('delete')
    setDialogError('')
    nextSeq()
    try {
      await deleteDigest(id)
      // Unsaved edits of a deleted issue must not hold the navigation back.
      setUnsavedChanges(false)
      toast.success(t('admin.digests.editor.deleted'))
      navigate(newsletterPath('/admin/digests'), { replace: true })
    } catch (err) {
      setDialogError(digestErrorMessage(err, t, 'admin.digests.errors.delete'))
      await refreshAfterConflict(err)
      setBusyAction(null)
    }
  }

  const includedArticles = digest.articles.filter((a) => !form.excludedArticleIds.includes(a.id)).length
  const includedEvents = digest.events.filter((e) => !form.excludedEventIds.includes(e.id)).length
  const actionsLocked = saving || busyAction != null
  // The API refuses to send an issue with nothing in it (409 DIGEST_EMPTY).
  const empty = includedArticles + includedEvents === 0
  const readyToSend = !dirty && !empty
  // Only relevant while mail can still go out for this issue.
  const senderNotConnected = (editable || sending) && (senderStatus === 'missing' || senderStatus === 'broken')

  return (
    <div className="flex flex-col gap-6">
      <AdminSectionHeader
        back={back}
        title={formatWeekRange(digest.weekStart, digest.weekEnd, i18n.language)}
        badge={<DigestStatusBadge status={digest.status} />}
        subtitle={
          <div className="flex flex-col gap-1">
            {digest.status === 'sent' && digest.sentAt ? (
              <p>{t('admin.digests.sentAt', { when: formatArtDateTime(digest.sentAt, i18n.language) })}</p>
            ) : digest.recipientEstimate != null && (
              // The API only estimates recipients for drafts.
              <p>{t('admin.digests.editor.recipientEstimate', { count: digest.recipientEstimate })}</p>
            )}
            {sending && digest.estimatedFinishAt && (
              <p>{t('admin.digests.finishesAt', { when: formatArtDateTime(digest.estimatedFinishAt, i18n.language) })}</p>
            )}
          </div>
        }
      />

      {sending && digest.resumeAt && (
        <Alert tone="warning">{t('admin.digests.resumesAt', { when: formatArtDateTime(digest.resumeAt, i18n.language) })}</Alert>
      )}

      {error && <Alert tone="error" onDismiss={() => setError('')}>{error}</Alert>}

      {senderNotConnected && (
        <Alert
          tone="warning"
          action={
            <Link to={back.to} className="font-mono text-label uppercase tracking-widest underline underline-offset-2 min-h-[44px] inline-flex items-center">
              {t('admin.digests.editor.senderNotice.link')}
            </Link>
          }
        >
          {t(`admin.digests.editor.senderNotice.${senderStatus}`)}
        </Alert>
      )}

      {!editable && (
        <div className={`${panel} p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4`}>
          <p className="flex-1 font-body text-body-sm text-ink-secondary dark:text-night-muted">
            {t(`admin.digests.editor.readOnly.${digest.status}`, { defaultValue: t('admin.digests.editor.readOnly.cancelled') })}
          </p>
          <DigestCounts counts={digest.counts} />
          <div className="flex flex-col sm:flex-row gap-2 sm:flex-shrink-0">
            {sending ? (
              <Button variant="dangerGhost" onClick={() => openDialog('cancel')} disabled={actionsLocked}>
                {t('admin.digests.editor.stopSending')}
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={handleTest} loading={busyAction === 'test'} loadingLabel={t('admin.digests.editor.testing')} disabled={actionsLocked}>
                  {t('admin.digests.editor.test')}
                </Button>
                <Button variant="dangerGhost" onClick={() => openDialog('delete')} disabled={actionsLocked}>
                  {t('admin.digests.editor.delete')}
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Stats re-fetch on status changes and, while sending, as the sent count moves. */}
      {(digest.status === 'sent' || sending || (digest.status === 'cancelled' && digest.counts?.sent > 0)) && (
        <DigestStatsPanel id={id} refreshKey={`${digest.status}:${sending ? digest.counts?.sent ?? 0 : ''}`} />
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6 items-start">
        {/* ── Editor column ─────────────────────────────── */}
        <form onSubmit={handleSave} noValidate className="flex flex-col gap-6 min-w-0">
          <fieldset disabled={!editable} className={`${panel} p-4 sm:p-6 flex flex-col gap-5 min-w-0`}>
            <legend className="sr-only">{t('admin.digests.editor.contentLegend')}</legend>
            <Field label={t('admin.digests.editor.subject')} hint={t('admin.digests.editor.charCount', { count: form.subject.length, max: SUBJECT_MAX })}>
              {(p) => (
                <input {...p} type="text" value={form.subject} onChange={(e) => set('subject', e.target.value)} maxLength={SUBJECT_MAX} className={inputClass()} />
              )}
            </Field>
            <Field
              label={t('admin.digests.editor.intro')}
              hint={t('admin.digests.editor.introHint', { count: form.intro.length, max: INTRO_MAX })}
            >
              {(p) => (
                <textarea {...p} rows={4} value={form.intro} onChange={(e) => set('intro', e.target.value)} maxLength={INTRO_MAX} className={textareaClass()} />
              )}
            </Field>
          </fieldset>

          <Checklist
            title={t('admin.digests.editor.articles', { included: includedArticles, total: digest.articles.length })}
            empty={t('admin.digests.editor.noArticles')}
            disabled={!editable}
            items={digest.articles.map((a) => ({
              id: a.id,
              title: a.title,
              org: a.organization?.name,
              meta: a.publishedAt ? formatDate(a.publishedAt, i18n.language) : '',
              excluded: form.excludedArticleIds.includes(a.id),
            }))}
            onToggle={(itemId) => toggleExcluded('excludedArticleIds', itemId)}
          />

          <Checklist
            title={t('admin.digests.editor.events', { included: includedEvents, total: digest.events.length })}
            empty={t('admin.digests.editor.noEvents')}
            disabled={!editable}
            items={digest.events.map((e) => ({
              id: e.id,
              title: e.title,
              org: e.organization?.name,
              meta: [
                formatDate(e.eventDate, i18n.language, { weekday: 'short', day: 'numeric', month: 'short' }),
                e.startTime ? t('events.timeRange', { start: shortTime(e.startTime), end: shortTime(e.endTime) }) : '',
                e.location,
              ].filter(Boolean).join(' · '),
              excluded: form.excludedEventIds.includes(e.id),
            }))}
            onToggle={(itemId) => toggleExcluded('excludedEventIds', itemId)}
          />

          <fieldset disabled={!editable} className={`${panel} p-4 sm:p-6 flex flex-col gap-4 min-w-0`}>
            <legend className="sr-only">{t('admin.digests.editor.autoSend')}</legend>
            <label className="flex items-start gap-3 min-h-[44px] cursor-pointer">
              <input
                type="checkbox"
                checked={form.autoSend}
                onChange={(e) => set('autoSend', e.target.checked)}
                className="mt-1 w-5 h-5 accent-primary"
              />
              <span className="flex flex-col">
                <span className="font-body text-body-sm font-semibold text-ink-primary dark:text-night-text">{t('admin.digests.editor.autoSend')}</span>
                <span className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('admin.digests.editor.autoSendHint')}</span>
              </span>
            </label>
            {form.autoSend && (
              <Field label={t('admin.digests.editor.autoSendAt')} hint={t('admin.digests.editor.timezone')} className="sm:max-w-xs">
                {(p) => (
                  <input
                    {...p}
                    type="datetime-local"
                    value={form.autoSendInput}
                    onChange={(e) => set('autoSendInput', e.target.value)}
                    min={nowArtInput()}
                    className={inputClass()}
                  />
                )}
              </Field>
            )}
          </fieldset>

          {formError && <Alert tone="error">{formError}</Alert>}

          {editable && (
            <div className={`${panel} p-4 sm:p-6 flex flex-col gap-3`}>
              <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2">
                <Button type="submit" loading={saving} loadingLabel={t('admin.form.saving')} disabled={!dirty || busyAction != null}>
                  {t('admin.digests.editor.save')}
                </Button>
                <Button variant="outline" onClick={handleTest} loading={busyAction === 'test'} loadingLabel={t('admin.digests.editor.testing')} disabled={dirty || actionsLocked}>
                  {t('admin.digests.editor.test')}
                </Button>
                <Button variant={readyToSend ? 'accent' : 'outline'} onClick={() => openDialog('send')} disabled={!readyToSend || actionsLocked}>
                  {t('admin.digests.editor.sendNow')}
                </Button>
                <div className="flex flex-col sm:flex-row gap-2 sm:ml-auto">
                  <Button variant="dangerGhost" onClick={() => openDialog('cancel')} disabled={actionsLocked}>
                    {t('admin.digests.editor.cancel')}
                  </Button>
                  <Button variant="dangerGhost" onClick={() => openDialog('delete')} disabled={actionsLocked}>
                    {t('admin.digests.editor.delete')}
                  </Button>
                </div>
              </div>
              {empty && <Alert tone="warning">{t('admin.digests.editor.emptyWarning')}</Alert>}
              <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted" aria-live="polite">
                {dirty ? t('admin.digests.editor.saveFirst') : t('admin.digests.editor.upToDate')}
              </p>
            </div>
          )}
        </form>

        {/* ── Preview column ────────────────────────────── */}
        <DigestPreview id={id} version={previewVersion} stale={dirty} />
      </div>

      {dialog === 'send' && (
        <ConfirmDialog
          danger={false}
          title={t('admin.digests.editor.sendDialog.title')}
          body={
            <>
              <p>
                {digest.recipientEstimate != null
                  ? t('admin.digests.editor.sendDialog.body', { count: digest.recipientEstimate })
                  : t('admin.digests.editor.sendDialog.bodyUnknown')}
              </p>
              {senderNotConnected && (
                <Alert tone="warning" className="mt-3">{t(`admin.digests.editor.sendDialog.senderWarning.${senderStatus}`)}</Alert>
              )}
            </>
          }
          confirmLabel={t('admin.digests.editor.sendDialog.confirm')}
          cancelLabel={t('admin.digests.editor.sendDialog.keep')}
          busy={busyAction === 'send'}
          error={dialogError || undefined}
          onConfirm={handleSendNow}
          onCancel={() => setDialog(null)}
        />
      )}

      {dialog === 'cancel' && (
        <ConfirmDialog
          title={sending ? t('admin.digests.editor.cancelDialog.titleSending') : t('admin.digests.editor.cancelDialog.title')}
          body={sending ? t('admin.digests.editor.cancelDialog.bodySending') : t('admin.digests.editor.cancelDialog.body')}
          confirmLabel={sending ? t('admin.digests.editor.cancelDialog.confirmSending') : t('admin.digests.editor.cancelDialog.confirm')}
          cancelLabel={t('admin.digests.editor.cancelDialog.keep')}
          busy={busyAction === 'cancel'}
          error={dialogError || undefined}
          onConfirm={handleCancel}
          onCancel={() => setDialog(null)}
        />
      )}

      {dialog === 'delete' && (
        <ConfirmDialog
          title={t('admin.digests.editor.deleteDialog.title')}
          body={t(`admin.digests.editor.deleteDialog.body_${digest.status === 'sent' ? 'sent' : 'other'}`)}
          confirmLabel={t('admin.digests.editor.deleteDialog.confirm')}
          cancelLabel={t('admin.digests.editor.deleteDialog.keep')}
          busy={busyAction === 'delete'}
          error={dialogError || undefined}
          onConfirm={handleDelete}
          onCancel={() => setDialog(null)}
        />
      )}

      {blocker.state === 'blocked' && (
        <ConfirmDialog
          title={t('admin.digests.editor.leaveDialog.title')}
          body={t('admin.digests.editor.leaveDialog.body')}
          confirmLabel={t('admin.digests.editor.leaveDialog.confirm')}
          cancelLabel={t('admin.digests.editor.leaveDialog.stay')}
          onConfirm={() => blocker.proceed()}
          onCancel={() => blocker.reset()}
        />
      )}
    </div>
  )
}

interface ChecklistItem {
  id: string
  title: string
  org?: string
  meta: string
  excluded: boolean
}

interface ChecklistProps {
  title: string
  empty: string
  items: ChecklistItem[]
  disabled: boolean
  onToggle: (itemId: string) => void
}

function Checklist({ title, empty, items, disabled, onToggle }: ChecklistProps) {
  return (
    <section className={`${panel} min-w-0`}>
      <h3 className="px-4 sm:px-6 py-3 border-b border-border dark:border-night-border font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
        {title}
      </h3>
      {items.length === 0 ? (
        <p className="px-4 sm:px-6 py-6 font-body text-body-sm text-ink-secondary dark:text-night-muted">{empty}</p>
      ) : (
        <ul className="list-none m-0 p-0 divide-y divide-border dark:divide-night-border">
          {items.map((item) => (
            <li key={item.id}>
              <label className={`flex items-start gap-3 px-4 sm:px-6 py-3 min-h-[44px] ${disabled ? '' : 'cursor-pointer hover:bg-page-bg dark:hover:bg-night-raised'} transition-colors duration-100`}>
                <input
                  type="checkbox"
                  checked={!item.excluded}
                  disabled={disabled}
                  onChange={() => onToggle(item.id)}
                  className="mt-0.5 w-5 h-5 flex-shrink-0 accent-primary"
                />
                <span className="flex flex-col min-w-0">
                  <span className={`font-body text-body-sm font-semibold ${item.excluded ? 'line-through text-ink-secondary dark:text-night-muted' : 'text-ink-primary dark:text-night-text'}`}>
                    {item.title}
                  </span>
                  <span className="font-mono text-label text-ink-secondary dark:text-night-muted break-words">
                    {[item.org, item.meta].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// Rendered email in a sandboxed iframe. Links open in a new tab (the email
// HTML gets a <base target="_blank">); scripts never run.
interface DigestPreviewProps {
  id: string
  version: number
  stale: boolean
}

function DigestPreview({ id, version, stale }: DigestPreviewProps) {
  const { t } = useTranslation()
  const [html, setHtml] = useState('')
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [retry, setRetry] = useState(0)
  const reqRef = useRef(0)

  useEffect(() => {
    const req = ++reqRef.current
    setState('loading')
    fetchDigestPreview(id)
      .then((text) => { if (req === reqRef.current) { setHtml(withBlankTargets(text)); setState('ready') } })
      .catch((err: unknown) => {
        console.error('newsletter admin: digest preview', err)
        if (req === reqRef.current) setState('error')
      })
  }, [id, version, retry])

  return (
    <section className={`${panel} flex flex-col min-w-0 xl:sticky xl:top-24`}>
      <h3 className="px-4 py-3 border-b border-border dark:border-night-border font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
        {t('admin.digests.preview.title')}
      </h3>
      {stale && (
        <p className="px-4 py-2 bg-amber-50 dark:bg-amber-950/40 font-body text-body-sm text-amber-800 dark:text-amber-300 border-b border-border dark:border-night-border">
          {t('admin.digests.preview.stale')}
        </p>
      )}
      <div className="relative h-[70vh] min-h-[420px] bg-page-bg dark:bg-night-raised">
        {state === 'error' ? (
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <ErrorState compact title={t('admin.digests.preview.error')} onRetry={() => setRetry((r) => r + 1)} />
          </div>
        ) : (
          <>
            {html && (
              // The email itself is always white, as in a mail client.
              <iframe
                title={t('admin.digests.preview.title')}
                srcDoc={html}
                sandbox="allow-popups allow-popups-to-escape-sandbox"
                className={`w-full h-full border-0 bg-white transition-opacity duration-150 ${state === 'loading' ? 'opacity-50' : ''}`}
              />
            )}
            {state === 'loading' && (
              <LoadingRegion className={html ? 'absolute top-3 right-3' : 'absolute inset-0 p-4'}>
                {!html && <Skeleton className="h-full w-full" />}
              </LoadingRegion>
            )}
          </>
        )}
      </div>
    </section>
  )
}

function withBlankTargets(html: string): string {
  const base = '<base target="_blank">'
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + base) : base + html
}

const SUBJECT_MAX = 200
const INTRO_MAX = 5000
