import { useEffect, useId, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Badge, Button, ConfirmDialog, ErrorState, Field, IconButton, CloseIcon, LoadingRegion, Modal, SkeletonText, Switch, ToggleGroup, inputClass, toast,
} from '@/components/ui'
import { ApiError } from '@/api/client'
import {
  POLL_MAX_OPTIONS, POLL_MIN_OPTIONS, createPoll, deletePoll, fetchComments, fetchPolls, setCommentsEnabled, updatePoll,
  type Poll, type ResultsVisibility,
} from '../../api/engagement'

interface EngagementSettingsProps {
  // null until the article was saved once.
  articleId: string | null
  // Inserts the poll's block at the editor's cursor.
  onInsert: (pollId: string) => void
}

// Article editor sidebar: comments on/off and the article's polls (create,
// insert into the text, close/reopen, delete). Both need a saved article.
export default function EngagementSettings({ articleId, onInsert }: EngagementSettingsProps) {
  const { t } = useTranslation()
  const [polls, setPolls] = useState<Poll[]>([])
  const [commentsOn, setCommentsOn] = useState<boolean | null>(null)
  const [canModerate, setCanModerate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [toDelete, setToDelete] = useState<Poll | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!articleId) return
    let active = true
    setStatus('loading')
    Promise.all([fetchPolls(articleId), fetchComments(articleId, 'new')])
      .then(([p, th]) => {
        if (!active) return
        setPolls(p)
        setCommentsOn(th.enabled)
        setCanModerate(th.canModerate)
        setStatus('ready')
      })
      .catch(() => { if (active) setStatus('error') })
    return () => { active = false }
  }, [articleId, reloadKey])

  if (!articleId) {
    return <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted leading-relaxed">{t('engagement.editor.saveFirst')}</p>
  }
  if (status === 'loading') return <LoadingRegion><SkeletonText lines={3} /></LoadingRegion>
  if (status === 'error') return <ErrorState compact title={t('engagement.editor.loadError')} onRetry={() => setReloadKey((k) => k + 1)} />

  const replace = (p: Poll) => setPolls((ps) => ps.map((x) => (x.id === p.id ? p : x)))

  async function toggleComments(enabled: boolean) {
    setCommentsOn(enabled)
    try {
      await setCommentsEnabled(articleId!, enabled)
    } catch {
      setCommentsOn(!enabled)
      toast.error(t('engagement.editor.saveError'))
    }
  }

  async function setVisibility(p: Poll, resultsVisibility: ResultsVisibility) {
    if (p.resultsVisibility === resultsVisibility) return
    try {
      replace(await updatePoll(articleId!, p.id, { resultsVisibility }))
    } catch {
      toast.error(t('engagement.editor.saveError'))
    }
  }

  async function toggleClosed(p: Poll) {
    try {
      replace(await updatePoll(articleId!, p.id, p.closed ? { reopen: true } : { close: true }))
    } catch {
      toast.error(t('engagement.editor.saveError'))
    }
  }

  async function remove() {
    if (!toDelete) return
    setBusy(true)
    try {
      await deletePoll(articleId!, toDelete.id)
      setPolls((ps) => ps.filter((x) => x.id !== toDelete.id))
      setToDelete(null)
    } catch {
      toast.error(t('engagement.editor.saveError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {canModerate && commentsOn !== null && (
        <Switch
          checked={commentsOn}
          onChange={toggleComments}
          label={t('engagement.editor.commentsLabel')}
          hint={commentsOn ? t('engagement.editor.commentsOnHint') : t('engagement.editor.commentsOffHint')}
        />
      )}

      <div>
        <p className="mb-2 font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">{t('engagement.editor.polls')}</p>
        {polls.length === 0 && (
          <p className="mb-3 font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('engagement.editor.noPolls')}</p>
        )}
        <ul className="flex flex-col gap-3 mb-3">
          {polls.map((p) => (
            <li key={p.id} className="rounded-xs border border-border dark:border-night-border p-3">
              <p className="font-body text-body-sm font-semibold text-ink-primary dark:text-night-text">{p.question}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Badge tone={p.closed ? 'neutral' : 'success'}>{p.closed ? t('engagement.poll.closed') : t('engagement.poll.open')}</Badge>
                <span className="font-mono text-label text-ink-secondary dark:text-night-muted">{t('engagement.poll.votes', { count: p.totalVotes ?? 0 })}</span>
              </div>
              <div className="mt-2">
                <ToggleGroup
                  label={t('engagement.editor.form.visibility')}
                  value={p.resultsVisibility}
                  onChange={(v) => setVisibility(p, v)}
                  options={[
                    { value: 'after_vote', label: t('engagement.editor.form.afterVote') },
                    { value: 'after_close', label: t('engagement.editor.form.afterClose') },
                  ]}
                />
              </div>
              <div className="mt-2 flex flex-wrap gap-1 -ml-3">
                <Button size="sm" variant="ghost" onClick={() => onInsert(p.id)}>{t('engagement.editor.insert')}</Button>
                <Button size="sm" variant="ghost" onClick={() => toggleClosed(p)}>{p.closed ? t('engagement.editor.reopen') : t('engagement.editor.close')}</Button>
                <Button size="sm" variant="dangerGhost" onClick={() => setToDelete(p)}>{t('engagement.editor.delete')}</Button>
              </div>
            </li>
          ))}
        </ul>
        <Button size="sm" variant="outline" block onClick={() => setCreating(true)}>{t('engagement.editor.newPoll')}</Button>
      </div>

      {creating && (
        <PollFormModal
          onClose={() => setCreating(false)}
          onSubmit={async (input) => {
            const p = await createPoll(articleId, input)
            setPolls((ps) => [...ps, p])
            setCreating(false)
            onInsert(p.id)
          }}
        />
      )}

      {toDelete && (
        <ConfirmDialog
          title={t('engagement.editor.deleteTitle')}
          body={t('engagement.editor.deleteBody', { question: toDelete.question })}
          confirmLabel={t('engagement.editor.deleteConfirm')}
          danger
          busy={busy}
          onConfirm={remove}
          onCancel={() => setToDelete(null)}
        />
      )}
    </div>
  )
}

interface PollFormModalProps {
  onClose: () => void
  onSubmit: (input: { question: string; options: string[]; resultsVisibility: ResultsVisibility; closesAt: string | null }) => Promise<void>
}

function PollFormModal({ onClose, onSubmit }: PollFormModalProps) {
  const { t } = useTranslation()
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [visibility, setVisibility] = useState<ResultsVisibility>('after_vote')
  const [closesAt, setClosesAt] = useState('')
  const [attempted, setAttempted] = useState(false)
  const [saving, setSaving] = useState(false)
  const optionsErrorId = useId()
  const formId = useId()
  const visibilityId = useId()

  const filled = options.map((o) => o.trim()).filter(Boolean)
  const questionError = attempted && !question.trim() ? t('engagement.editor.form.questionRequired') : undefined
  const optionsError = attempted && filled.length < POLL_MIN_OPTIONS ? t('engagement.editor.form.optionsRequired', { count: POLL_MIN_OPTIONS }) : undefined

  async function submit(e: FormEvent) {
    e.preventDefault()
    setAttempted(true)
    if (!question.trim() || filled.length < POLL_MIN_OPTIONS) return
    setSaving(true)
    try {
      // datetime-local is the browser's local time; the API takes an instant.
      await onSubmit({ question: question.trim(), options: filled, resultsVisibility: visibility, closesAt: closesAt ? new Date(closesAt).toISOString() : null })
    } catch (err) {
      toast.error(err instanceof ApiError && err.status === 400 ? t('engagement.editor.form.invalid') : t('engagement.editor.saveError'))
      setSaving(false)
    }
  }

  return (
    <Modal
      title={t('engagement.editor.form.title')}
      onClose={onClose}
      busy={saving}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>{t('engagement.cancel')}</Button>
          <Button type="submit" form={formId} loading={saving}>{t('engagement.editor.form.create')}</Button>
        </>
      )}
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <Field label={t('engagement.editor.form.question')} error={questionError} required>
          {(p) => <input {...p} value={question} maxLength={300} onChange={(e) => setQuestion(e.target.value)} className={inputClass({ invalid: !!questionError })} />}
        </Field>

        <fieldset>
          <legend className="mb-1.5 font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">{t('engagement.editor.form.options')}</legend>
          <div className="flex flex-col gap-2">
            {options.map((o, i) => (
              <div key={i} className="flex gap-2">
                <input
                  value={o}
                  maxLength={120}
                  onChange={(e) => setOptions((os) => os.map((x, j) => (j === i ? e.target.value : x)))}
                  aria-label={t('engagement.editor.form.optionLabel', { n: i + 1 })}
                  aria-invalid={!!optionsError && !o.trim()}
                  aria-describedby={optionsError ? optionsErrorId : undefined}
                  className={inputClass({ invalid: !!optionsError && !o.trim() })}
                />
                {options.length > POLL_MIN_OPTIONS && (
                  <IconButton aria-label={t('engagement.editor.form.removeOption', { n: i + 1 })} onClick={() => setOptions((os) => os.filter((_, j) => j !== i))}>
                    <CloseIcon />
                  </IconButton>
                )}
              </div>
            ))}
          </div>
          {optionsError && <p id={optionsErrorId} role="alert" className="mt-1.5 font-body text-body-sm text-red-600 dark:text-red-400">{optionsError}</p>}
          {options.length < POLL_MAX_OPTIONS && (
            <Button size="sm" variant="ghost" className="mt-2 -ml-3" onClick={() => setOptions((os) => [...os, ''])}>{t('engagement.editor.form.addOption')}</Button>
          )}
        </fieldset>

        <div>
          <p id={visibilityId} className="mb-1.5 font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">{t('engagement.editor.form.visibility')}</p>
          <ToggleGroup
            labelledBy={visibilityId}
            value={visibility}
            onChange={setVisibility}
            options={[
              { value: 'after_vote', label: t('engagement.editor.form.afterVote') },
              { value: 'after_close', label: t('engagement.editor.form.afterClose') },
            ]}
          />
          <p className="mt-1.5 font-body text-body-sm text-ink-secondary dark:text-night-muted">
            {visibility === 'after_vote' ? t('engagement.editor.form.afterVoteHint') : t('engagement.editor.form.afterCloseHint')}
          </p>
        </div>

        <Field label={t('engagement.editor.form.closesAt')} hint={t('engagement.editor.form.closesAtHint')}>
          {(p) => <input {...p} type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} className={inputClass()} />}
        </Field>
      </form>
    </Modal>
  )
}
