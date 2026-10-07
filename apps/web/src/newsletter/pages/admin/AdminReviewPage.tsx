import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ALL_STATUSES, fetchAllArticles, updateArticle } from '../../api/articles'
import { fetchAnalyticsSummary } from '../../api/analytics'
import AdminSectionHeader from '../../components/admin/AdminSectionHeader'
import ArticlesTable from '../../components/admin/ArticlesTable'
import DeleteArticleDialog from '../../components/admin/DeleteArticleDialog'
import { TableCard, Th, rowClass, theadRowClass } from '../../components/admin/AdminTable'
import { useAdminContext } from '../../admin/adminContext'
import { todayISO } from '../../utils/dates'
import { articleEditPath } from '@/newsletter/paths'
import { Button, EmptyState, ErrorState, SkeletonTable, ToggleGroup, buttonClass, toast } from '@/components/ui'
import type { Article, VoteCounts } from '../../types'

// The vote counts come from the analytics summary over this many days (the
// same window as the analytics page's default "30 días").
const VOTE_DAYS = 30

type View = 'pending' | 'all'
const VIEW_PARAM = 'view'

// updatedAt is the last change: for an article in review, when it was sent
// (or last updated while waiting). Instants, not strings (see MyArticlesPage).
function updatedAtMs(a: Article): number {
  const ms = Date.parse(a.updatedAt ?? a.createdAt ?? '')
  return Number.isNaN(ms) ? 0 : ms
}

// Staff's review queue: the articles independent authors sent for review,
// oldest first, to open in the editor or publish as they are. "Todos los
// artículos" lists every article in any status, for moderation (feature,
// unpublish or edit from the editor; delete from here).
export default function AdminReviewPage() {
  const { t, i18n } = useTranslation()
  const { orgName, refreshPending } = useAdminContext()
  const [params, setParams] = useSearchParams()
  const view: View = params.get(VIEW_PARAM) === 'all' ? 'all' : 'pending'
  const [articles, setArticles] = useState<Article[]>([])
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [reloadKey, setReloadKey] = useState(0)
  const [publishing, setPublishing] = useState<string | null>(null)
  const [toDelete, setToDelete] = useState<Article | null>(null)
  const [votes, setVotes] = useState<Record<string, VoteCounts>>({})

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    const request = view === 'pending'
      ? fetchAllArticles({ status: 'pending_review' }).then((list) => [...list].sort((a, b) => updatedAtMs(a) - updatedAtMs(b)))
      // Already newest first.
      : fetchAllArticles({ status: ALL_STATUSES })
    request
      .then((list) => { if (!cancelled) { setArticles(list); setStatus('success') } })
      .catch((err: unknown) => {
        console.error('newsletter admin: review queue', err)
        if (!cancelled) setStatus('error')
      })
    return () => { cancelled = true }
  }, [view, reloadKey])

  // Vote counts for "Todos". Best-effort: never let it fail the list.
  useEffect(() => {
    if (view !== 'all') return
    let cancelled = false
    fetchAnalyticsSummary(VOTE_DAYS)
      .then((summary) => {
        if (cancelled) return
        setVotes(Object.fromEntries(
          (summary.voteBreakdown ?? []).map((v) => [v.articleId, { up: v.up, down: v.down }]),
        ))
      })
      .catch((err: unknown) => console.error('newsletter admin: vote counts', err))
    return () => { cancelled = true }
  }, [view])

  function setView(next: View) {
    const p = new URLSearchParams(params)
    if (next === 'all') p.set(VIEW_PARAM, 'all')
    else p.delete(VIEW_PARAM)
    setParams(p, { replace: true })
  }

  // Publishing is reversible (the editor unpublishes), so no confirmation.
  // An article sent without a date gets today's.
  async function publish(article: Article) {
    setPublishing(article.id)
    try {
      await updateArticle(article.id, { status: 'published', ...(article.date ? {} : { date: todayISO() }) })
      setArticles((prev) => prev.filter((a) => a.id !== article.id))
      toast.success(t('admin.review.published', { title: article.title }))
      refreshPending?.()
    } catch (err) {
      console.error('newsletter admin: publish article', err)
      toast.error(t('admin.review.publishError', { title: article.title }))
    } finally {
      setPublishing(null)
    }
  }

  const byline = (a: Article) => {
    const authors = (a.authors ?? []).filter(Boolean).join(', ')
    const org = a.organization ? orgName(a.organization) : t('admin.articles.independent')
    return authors ? `${authors} · ${org}` : org
  }
  const submitted = (a: Article) => new Date(updatedAtMs(a)).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <div className="flex flex-col gap-6">
      <AdminSectionHeader
        title={view === 'pending' ? t('admin.review.title') : t('admin.review.allTitle')}
        subtitle={status === 'success'
          ? (view === 'pending' ? t('admin.review.count', { count: articles.length }) : t('admin.articles.count', { count: articles.length }))
          : undefined}
      />

      <ToggleGroup
        joined
        className="self-start"
        options={[
          { value: 'pending', label: t('admin.review.views.pending') },
          { value: 'all', label: t('admin.review.views.all') },
        ]}
        value={view}
        onChange={setView}
        label={t('admin.review.views.label')}
      />

      {status === 'loading' && <SkeletonTable rows={5} cols={view === 'pending' ? 4 : 7} />}

      {status === 'error' && (
        <ErrorState title={t('admin.review.loadError')} onRetry={() => setReloadKey((k) => k + 1)} />
      )}

      {status === 'success' && articles.length === 0 && (
        view === 'pending'
          ? <EmptyState title={t('admin.review.emptyTitle')} body={t('admin.review.emptyBody')} />
          : <EmptyState title={t('admin.articles.emptyTitle')} body={t('admin.review.allEmptyBody')} />
      )}

      {status === 'success' && articles.length > 0 && view === 'pending' && (
        <TableCard>
          <thead>
            <tr className={theadRowClass}>
              <Th className="min-w-[16rem]">{t('admin.articles.columns.title')}</Th>
              <Th>{t('admin.review.columns.author')}</Th>
              <Th>{t('admin.review.columns.submitted')}</Th>
              <Th><span className="sr-only">{t('admin.common.actions')}</span></Th>
            </tr>
          </thead>
          <tbody>
            {articles.map((a) => (
              <tr key={a.id} className={rowClass}>
                <td className="px-4 py-3">
                  <span className="font-body text-body-sm font-semibold text-ink-primary dark:text-night-text line-clamp-2">{a.title}</span>
                </td>
                <td className="px-4 py-3 font-body text-body-sm text-ink-secondary dark:text-night-muted">{byline(a)}</td>
                <td className="px-4 py-3">
                  <time className="font-mono text-label text-ink-secondary dark:text-night-muted whitespace-nowrap" dateTime={a.updatedAt ?? undefined}>
                    {submitted(a)}
                  </time>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1 justify-end">
                    <Link
                      to={articleEditPath(a.id, 'admin')}
                      className={buttonClass({ variant: 'outline', size: 'sm' })}
                      aria-label={t('admin.review.reviewAria', { title: a.title })}
                    >
                      {t('admin.review.review')}
                    </Link>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => publish(a)}
                      loading={publishing === a.id}
                      loadingLabel={t('admin.review.publishing')}
                      disabled={publishing != null}
                      aria-label={t('admin.review.publishAria', { title: a.title })}
                    >
                      {t('admin.review.publish')}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </TableCard>
      )}

      {status === 'success' && articles.length > 0 && view === 'all' && (
        <ArticlesTable
          articles={articles}
          orgName={orgName}
          editPath={(a) => articleEditPath(a.id, 'admin')}
          canDelete={() => true}
          onDelete={setToDelete}
          votes={votes}
          voteDays={VOTE_DAYS}
        />
      )}

      {toDelete && (
        <DeleteArticleDialog
          article={toDelete}
          onDeleted={(gone) => {
            setArticles((prev) => prev.filter((a) => a.id !== gone.id))
            setToDelete(null)
            refreshPending?.()
          }}
          onCancel={() => setToDelete(null)}
        />
      )}
    </div>
  )
}
