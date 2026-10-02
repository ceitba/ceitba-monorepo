import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ALL_STATUSES, deleteArticle, fetchAllArticles } from '../../api/articles'
import { fetchAnalyticsSummary } from '../../api/analytics'
import CategoryBadge from '../../components/CategoryBadge'
import { formatDate } from '../../utils/dates'
import { getOrganizations, isStaff } from '../../store/authStore'
import { useAuthSession } from '../../hooks/useAuthSession'

// Articles visible to the current admin user, drafts included.
//
// Staff list everything with one ?status=all walk (already newest first).
// Org members get ?status=all scoped to each of their organizations — the
// API returns an org's drafts to its members — merged and re-sorted.
async function loadArticles(profile) {
  if (isStaff(profile)) {
    return fetchAllArticles({ status: ALL_STATUSES })
  }
  const slugs = getOrganizations(profile).map((o) => o.slug)
  const lists = await Promise.all(
    slugs.map((organization) => fetchAllArticles({ organization, status: ALL_STATUSES })),
  )
  return sortNewestFirst(dedupeById(lists.flat()))
}

function dedupeById(list) {
  return [...new Map(list.map((a) => [a.id, a])).values()]
}

function sortNewestFirst(list) {
  return [...list].sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
}

export default function AdminArticlesPage() {
  const { t, i18n } = useTranslation()
  const { profile } = useAuthSession()
  const staff = isStaff(profile)
  const [articles, setArticles] = useState([])
  const [votes, setVotes]       = useState({})
  const [status, setStatus]     = useState('loading')
  const [confirmId, setConfirmId] = useState(null)
  const [deleteError, setDeleteError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!profile) return
    let cancelled = false
    setStatus('loading')
    loadArticles(profile)
      .then((list) => {
        if (cancelled) return
        setArticles(list)
        setStatus('success')
      })
      .catch(() => { if (!cancelled) setStatus('error') })

    // Vote counts come from the STAFF-only analytics summary. Best-effort:
    // never let it fail the list, and don't call it for org members (403).
    if (isStaff(profile)) {
      fetchAnalyticsSummary(30)
        .then((summary) => {
          if (cancelled) return
          setVotes(Object.fromEntries(
            (summary.voteBreakdown ?? []).map((v) => [v.articleId, { up: v.up, down: v.down }]),
          ))
        })
        .catch(() => {})
    }
    return () => { cancelled = true }
  }, [profile, reloadKey])

  async function handleDelete(id) {
    setDeleteError('')
    try {
      await deleteArticle(id)
      setArticles((prev) => prev.filter((a) => a.id !== id))
    } catch {
      setDeleteError(t('admin.articles.deleteError'))
    }
    setConfirmId(null)
  }

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center py-32" aria-busy="true">
        <p className="font-mono text-label text-ink-secondary uppercase tracking-widest">{t('admin.articles.loading')}</p>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-4 text-center">
        <p className="font-display text-h5 font-bold text-ink-primary">{t('admin.articles.loadError')}</p>
        <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="min-h-[44px] px-5 bg-primary text-surface font-body font-semibold rounded-sm hover:bg-primary-600 transition-colors duration-150">
          {t('admin.common.retry')}
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-h3 font-bold text-ink-primary">{t('admin.articles.title')}</h1>
          <p className="font-body text-body-sm text-ink-secondary mt-0.5">
            {t('admin.articles.count', { count: articles.length })}
          </p>
        </div>
        <Link
          to="/admin/articles/new"
          className="inline-flex items-center gap-2 min-h-[44px] px-4 bg-primary text-surface font-body text-body-sm font-semibold rounded-sm hover:bg-primary-600 transition-colors duration-150 focus-visible:rounded"
        >
          <PlusIcon /> {t('admin.articles.new')}
        </Link>
      </div>

      {deleteError && (
        <p role="alert" className="font-body text-body-sm text-red-600 bg-red-50 px-3 py-2 rounded-sm">
          {deleteError}
        </p>
      )}

      {/* Table */}
      {articles.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="bg-white rounded-card border border-border shadow-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="border-b border-border bg-surface">
                  <Th>{t('admin.articles.columns.title')}</Th>
                  <Th>{t('admin.articles.columns.status')}</Th>
                  <Th>{t('admin.articles.columns.category')}</Th>
                  <Th>{t('admin.articles.columns.organization')}</Th>
                  <Th>{t('admin.articles.columns.date')}</Th>
                  {staff && <Th>{t('admin.articles.columns.votes')}</Th>}
                  <Th><span className="sr-only">{t('admin.common.actions')}</span></Th>
                </tr>
              </thead>
              <tbody>
                {articles.map((article) => (
                  <tr
                    key={article.id}
                    className="border-b border-border last:border-b-0 hover:bg-surface transition-colors duration-100"
                  >
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-0.5">
                        <span className="font-body text-body-sm font-semibold text-ink-primary line-clamp-1">
                          {article.title}
                        </span>
                        {article.featured && (
                          <span className="font-mono text-label text-accent-500 uppercase tracking-widest">
                            {t('admin.articles.featured')}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={article.status ?? 'published'} />
                    </td>
                    <td className="px-4 py-3">
                      <CategoryBadge category={article.category} />
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-label text-ink-secondary uppercase tracking-widest">
                        {article.organization}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <time className="font-mono text-label text-ink-secondary" dateTime={article.date}>
                        {formatDate(article.date, i18n.language)}
                      </time>
                    </td>
                    {staff && (
                      <td className="px-4 py-3">
                        <VotePill votes={votes[article.id]} />
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        <Link
                          to={`/admin/articles/${article.id}/edit`}
                          className="min-h-[36px] px-3 inline-flex items-center font-body text-body-sm text-primary hover:bg-primary-50 rounded-sm transition-colors duration-150 focus-visible:rounded"
                        >
                          {t('admin.common.edit')}
                        </Link>
                        {/* DELETE /articles/{id} is STAFF-only on the API. */}
                        {staff && (confirmId === article.id ? (
                          <span className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleDelete(article.id)}
                              className="min-h-[36px] px-3 font-body text-body-sm text-red-600 hover:bg-red-50 rounded-sm transition-colors duration-150"
                            >
                              {t('admin.common.confirm')}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmId(null)}
                              className="min-h-[36px] px-2 font-body text-body-sm text-ink-secondary hover:bg-surface rounded-sm transition-colors duration-150"
                            >
                              {t('admin.common.cancel')}
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmId(article.id)}
                            className="min-h-[36px] px-3 font-body text-body-sm text-ink-secondary hover:text-red-600 hover:bg-red-50 rounded-sm transition-colors duration-150"
                          >
                            {t('admin.common.delete')}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function Th({ children }) {
  return (
    <th className="px-4 py-3 text-left font-mono text-label uppercase tracking-widest text-ink-secondary">
      {children}
    </th>
  )
}

const STATUS_STYLES = {
  published:          'bg-emerald-50 text-emerald-700',
  draft:              'bg-amber-50 text-amber-700',
  pending_review:     'bg-amber-50 text-amber-700',
  changes_requested:  'bg-blue-50 text-blue-700',
  rejected:           'bg-red-50 text-red-600',
}

function StatusBadge({ status }) {
  const { t } = useTranslation()
  const cls = STATUS_STYLES[status] ?? 'bg-surface text-ink-secondary'
  return (
    <span className={['font-mono text-label uppercase tracking-widest px-2 py-0.5 rounded-sm', cls].join(' ')}>
      {t(`admin.status.${status}`, { defaultValue: status })}
    </span>
  )
}

function EmptyState() {
  const { t } = useTranslation()
  return (
    <div className="bg-white rounded-card border border-border shadow-card flex flex-col items-center justify-center py-20 gap-4 text-center">
      <div className="relative w-16 h-16">
        <div className="absolute inset-0 rounded-full bg-primary-50" />
        <div className="absolute top-3 left-3 w-8 h-8 rotate-45 bg-accent-100" />
      </div>
      <p className="font-display text-h5 font-bold text-ink-primary">{t('admin.articles.emptyTitle')}</p>
      <p className="font-body text-body-sm text-ink-secondary">{t('admin.articles.emptyMessage')}</p>
      <Link
        to="/admin/articles/new"
        className="inline-flex items-center gap-2 min-h-[44px] px-5 bg-primary text-surface font-body text-body-sm font-semibold rounded-sm hover:bg-primary-600 transition-colors duration-150"
      >
        <PlusIcon /> {t('admin.articles.new')}
      </Link>
    </div>
  )
}

function VotePill({ votes }) {
  if (!votes || (votes.up === 0 && votes.down === 0)) {
    return <span className="font-mono text-label text-border">—</span>
  }
  return (
    <span className="flex items-center gap-2 font-mono text-label">
      <span className="text-emerald-600">▲ {votes.up}</span>
      <span className="text-red-500">▼ {votes.down}</span>
    </span>
  )
}

function PlusIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
}
