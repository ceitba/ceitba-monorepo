import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import CategoryBadge from '../CategoryBadge'
import ArticleStatusBadge from './ArticleStatusBadge'
import { TableCard, Th, rowClass, theadRowClass } from './AdminTable'
import { formatDate } from '../../utils/dates'
import { Button, buttonClass } from '@/components/ui'
import type { Article, VoteCounts } from '../../types'

// The article list of Mis publicaciones and of the staff admin's "Todos los
// artículos": title, status, category, organization, date, an optional votes
// column (staff only) and edit/delete actions.
export default function ArticlesTable({
  articles,
  orgName,
  editPath,
  canDelete,
  onDelete,
  votes,
  voteDays,
}: {
  articles: Article[]
  orgName: (slug: string | null | undefined) => string
  editPath: (article: Article) => string
  canDelete: (article: Article) => boolean
  onDelete: (article: Article) => void
  // Omit to hide the votes column.
  votes?: Record<string, VoteCounts>
  voteDays?: number
}) {
  const { t, i18n } = useTranslation()
  return (
    <TableCard>
      <thead>
        <tr className={theadRowClass}>
          <Th className="min-w-[16rem]">{t('admin.articles.columns.title')}</Th>
          <Th>{t('admin.articles.columns.status')}</Th>
          <Th>{t('admin.articles.columns.category')}</Th>
          <Th>{t('admin.articles.columns.organization')}</Th>
          <Th>{t('admin.articles.columns.date')}</Th>
          {votes && <Th>{t('admin.articles.columns.votes', { count: voteDays })}</Th>}
          <Th><span className="sr-only">{t('admin.common.actions')}</span></Th>
        </tr>
      </thead>
      <tbody>
        {articles.map((article) => (
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
            {votes && (
              <td className="px-4 py-3">
                <VoteCell votes={votes[article.id]} />
              </td>
            )}
            <td className="px-4 py-3">
              <div className="flex items-center gap-1 justify-end">
                <Link
                  to={editPath(article)}
                  className={buttonClass({ variant: 'ghost', size: 'sm' })}
                  aria-label={t('admin.articles.editAria', { title: article.title })}
                >
                  {t('admin.common.edit')}
                </Link>
                {canDelete(article) && (
                  <Button
                    variant="dangerGhost"
                    size="sm"
                    onClick={() => onDelete(article)}
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
