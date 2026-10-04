import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useBlocker, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  cancelDigest, fetchDigest, fetchDigestPreview, sendDigestNow, sendDigestTest, updateDigest,
} from '../../api/digests'
import { isStaff } from '../../store/authStore'
import { setUnsavedChanges, shouldBlockNavigation } from '../../store/unsavedStore'
import LoadErrorState from '../../components/admin/LoadErrorState'
import DigestStatusBadge from '../../components/admin/DigestStatusBadge'
import ConfirmDialog from '../../components/admin/ConfirmDialog'
import DigestCounts from '../../components/admin/DigestCounts'
import { formatDate } from '../../utils/dates'
import {
  SENDING_POLL_MS, artInputToInstant, defaultAutoSendInput, digestErrorMessage, formatArtDateTime,
  formatWeekRange, instantToArtInput, nowArtInput, shortTime,
} from '../../utils/digest'

function formFrom(digest) {
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

const sameIds = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join()

function isDirty(form, base) {
  return form.subject !== base.subject
    || form.intro !== base.intro
    || !sameIds(form.excludedArticleIds, base.excludedArticleIds)
    || !sameIds(form.excludedEventIds, base.excludedEventIds)
    || form.autoSend !== base.autoSend
    || (form.autoSend && form.autoSendInput !== base.autoSendInput)
}

export default function AdminDigestEditorPage() {
  const { id } = useParams()
  const { t, i18n } = useTranslation()
  const staff = isStaff()

  const [loadState, setLoadState] = useState('loading')
  const [reloadKey, setReloadKey] = useState(0)
  const [digest, setDigest] = useState(null)
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [busyAction, setBusyAction] = useState(null) // 'test' | 'send' | 'cancel'
  const [dialog, setDialog] = useState(null)         // 'send' | 'cancel'
  const [error, setError] = useState('')
  const [formError, setFormError] = useState('')
  const [toast, setToast] = useState(null)
  const [previewVersion, setPreviewVersion] = useState(0)
  // Sequence guard: every fetch/mutation takes a number, and a response is
  // applied only if nothing newer started (or finished) since. Stops a slow
  // poll from overwriting the result of a save/send/cancel.
  const seqRef = useRef(0)
  const nextSeq = () => ++seqRef.current

  // Replace the server copy and reset the form to it.
  const applyDigest = useCallback((d) => {
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
      .catch((err) => { if (!cancelled && seq === seqRef.current) setLoadState(err?.status === 404 ? 'notFound' : 'error') })
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
        .catch(() => { /* try again next tick */ })
    }, SENDING_POLL_MS)
    return () => clearInterval(timer)
  }, [sending, id, applyDigest])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(timer)
  }, [toast])

  const base = useMemo(() => (digest ? formFrom(digest) : null), [digest])
  const dirty = form && base ? isDirty(form, base) : false

  // Same guard as the article editor: in-app navigation with unsaved edits
  // asks first (sign-out reads the store too); closing the tab warns via
  // beforeunload.
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    currentLocation.pathname !== nextLocation.pathname && shouldBlockNavigation())

  useEffect(() => {
    setUnsavedChanges(dirty)
    return () => setUnsavedChanges(false)
  }, [dirty])

  useEffect(() => {
    if (!dirty) return
    const warn = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  if (!staff) return <Navigate to="/admin/articles" replace />

  if (loadState === 'loading') {
    return (
      <div className="flex items-center justify-center py-32" aria-busy="true">
        <p className="font-mono text-label text-ink-secondary uppercase tracking-widest">{t('admin.digests.loading')}</p>
      </div>
    )
  }

  if (loadState !== 'ready') {
    return (
      <LoadErrorState
        notFound={loadState === 'notFound'}
        backTo="/admin/digests"
        backLabel={t('admin.digests.back')}
        onRetry={() => setReloadKey((k) => k + 1)}
      />
    )
  }

  const editable = digest.status === 'draft'
  const set = (key, value) => { setForm((f) => ({ ...f, [key]: value })); setFormError('') }

  function toggleExcluded(key, itemId) {
    setForm((f) => {
      const list = f[key]
      return { ...f, [key]: list.includes(itemId) ? list.filter((x) => x !== itemId) : [...list, itemId] }
    })
  }

  // A 409 means someone (or the auto-send job) moved it out of draft: show
  // the real state instead of a form that can't be saved.
  async function refreshAfterConflict(err) {
    if (err?.status === 409) {
      const seq = nextSeq()
      try {
        const d = await fetchDigest(id)
        if (seq === seqRef.current) applyDigest(d)
      } catch { /* keep current view */ }
    }
  }

  async function handleSave(e) {
    e?.preventDefault()
    if (!editable || saving) return
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
      setToast(t('admin.digests.editor.saved'))
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
      setToast(t('admin.digests.editor.testSent', { email: sentTo }))
    } catch (err) {
      setError(digestErrorMessage(err, t, 'admin.digests.errors.test'))
    } finally {
      setBusyAction(null)
    }
  }

  async function handleSendNow() {
    setBusyAction('send')
    setError('')
    nextSeq()
    try {
      const sent = await sendDigestNow(id)
      nextSeq()
      applyDigest(sent)
      setToast(t('admin.digests.editor.sendStarted'))
    } catch (err) {
      setError(digestErrorMessage(err, t, 'admin.digests.errors.send'))
      await refreshAfterConflict(err)
    } finally {
      setBusyAction(null)
      setDialog(null)
    }
  }

  async function handleCancel() {
    setBusyAction('cancel')
    setError('')
    nextSeq()
    try {
      const cancelled = await cancelDigest(id)
      nextSeq()
      applyDigest(cancelled)
      setToast(t('admin.digests.editor.cancelled'))
    } catch (err) {
      setError(digestErrorMessage(err, t, 'admin.digests.errors.cancel'))
      await refreshAfterConflict(err)
    } finally {
      setBusyAction(null)
      setDialog(null)
    }
  }

  const includedArticles = digest.articles.filter((a) => !form.excludedArticleIds.includes(a.id)).length
  const includedEvents = digest.events.filter((e) => !form.excludedEventIds.includes(e.id)).length
  const actionsLocked = saving || busyAction != null
  // The API refuses to send an issue with nothing in it (409 DIGEST_EMPTY).
  const empty = includedArticles + includedEvents === 0

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <Link to="/admin/digests" className="self-start font-mono text-label text-ink-secondary hover:text-primary transition-colors duration-150 underline underline-offset-2">
          {t('admin.digests.back')}
        </Link>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="font-display text-h4 sm:text-h3 font-bold text-ink-primary">
            {formatWeekRange(digest.weekStart, digest.weekEnd, i18n.language)}
          </h1>
          <DigestStatusBadge status={digest.status} />
        </div>
        <p className="font-body text-body-sm text-ink-secondary">
          {digest.status === 'sent' && digest.sentAt
            ? t('admin.digests.sentAt', { when: formatArtDateTime(digest.sentAt, i18n.language) })
            : t('admin.digests.editor.recipientEstimate', { count: digest.recipientEstimate ?? 0 })}
        </p>
      </div>

      {error && (
        <p role="alert" className="font-body text-body-sm text-red-600 bg-red-50 px-3 py-2 rounded-sm">{error}</p>
      )}

      {!editable && (
        <div className="bg-white rounded-card border border-border shadow-card p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4">
          <p className="flex-1 font-body text-body-sm text-ink-secondary">
            {t(`admin.digests.editor.readOnly.${digest.status}`, { defaultValue: t('admin.digests.editor.readOnly.cancelled') })}
          </p>
          <DigestCounts counts={digest.counts} />
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6 items-start">
        {/* ── Editor column ─────────────────────────────── */}
        <form onSubmit={handleSave} noValidate className="flex flex-col gap-6 min-w-0">
          <fieldset disabled={!editable} className="bg-white rounded-card border border-border shadow-card p-4 sm:p-6 flex flex-col gap-5 min-w-0">
            <legend className="sr-only">{t('admin.digests.editor.contentLegend')}</legend>
            <Field label={t('admin.digests.editor.subject')} htmlFor="digest-subject">
              <input
                id="digest-subject"
                type="text"
                value={form.subject}
                onChange={(e) => set('subject', e.target.value)}
                maxLength={SUBJECT_MAX}
                className={inputClass}
              />
              <Counter value={form.subject} max={SUBJECT_MAX} />
            </Field>
            <Field label={t('admin.digests.editor.intro')} hint={t('admin.digests.editor.introHint')} htmlFor="digest-intro">
              <textarea
                id="digest-intro"
                rows={4}
                value={form.intro}
                onChange={(e) => set('intro', e.target.value)}
                maxLength={INTRO_MAX}
                className={inputClass}
              />
              <Counter value={form.intro} max={INTRO_MAX} />
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

          <fieldset disabled={!editable} className="bg-white rounded-card border border-border shadow-card p-4 sm:p-6 flex flex-col gap-4 min-w-0">
            <legend className="sr-only">{t('admin.digests.editor.autoSend')}</legend>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={form.autoSend}
                onChange={(e) => set('autoSend', e.target.checked)}
                className="mt-1 w-4 h-4 accent-primary"
              />
              <span className="flex flex-col">
                <span className="font-body text-body-sm font-semibold text-ink-primary">{t('admin.digests.editor.autoSend')}</span>
                <span className="font-body text-body-sm text-ink-secondary">{t('admin.digests.editor.autoSendHint')}</span>
              </span>
            </label>
            {form.autoSend && (
              <Field label={t('admin.digests.editor.autoSendAt')} hint={t('admin.digests.editor.timezone')} htmlFor="digest-autosend">
                <input
                  id="digest-autosend"
                  type="datetime-local"
                  value={form.autoSendInput}
                  onChange={(e) => set('autoSendInput', e.target.value)}
                  min={nowArtInput()}
                  className={`${inputClass} sm:max-w-xs`}
                />
              </Field>
            )}
          </fieldset>

          {formError && (
            <p role="alert" className="font-body text-body-sm text-red-600 bg-red-50 px-3 py-2 rounded-sm">{formError}</p>
          )}

          {editable && (
            <div className="flex flex-col gap-3 bg-white rounded-card border border-border shadow-card p-4 sm:p-6">
              <div className="flex flex-col sm:flex-row flex-wrap gap-2">
                <button type="submit" disabled={!dirty || actionsLocked} className={primaryBtn}>
                  {saving ? t('admin.form.saving') : t('admin.digests.editor.save')}
                </button>
                <button type="button" onClick={handleTest} disabled={dirty || actionsLocked} className={secondaryBtn}>
                  {busyAction === 'test' ? t('admin.digests.editor.testing') : t('admin.digests.editor.test')}
                </button>
                <button type="button" onClick={() => setDialog('send')} disabled={dirty || empty || actionsLocked} className={accentBtn}>
                  {t('admin.digests.editor.sendNow')}
                </button>
                <button type="button" onClick={() => setDialog('cancel')} disabled={actionsLocked} className={dangerBtn}>
                  {t('admin.digests.editor.cancel')}
                </button>
              </div>
              {empty && (
                <p role="status" className="font-body text-body-sm text-accent-700 bg-accent-50 px-3 py-2 rounded-sm">
                  {t('admin.digests.editor.emptyWarning')}
                </p>
              )}
              {dirty && (
                <p className="font-body text-body-sm text-ink-secondary">{t('admin.digests.editor.saveFirst')}</p>
              )}
            </div>
          )}

          {sending && (
            <div className="flex">
              <button type="button" onClick={() => setDialog('cancel')} disabled={actionsLocked} className={dangerBtn}>
                {t('admin.digests.editor.stopSending')}
              </button>
            </div>
          )}
        </form>

        {/* ── Preview column ────────────────────────────── */}
        <DigestPreview id={id} version={previewVersion} stale={dirty} />
      </div>

      {dialog === 'send' && (
        <ConfirmDialog
          title={t('admin.digests.editor.sendDialog.title')}
          confirmLabel={busyAction === 'send' ? t('admin.digests.editor.sending') : t('admin.digests.editor.sendDialog.confirm')}
          cancelLabel={t('admin.common.cancel')}
          busy={busyAction === 'send'}
          onConfirm={handleSendNow}
          onClose={() => setDialog(null)}
        >
          {t('admin.digests.editor.sendDialog.body', { count: digest.recipientEstimate ?? 0 })}
        </ConfirmDialog>
      )}
      {dialog === 'cancel' && (
        <ConfirmDialog
          tone="danger"
          title={t('admin.digests.editor.cancelDialog.title')}
          confirmLabel={t('admin.digests.editor.cancelDialog.confirm')}
          cancelLabel={t('admin.digests.editor.cancelDialog.keep')}
          busy={busyAction === 'cancel'}
          onConfirm={handleCancel}
          onClose={() => setDialog(null)}
        >
          {sending ? t('admin.digests.editor.cancelDialog.bodySending') : t('admin.digests.editor.cancelDialog.body')}
        </ConfirmDialog>
      )}

      {blocker.state === 'blocked' && (
        <ConfirmDialog
          tone="danger"
          title={t('admin.digests.editor.leaveDialog.title')}
          confirmLabel={t('admin.digests.editor.leaveDialog.confirm')}
          cancelLabel={t('admin.digests.editor.leaveDialog.stay')}
          onConfirm={() => blocker.proceed()}
          onClose={() => blocker.reset()}
        >
          {t('admin.digests.editor.leaveDialog.body')}
        </ConfirmDialog>
      )}

      {toast && (
        <div
          role="status"
          className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-sm z-50 bg-primary-900 text-white font-body text-body-sm px-4 py-3 rounded-card shadow-card-hover animate-fade-in"
        >
          {toast}
        </div>
      )}
    </div>
  )
}

function Checklist({ title, empty, items, disabled, onToggle }) {
  return (
    <section className="bg-white rounded-card border border-border shadow-card min-w-0">
      <h2 className="px-4 sm:px-6 py-3 border-b border-border font-mono text-label uppercase tracking-widest text-ink-secondary">
        {title}
      </h2>
      {items.length === 0 ? (
        <p className="px-4 sm:px-6 py-6 font-body text-body-sm text-ink-secondary">{empty}</p>
      ) : (
        <ul className="list-none m-0 p-0 divide-y divide-border">
          {items.map((item) => (
            <li key={item.id}>
              <label className={`flex items-start gap-3 px-4 sm:px-6 py-3 ${disabled ? '' : 'cursor-pointer hover:bg-surface'} transition-colors duration-100`}>
                <input
                  type="checkbox"
                  checked={!item.excluded}
                  disabled={disabled}
                  onChange={() => onToggle(item.id)}
                  className="mt-1 w-4 h-4 flex-shrink-0 accent-primary"
                />
                <span className={`flex flex-col min-w-0 ${item.excluded ? 'opacity-50' : ''}`}>
                  <span className={`font-body text-body-sm font-semibold text-ink-primary ${item.excluded ? 'line-through' : ''}`}>
                    {item.title}
                  </span>
                  <span className="font-mono text-label text-ink-secondary break-words">
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
function DigestPreview({ id, version, stale }) {
  const { t } = useTranslation()
  const [html, setHtml] = useState('')
  const [state, setState] = useState('loading')
  const [retry, setRetry] = useState(0)
  const reqRef = useRef(0)

  useEffect(() => {
    const req = ++reqRef.current
    setState('loading')
    fetchDigestPreview(id)
      .then((text) => { if (req === reqRef.current) { setHtml(withBlankTargets(text)); setState('ready') } })
      .catch(() => { if (req === reqRef.current) setState('error') })
  }, [id, version, retry])

  return (
    <section className="bg-white rounded-card border border-border shadow-card flex flex-col min-w-0 xl:sticky xl:top-20">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border flex-wrap">
        <h2 className="font-mono text-label uppercase tracking-widest text-ink-secondary">{t('admin.digests.preview.title')}</h2>
      </div>
      {stale && (
        <p className="px-4 py-2 bg-accent-50 font-body text-body-sm text-accent-700 border-b border-border">
          {t('admin.digests.preview.stale')}
        </p>
      )}
      <div className="relative h-[70vh] min-h-[420px] bg-surface">
        {state === 'error' ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-4">
            <p className="font-body text-body-sm text-ink-secondary">{t('admin.digests.preview.error')}</p>
            <button type="button" onClick={() => setRetry((r) => r + 1)} className={secondaryBtn}>
              {t('admin.common.retry')}
            </button>
          </div>
        ) : (
          <>
            {html && (
              <iframe
                title={t('admin.digests.preview.title')}
                srcDoc={html}
                sandbox="allow-popups allow-popups-to-escape-sandbox"
                className={`w-full h-full border-0 bg-[#fff] transition-opacity duration-150 ${state === 'loading' ? 'opacity-50' : ''}`}
              />
            )}
            {state === 'loading' && (
              <p className="absolute top-3 right-3 font-mono text-label text-ink-secondary uppercase tracking-widest" aria-busy="true">
                {t('admin.digests.preview.loading')}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  )
}

function withBlankTargets(html) {
  const base = '<base target="_blank">'
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + base) : base + html
}

const SUBJECT_MAX = 200
const INTRO_MAX = 5000

function Counter({ value, max }) {
  const { t } = useTranslation()
  return (
    <p className="self-end font-mono text-label text-ink-secondary" aria-hidden="true">
      {t('admin.digests.editor.charCount', { count: value.length, max })}
    </p>
  )
}

function Field({ label, hint, htmlFor, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <label htmlFor={htmlFor} className="font-body text-body-sm font-semibold text-ink-primary">{label}</label>
        {hint && <span className="font-body text-body-sm text-ink-secondary">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

const inputClass = 'w-full min-h-[44px] px-3 py-2 border border-border rounded-sm font-body text-body text-ink-primary bg-white focus:outline-none focus:ring-1 focus:border-primary focus:ring-primary/30 transition-colors duration-150 disabled:bg-surface disabled:text-ink-secondary'
const btnBase = 'min-h-[44px] px-5 inline-flex items-center justify-center font-body text-body-sm font-semibold rounded-sm transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed'
const primaryBtn = `${btnBase} bg-primary text-surface hover:bg-primary-600`
const secondaryBtn = `${btnBase} bg-white border border-border text-ink-primary hover:border-primary hover:text-primary`
const accentBtn = `${btnBase} bg-accent text-ink-primary hover:bg-accent-500`
const dangerBtn = `${btnBase} bg-white border border-border text-red-600 hover:bg-red-50 hover:border-red-300`
