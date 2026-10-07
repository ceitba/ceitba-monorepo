import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ALL_STATUSES, deleteArticle, fetchAllArticles } from '../../api/articles'
import { fetchAnalyticsSummary } from '../../api/analytics'
import CategoryBadge from '../../components/CategoryBadge'
import ArticleStatusBadge from '../../components/admin/ArticleStatusBadge'
import AdminSectionHeader from '../../components/admin/AdminSectionHeader'
import { TableCard, Th, rowClass, theadRowClass } from '../../components/admin/AdminTable'
import { useAdminContext } from '../../admin/adminContext'
import { formatDate } from '../../utils/dates'
import { getOrganizations, isStaff } from '../../store/authStore'
import { useAuthSession } from '../../hooks/useAuthSession'
import { newsletterPath } from '@/newsletter/paths'
import {
  Alert, Button, ConfirmDialog, EmptyState, ErrorState, SkeletonTable, ToggleGroup, buttonClass, type TabItem,
} from '@/components/ui'
import type { UserProfile } from '@/store/authStore'
import type { Article, ArticleStatus, VoteCounts } from '../../types'

// The vote counts come from the analytics summary over this many days (the
// same window as the analytics page's default "30 días").
const VOTE_DAYS = 30

// Status tabs, in the order an editor cares about them; only statuses that
// have articles get a tab.
const STATUS_ORDER: ArticleStatus[] = ['pending_review', 'draft', 'changes_requested', 'published', 'rejected']
type Filter = 'all' | ArticleStatus

// Articles visible to the current admin user, drafts included, plus the ids
// the user wrote (their independent drafts are theirs to delete).
//
// Staff list everything with one ?status=all walk (already newest first).
// Everyone else gets ?status=all scoped to each of their organizations — the
// API returns an org's drafts to its members — and their own articles
// (?mine=true, any status), merged and re-sorted.
async function loadArticles(profile: UserProfile): Promise<{ list: Article[]; mineIds: Set<string> }> {
  if (isStaff(profile)) {
    return { list: await fetchAllArticles({ status: ALL_STATUSES }), mineIds: new Set<string>() }
  }
  const slugs = getOrganizations(profile).map((o) => o.slug)
  const [mine, ...lists] = await Promise.all([
    fetchAllArticles({ mine: true, status: ALL_STATUSES }),
    ...slugs.map((organization) => fetchAllArticles({ organization, status: ALL_STATUSES })),
  ])
  return {
    list: sortNewestFirst(dedupeById([...mine, ...lists.flat()])),
    mineIds: new Set(mine.map((a) => a.id)),
  }
}

// The API lets authors delete their own unpublished independent articles.
function canDelete(article: Article, staff: boolean, mineIds: Set<string>): boolean {
  return staff || (mineIds.has(article.id) && !article.organization && article.status !== 'published')
}

function dedupeById(list: Article[]): Article[] {
  return [...new Map(list.map((a) => [a.id, a])).values()]
}

// createdAt is an ISO OffsetDateTime whose fractional seconds vary in
// length ("…:00Z" vs "…:00.5Z"), so compare instants, not strings.
function createdAtMs(a: Article): number {
  const ms = Date.parse(a.createdAt ?? '')
  return Number.isNaN(ms) ? 0 : ms
}

function sortNewestFirst(list: Article[]): Article[] {
  return [...list].sort((a, b) => createdAtMs(b) - createdAtMs(a))
}

export default function AdminArticlesPage() {
  const { t, i18n } = useTranslation()
  const { profile } = useAuthSession()
  const { orgName } = useAdminContext()
  const staff = isStaff(profile)
  const [articles, setArticles] = useState<Article[]>([])
  const [mineIds, setMineIds]   = useState(() => new Set<string>())
  const [votes, setVotes]       = useState<Record<string, VoteCounts>>({})
  const [status, setStatus]     = useState<'loading' | 'success' | 'error'>('loading')
  const [filter, setFilter]     = useState<Filter>('all')
  const [toDelete, setToDelete] = useState<Article | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!profile) return
    let cancelled = false
    setStatus('loading')
    loadArticles(profile)
      .then(({ list, mineIds: ids }) => {
        if (cancelled) return
        setArticles(list)
        setMineIds(ids)
        setStatus('success')
      })
      .catch((err: unknown) => {
        console.error('newsletter admin: articles', err)
        if (!cancelled) setStatus('error')
      })

    // Vote counts come from the STAFF-only analytics summary. Best-effort:
    // never let it fail the list, and don't call it for org members (403).
    if (isStaff(profile)) {
      fetchAnalyticsSummary(VOTE_DAYS)
        .then((summary) => {
          if (cancelled) return
          setVotes(Object.fromEntries(
            (summary.voteBreakdown ?? []).map((v) => [v.articleId, { up: v.up, down: v.down }]),
          ))
        })
        .catch((err: unknown) => console.error('newsletter admin: vote counts', err))
    }
    return () => { cancelled = true }
  }, [profile, reloadKey])

  async function handleDelete() {
    if (!toDelete) return
    setDeleting(true)
    setDeleteError('')
    try {
      await deleteArticle(toDelete.id)
      setArticles((prev) => prev.filter((a) => a.id !== toDelete.id))
      setToDelete(null)
    } catch (err) {
      console.error('newsletter admin: delete article', err)
      setDeleteError(t('admin.articles.deleteError'))
    } finally {
      setDeleting(false)
    }
  }

  const newButton = (
    <Link to={newsletterPath('/admin/articles/new')} className={buttonClass()}>
      <PlusIcon /> {t('admin.articles.new')}
    </Link>
  )

  const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, articles.filter((a) => (a.status ?? 'published') === s).length]))
  const tabs: TabItem<Filter>[] = [
    { id: 'all', label: t('admin.articles.filters.all'), count: articles.length },
    ...STATUS_ORDER.filter((s) => counts[s] > 0).map((s) => ({ id: s, label: t(`admin.status.${s}`), count: counts[s] })),
  ]
  // A filter whose last article was deleted falls back to "Todos".
  const activeFilter: Filter = tabs.some((tab) => tab.id === filter) ? filter : 'all'
  const visible = activeFilter === 'all' ? articles : articles.filter((a) => (a.status ?? 'published') === activeFilter)
  const pendingCount = counts.pending_review ?? 0

  return (
    <div className="flex flex-col gap-6">
      <AdminSectionHeader
        title={t('admin.articles.title')}
        subtitle={status === 'success' ? t('admin.articles.count', { count: articles.length }) : undefined}
        action={newButton}
      />

      {status === 'loading' && <SkeletonTable rows={6} cols={staff ? 6 : 5} />}

      {status === 'error' && (
        <ErrorState title={t('admin.articles.loadError')} onRetry={() => setReloadKey((k) => k + 1)} />
      )}

      {status === 'success' && articles.length === 0 && (
        <EmptyState
          title={t('admin.articles.emptyTitle')}
          body={t('admin.articles.emptyMessage')}
        />
      )}

      {status === 'success' && articles.length > 0 && (
        <>
          {staff && pendingCount > 0 && activeFilter !== 'pending_review' && (
            <Alert
              tone="warning"
              action={
                <Button variant="outline" size="sm" onClick={() => setFilter('pending_review')}>
                  {t('admin.articles.showPending')}
                </Button>
              }
            >
              {t('admin.articles.pendingReview', { count: pendingCount })}
            </Alert>
          )}

          {tabs.length > 2 && (
            <ToggleGroup
              options={tabs.map((it) => ({
                value: it.id,
                label: (
                  <span className="inline-flex items-center gap-2">
                    {it.label}
                    {it.count != null && <span className="opacity-70">{it.count}</span>}
                  </span>
                ),
              }))}
              value={activeFilter}
              onChange={setFilter}
              label={t('admin.articles.filters.label')}
            />
          )}

          <div>
            <TableCard>
              <thead>
                <tr className={theadRowClass}>
                  <Th className="min-w-[16rem]">{t('admin.articles.columns.title')}</Th>
                  <Th>{t('admin.articles.columns.status')}</Th>
                  <Th>{t('admin.articles.columns.category')}</Th>
                  <Th>{t('admin.articles.columns.organization')}</Th>
                  <Th>{t('admin.articles.columns.date')}</Th>
                  {staff && <Th>{t('admin.articles.columns.votes', { count: VOTE_DAYS })}</Th>}
                  <Th><span className="sr-only">{t('admin.common.actions')}</span></Th>
                </tr>
              </thead>
              <tbody>
                {visible.map((article) => (
                  <tr key={article.id} className={rowClass}>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-0.5">
                        <span className="font-body text-body-sm font-semibold text-ink-primary dark:text-night-text line-clamp-2">
                          {article.title}
                        </span>
                        {article.featured && (
                          <span className="font-mono text-label text-accent-700 dark:text-accent-300 uppercase tracking-widest">
                            {t('admin.articles.featured')}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <ArticleStatusBadge status={article.status ?? 'published'} />
                    </td>
                    <td className="px-4 py-3">
                      <CategoryBadge category={article.category} />
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-body text-body-sm text-ink-secondary dark:text-night-muted">
                        {article.organization ? orgName(article.organization) : t('admin.articles.independent')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <time className="font-mono text-label text-ink-secondary dark:text-night-muted whitespace-nowrap" dateTime={article.date ?? undefined}>
                        {formatDate(article.date, i18n.language)}
                      </time>
                    </td>
                    {staff && (
                      <td className="px-4 py-3">
                        <VoteCell votes={votes[article.id]} />
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        <Link
                          to={newsletterPath(`/admin/articles/${article.id}/edit`)}
                          className={buttonClass({ variant: 'ghost', size: 'sm' })}
                          aria-label={t('admin.articles.editAria', { title: article.title })}
                        >
                          {t('admin.common.edit')}
                        </Link>
                        {canDelete(article, staff, mineIds) && (
                          <Button
                            variant="dangerGhost"
                            size="sm"
                            onClick={() => { setDeleteError(''); setToDelete(article) }}
                            aria-label={t('admin.articles.deleteAria', { title: article.title })}
                          >
                            {t('admin.common.delete')}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableCard>
          </div>
        </>
      )}

      {toDelete && (
        <ConfirmDialog
          title={t('admin.articles.deleteDialog.title')}
          body={t('admin.articles.deleteDialog.body', { title: toDelete.title })}
          confirmLabel={t('admin.articles.deleteDialog.confirm')}
          busy={deleting}
          error={deleteError || undefined}
          onConfirm={handleDelete}
          onCancel={() => setToDelete(null)}
        />
      )}
    </div>
  )
}

function VoteCell({ votes }: { votes: VoteCounts | undefined }) {
  const { t } = useTranslation()
  if (!votes || (votes.up === 0 && votes.down === 0)) {
    return (
      <span className="font-mono text-label text-ink-secondary dark:text-night-muted">
        <span aria-hidden="true">—</span>
        <span className="sr-only">{t('admin.articles.noVotes')}</span>
      </span>
    )
  }
  return (
    <span className="flex items-center gap-2 font-mono text-label whitespace-nowrap">
      <span className="sr-only">{t('admin.articles.votesSr', { up: votes.up, down: votes.down })}</span>
      <span className="text-emerald-700 dark:text-emerald-300" aria-hidden="true">▲ {votes.up}</span>
      <span className="text-red-600 dark:text-red-400" aria-hidden="true">▼ {votes.down}</span>
    </span>
  )
}

function PlusIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
}
