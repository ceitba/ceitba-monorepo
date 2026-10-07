import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ALL_STATUSES, fetchAllArticles } from '../../api/articles'
import AdminSectionHeader from '../../components/admin/AdminSectionHeader'
import ArticlesTable from '../../components/admin/ArticlesTable'
import DeleteArticleDialog from '../../components/admin/DeleteArticleDialog'
import { useAdminContext } from '../../admin/adminContext'
import { isStaff, writerOrgSlugs } from '../../store/authStore'
import { useAuthSession } from '../../hooks/useAuthSession'
import { NEW_ARTICLE_PATH, articleEditPath } from '@/newsletter/paths'
import { EmptyState, ErrorState, SkeletonTable, ToggleGroup, buttonClass, type TabItem } from '@/components/ui'
import type { UserProfile } from '@/store/authStore'
import type { Article, ArticleStatus } from '../../types'

// Status filters, in the order a writer cares about them; only statuses
// that have articles get one.
const STATUS_ORDER: ArticleStatus[] = ['draft', 'pending_review', 'changes_requested', 'published', 'rejected']
type Filter = 'all' | ArticleStatus

// The user's own independent articles (?mine=true, any status) plus every
// article of their organizations (?organization=X&status=all, which the API
// serves to members), merged and sorted newest first. `mineIds` are the ones
// they wrote: their unpublished independent articles are theirs to delete.
async function loadArticles(profile: UserProfile): Promise<{ list: Article[]; mineIds: Set<string> }> {
  const [mine, ...lists] = await Promise.all([
    fetchAllArticles({ mine: true, status: ALL_STATUSES }),
    ...writerOrgSlugs(profile).map((organization) => fetchAllArticles({ organization, status: ALL_STATUSES })),
  ])
  return {
    list: sortNewestFirst(dedupeById([...mine, ...lists.flat()])),
    mineIds: new Set(mine.map((a) => a.id)),
  }
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

export default function MyArticlesPage() {
  const { t } = useTranslation()
  const { profile } = useAuthSession()
  const { orgName } = useAdminContext()
  const staff = isStaff(profile)
  const [articles, setArticles] = useState<Article[]>([])
  const [mineIds, setMineIds]   = useState(() => new Set<string>())
  const [status, setStatus]     = useState<'loading' | 'success' | 'error'>('loading')
  const [filter, setFilter]     = useState<Filter>('all')
  const [toDelete, setToDelete] = useState<Article | null>(null)
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
        console.error('newsletter: my articles', err)
        if (!cancelled) setStatus('error')
      })
    return () => { cancelled = true }
  }, [profile, reloadKey])

  // The API lets authors delete their own unpublished independent articles;
  // staff delete any.
  const canDelete = (a: Article) =>
    staff || (mineIds.has(a.id) && !a.organization && a.status !== 'published')

  const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, articles.filter((a) => (a.status ?? 'published') === s).length]))
  const filters: TabItem<Filter>[] = [
    { id: 'all', label: t('admin.articles.filters.all'), count: articles.length },
    ...STATUS_ORDER.filter((s) => counts[s] > 0).map((s) => ({ id: s, label: t(`admin.status.${s}`), count: counts[s] })),
  ]
  // A filter whose last article was deleted falls back to "Todos".
  const activeFilter: Filter = filters.some((f) => f.id === filter) ? filter : 'all'
  const visible = activeFilter === 'all' ? articles : articles.filter((a) => (a.status ?? 'published') === activeFilter)
  const empty = status === 'success' && articles.length === 0

  return (
    <div className="flex flex-col gap-6">
      <AdminSectionHeader
        subtitle={status === 'success' && !empty ? t('admin.articles.count', { count: articles.length }) : undefined}
        // The empty state carries the one primary action instead.
        action={empty ? undefined : (
          <Link to={NEW_ARTICLE_PATH} className={buttonClass()}>
            <PlusIcon /> {t('admin.articles.new')}
          </Link>
        )}
      />

      {status === 'loading' && <SkeletonTable rows={6} cols={6} />}

      {status === 'error' && (
        <ErrorState title={t('admin.articles.loadError')} onRetry={() => setReloadKey((k) => k + 1)} />
      )}

      {empty && (
        <EmptyState
          title={t('mine.articles.emptyTitle')}
          body={t('mine.articles.emptyBody')}
          action={
            <Link to={NEW_ARTICLE_PATH} className={buttonClass()}>
              {t('mine.articles.write')}
            </Link>
          }
        />
      )}

      {status === 'success' && articles.length > 0 && (
        <>
          {filters.length > 2 && (
            <ToggleGroup
              options={filters.map((it) => ({
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

          <ArticlesTable
            articles={visible}
            orgName={orgName}
            editPath={(a) => articleEditPath(a.id)}
            canDelete={canDelete}
            onDelete={setToDelete}
          />
        </>
      )}

      {toDelete && (
        <DeleteArticleDialog
          article={toDelete}
          onDeleted={(gone) => {
            setArticles((prev) => prev.filter((a) => a.id !== gone.id))
            setToDelete(null)
          }}
          onCancel={() => setToDelete(null)}
        />
      )}
    </div>
  )
}

function PlusIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
}
