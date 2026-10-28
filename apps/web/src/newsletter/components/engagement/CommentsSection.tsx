import { useCallback, useEffect, useId, useState, type FormEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, LoadingRegion, SkeletonText, ToggleGroup, textareaClass, toast } from '@/components/ui'
import { ApiError } from '@/api/client'
import { useAuth } from '@/hooks/useAuth'
import { startGoogleSignIn } from '@/store/authStore'
import {
  COMMENT_MAX, deleteComment, fetchComments, pinComment, postComment, reportComment, restoreComment, setCommentLike,
  type Comment, type CommentSort, type CommentThread,
} from '../../api/engagement'

// Comments at the foot of an article (apps/api/docs/NEWSLETTER-ENGAGEMENT.md):
// one level of replies, likes, reports, and pin/restore/delete for the
// article's editors and STAFF (`canModerate`).
export default function CommentsSection({ articleId }: { articleId: string }) {
  const { t } = useTranslation()
  const { profile } = useAuth()
  const location = useLocation()
  const [sort, setSort] = useState<CommentSort>('top')
  const [thread, setThread] = useState<CommentThread | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [reloadKey, setReloadKey] = useState(0)
  const [confirmDelete, setConfirmDelete] = useState<Comment | null>(null)
  const [deleting, setDeleting] = useState(false)
  // The comment with an action in flight (its controls are disabled), and the ones this reader reported.
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set())
  const [reported, setReported] = useState<Set<string>>(() => new Set())

  const reload = useCallback(() => setReloadKey((k) => k + 1), [])
  const signIn = () => startGoogleSignIn(location.pathname + location.search)

  useEffect(() => {
    let active = true
    fetchComments(articleId, sort)
      .then((th) => { if (active) { setThread(th); setStatus('ready') } })
      .catch(() => { if (active) setStatus('error') })
    return () => { active = false }
  }, [articleId, sort, reloadKey, profile?.id])

  function patch(id: string, fn: (c: Comment) => Comment) {
    const walk = (cs: Comment[]): Comment[] => cs.map((c) => (c.id === id ? fn(c) : { ...c, replies: walk(c.replies) }))
    setThread((th) => th && { ...th, comments: walk(th.comments) })
  }

  function failed(err: unknown) {
    if (err instanceof ApiError && err.code === 'CommentsDisabled') { toast.error(t('engagement.comments.disabledError')); reload() }
    else toast.error(t('engagement.comments.actionError'))
  }

  async function run(c: Comment, fn: () => Promise<void>) {
    if (busyIds.has(c.id)) return
    setBusyIds((s) => new Set(s).add(c.id))
    try {
      await fn()
    } catch (err) {
      failed(err)
    } finally {
      setBusyIds((s) => { const next = new Set(s); next.delete(c.id); return next })
    }
  }

  const actions: CommentActions = {
    signedIn: Boolean(profile),
    canModerate: thread?.canModerate ?? false,
    enabled: thread?.enabled ?? false,
    busyIds,
    reported,
    async reply(parent, body) {
      try { await postComment(articleId, body, parent.id); reload(); return true } catch (err) { failed(err); return false }
    },
    like: (c) => run(c, async () => {
      const r = await setCommentLike(articleId, c.id, !c.likedByMe)
      patch(c.id, (x) => ({ ...x, likes: r.likes, likedByMe: r.likedByMe }))
    }),
    report: (c) => run(c, async () => {
      await reportComment(articleId, c.id, null)
      setReported((s) => new Set(s).add(c.id))
      toast.success(t('engagement.comments.reported'))
    }),
    pin: (c) => run(c, async () => { await pinComment(articleId, c.id, !c.pinned); reload() }),
    restore: (c) => run(c, async () => { await restoreComment(articleId, c.id); reload() }),
    askDelete: (c) => setConfirmDelete(c),
  }

  async function doDelete() {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteComment(articleId, confirmDelete.id)
      setConfirmDelete(null)
      reload()
    } catch (err) {
      failed(err)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <section aria-labelledby="comments-heading" className="mt-12 pt-8 border-t border-border dark:border-night-border">
      <div className="flex flex-wrap items-baseline justify-between gap-4 mb-6">
        <h2 id="comments-heading" className="font-display text-h3 font-bold text-ink-primary dark:text-night-text">
          {thread ? t('engagement.comments.titleCount', { count: thread.total }) : t('engagement.comments.title')}
        </h2>
        {thread && thread.total > 1 && (
          <ToggleGroup
            label={t('engagement.comments.sortLabel')}
            value={sort}
            onChange={(v) => setSort(v as CommentSort)}
            options={[{ value: 'top', label: t('engagement.comments.sortTop') }, { value: 'new', label: t('engagement.comments.sortNew') }]}
          />
        )}
      </div>

      {status === 'loading' && <LoadingRegion><SkeletonText lines={4} /></LoadingRegion>}
      {status === 'error' && <ErrorState title={t('engagement.comments.loadError')} onRetry={reload} />}
      {status === 'ready' && thread && (
        <>
          {!thread.enabled ? (
            <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted mb-6">{t('engagement.comments.closed')}</p>
          ) : profile ? (
            <Composer
              placeholder={t('engagement.comments.placeholder')}
              submitLabel={t('engagement.comments.submit')}
              onSubmit={async (body) => {
                try { await postComment(articleId, body); reload(); return true } catch (err) { failed(err); return false }
              }}
            />
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-dashed border-border dark:border-night-border px-4 py-3">
              <span className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('engagement.comments.signInPrompt')}</span>
              <Button size="sm" variant="outline" onClick={signIn}>{t('engagement.signIn')}</Button>
            </div>
          )}

          {thread.comments.length === 0 ? (
            thread.enabled && <EmptyState compact title={t('engagement.comments.empty')} />
          ) : (
            <ol className="mt-8 flex flex-col gap-8">
              {thread.comments.map((c) => <CommentItem key={c.id} comment={c} actions={actions} />)}
            </ol>
          )}
        </>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={t('engagement.comments.deleteTitle')}
          body={confirmDelete.mine ? t('engagement.comments.deleteBodyOwn') : t('engagement.comments.deleteBodyOther')}
          confirmLabel={t('engagement.comments.deleteConfirm')}
          danger
          busy={deleting}
          onConfirm={doDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </section>
  )
}

interface CommentActions {
  signedIn: boolean
  canModerate: boolean
  enabled: boolean
  busyIds: Set<string>
  reported: Set<string>
  reply: (parent: Comment, body: string) => Promise<boolean>
  like: (c: Comment) => void
  report: (c: Comment) => void
  pin: (c: Comment) => void
  restore: (c: Comment) => void
  askDelete: (c: Comment) => void
}

function CommentItem({ comment: c, actions, isReply = false }: { comment: Comment; actions: CommentActions; isReply?: boolean }) {
  const { t, i18n } = useTranslation()
  const [replying, setReplying] = useState(false)
  const when = relativeTime(c.createdAt, i18n.language)
  const busy = actions.busyIds.has(c.id)
  const link = 'inline-flex items-center gap-1.5 font-mono text-label text-ink-secondary dark:text-night-muted hover:text-primary dark:hover:text-primary-300 min-h-[44px] sm:min-h-[36px] transition-colors duration-150 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:text-ink-secondary dark:disabled:hover:text-night-muted'

  return (
    <li className="flex gap-3">
      <Avatar name={c.authorName} url={c.authorAvatarUrl} deleted={c.deleted} />
      <div className="flex-1 min-w-0">
        {c.deleted ? (
          <p className="font-body text-body-sm italic text-ink-secondary dark:text-night-muted pt-2">{t('engagement.comments.deleted')}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <strong className="font-body text-body-sm font-semibold text-ink-primary dark:text-night-text">{c.authorName}</strong>
              {c.authorRole === 'author' && <Badge tone="info">{t('engagement.comments.authorBadge')}</Badge>}
              {c.pinned && <Badge tone="accent">{t('engagement.comments.pinnedBadge')}</Badge>}
              {c.hidden && <Badge tone="warning">{t('engagement.comments.hiddenBadge')}</Badge>}
              <time dateTime={c.createdAt} className="font-mono text-label text-ink-secondary dark:text-night-muted">{when}</time>
            </div>
            <p className="mt-1 font-body text-body-sm text-ink-primary dark:text-night-text leading-relaxed whitespace-pre-line break-words">{c.body}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
              <button
                type="button"
                onClick={() => actions.like(c)}
                disabled={busy || !actions.signedIn || (!actions.enabled && !c.likedByMe)}
                aria-pressed={c.likedByMe}
                aria-label={t('engagement.comments.likeAria', { count: c.likes })}
                title={actions.signedIn ? undefined : t('engagement.comments.signInToLike')}
                className={[link, c.likedByMe ? 'text-primary! dark:text-primary-300!' : ''].join(' ')}
              >
                <HeartIcon filled={c.likedByMe} /> {c.likes}
              </button>
              {!isReply && actions.signedIn && actions.enabled && (
                <button type="button" className={link} onClick={() => setReplying((r) => !r)} aria-expanded={replying}>
                  {t('engagement.comments.reply')}
                </button>
              )}
              {(c.mine || actions.canModerate) && (
                <button type="button" className={link} onClick={() => actions.askDelete(c)}>{t('engagement.comments.delete')}</button>
              )}
              {actions.canModerate && !isReply && (
                <button type="button" className={link} disabled={busy} onClick={() => actions.pin(c)}>
                  {c.pinned ? t('engagement.comments.unpin') : t('engagement.comments.pin')}
                </button>
              )}
              {actions.canModerate && c.hidden && (
                <button type="button" className={link} disabled={busy} onClick={() => actions.restore(c)}>{t('engagement.comments.restore')}</button>
              )}
              {actions.signedIn && !c.mine && !c.hidden && (
                actions.reported.has(c.id)
                  ? <span className="font-mono text-label text-ink-secondary dark:text-night-muted">{t('engagement.comments.reportedLabel')}</span>
                  : (
                    <button type="button" className={`${link} hover:text-red-600! dark:hover:text-red-400!`} disabled={busy} onClick={() => actions.report(c)}>
                      {t('engagement.comments.report')}
                    </button>
                  )
              )}
            </div>
          </>
        )}
        {replying && (
          <div className="mt-3">
            <Composer
              compact
              autoFocus
              placeholder={t('engagement.comments.replyPlaceholder', { name: c.authorName ?? '' })}
              submitLabel={t('engagement.comments.replySubmit')}
              onCancel={() => setReplying(false)}
              onSubmit={async (body) => {
                const ok = await actions.reply(c, body)
                if (ok) setReplying(false)
                return ok
              }}
            />
          </div>
        )}
        {c.replies.length > 0 && (
          <ol className="mt-4 flex flex-col gap-4 pl-4 border-l-2 border-border dark:border-night-border">
            {c.replies.map((r) => <CommentItem key={r.id} comment={r} actions={actions} isReply />)}
          </ol>
        )}
      </div>
    </li>
  )
}

interface ComposerProps {
  placeholder: string
  submitLabel: string
  onSubmit: (body: string) => Promise<boolean>
  onCancel?: () => void
  compact?: boolean
  autoFocus?: boolean
}

function Composer({ placeholder, submitLabel, onSubmit, onCancel, compact = false, autoFocus = false }: ComposerProps) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const counterId = useId()

  async function submit(e: FormEvent) {
    e.preventDefault()
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    if (await onSubmit(body)) setText('')
    setSending(false)
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        aria-describedby={counterId}
        maxLength={COMMENT_MAX}
        autoFocus={autoFocus}
        className={textareaClass({ className: compact ? 'min-h-[64px]' : '' })}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span id={counterId} className="font-mono text-label text-ink-secondary dark:text-night-muted">
          {t('engagement.comments.counter', { count: text.length, max: COMMENT_MAX })}
        </span>
        <div className="flex gap-2">
          {onCancel && <Button size="sm" variant="ghost" onClick={onCancel}>{t('engagement.cancel')}</Button>}
          <Button size="sm" type="submit" loading={sending} disabled={!text.trim()}>{submitLabel}</Button>
        </div>
      </div>
    </form>
  )
}

function Avatar({ name, url, deleted }: { name: string | null; url: string | null; deleted: boolean }) {
  const initials = (name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('')
  if (url && !deleted) return <img src={url} alt="" className="shrink-0 w-9 h-9 rounded-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
  return (
    <span aria-hidden="true" className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center font-mono text-[11px] font-semibold bg-primary-50 text-primary-700 dark:bg-night-raised dark:text-night-text">
      {deleted ? '–' : initials || '?'}
    </span>
  )
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  )
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]

function relativeTime(iso: string, lang: string): string {
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000)
  const rtf = new Intl.RelativeTimeFormat(lang === 'en' ? 'en-US' : 'es-AR', { numeric: 'auto' })
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit)
  }
  return rtf.format(0, 'minute')
}
