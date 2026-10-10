import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, ErrorState, LoadingRegion, Skeleton, SkeletonCards } from '@/components/ui'
import { fetchAnalyticsSummary } from '../../api/analytics'
import { useCategoryLabel } from '../../hooks/useCategoryLabel'
import AdminSectionHeader from '../../components/admin/AdminSectionHeader'
import { TableCard, Th, rowClass, theadRowClass } from '../../components/admin/AdminTable'
import {
  BarChart, EmptyMetric, IconEye, IconThumb, IconUser, RangePicker, Sparkline, StatCard, statCard, statCardLabel,
} from '../../components/admin/charts'
import { addDaysISO, formatDate, localeFor, todayISO } from '../../utils/dates'
import type { AnalyticsSummary } from '../../types'

// GET /analytics/summary?days=N looks back N days and defaults to 30 when
// the param is missing, so "all time" must be an explicit, large window
// (the API has no upper bound; ~100 years covers all stored events).
const ALL_TIME_DAYS = 36500
const SPARK_DAYS = 14

const RANGES = [
  { key: 'days7',   days: 7  },
  { key: 'days30',  days: 30 },
  { key: 'allTime', days: ALL_TIME_DAYS },
]

const EMPTY_SUMMARY: AnalyticsSummary = {
  totalArticleViews: 0,
  uniqueVisitors:    0,
  topArticles:       [],
  categoryViews:     [],
  dailyViews:        [],
  voteBreakdown:     [],
}

const card = statCard
const cardLabel = statCardLabel

export default function AdminAnalyticsPage() {
  const [days, setDays]       = useState(30)
  const [summary, setSummary] = useState(EMPTY_SUMMARY)
  const [status, setStatus]   = useState<'loading' | 'success' | 'error'>('loading')
  const [reloadKey, setReloadKey] = useState(0)
  const { t, i18n } = useTranslation()
  const categoryLabel = useCategoryLabel()
  const locale = localeFor(i18n.language)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    fetchAnalyticsSummary(days)
      .then((data) => { if (!cancelled) { setSummary(data); setStatus('success') } })
      .catch((err: unknown) => {
        console.error('newsletter admin: analytics', err)
        if (!cancelled) setStatus('error')
      })
    return () => { cancelled = true }
  }, [days, reloadKey])

  const totalVotes = useMemo(
    () => summary.voteBreakdown.reduce((s, v) => s + v.up + v.down, 0),
    [summary.voteBreakdown],
  )

  const articleRows = useMemo(() => {
    const voteMap = Object.fromEntries(
      summary.voteBreakdown.map((v) => [v.articleId, { up: v.up, down: v.down }]),
    )
    return summary.topArticles.map((a) => ({
      id:    a.articleId,
      title: a.title,
      views: a.views,
      votes: voteMap[a.articleId] ?? { up: 0, down: 0 },
    }))
  }, [summary])

  const catData = useMemo(
    () => summary.categoryViews.map(({ category, views }) => ({ label: categoryLabel(category), value: views })),
    [summary.categoryViews, categoryLabel],
  )

  const sparkData = useMemo(() => {
    const viewsMap = Object.fromEntries(summary.dailyViews.map(({ date, views }) => [date, views]))
    const today = todayISO()
    return Array.from({ length: SPARK_DAYS }, (_, i) => {
      const key = addDaysISO(today, -(SPARK_DAYS - 1 - i))
      return { date: key, value: viewsMap[key] ?? 0 }
    })
  }, [summary.dailyViews])

  const header = (
    <AdminSectionHeader
      subtitle={t('admin.analytics.subtitle')}
      action={<RangePicker ranges={RANGES} active={days} onChange={setDays} />}
    />
  )

  if (status === 'error') {
    return (
      <div className="flex flex-col gap-8">
        {header}
        <ErrorState title={t('admin.analytics.loadError')} onRetry={() => setReloadKey((k) => k + 1)} />
      </div>
    )
  }

  if (status === 'loading') {
    return (
      <div className="flex flex-col gap-8">
        {header}
        <SkeletonCards count={3} className="grid grid-cols-2 lg:grid-cols-3 gap-4" cardClassName="h-32" />
        <LoadingRegion className={card}>
          <Skeleton className="h-3 w-48 mb-4" />
          <Skeleton className="h-20 w-full" />
        </LoadingRegion>
        <SkeletonCards count={2} className="grid grid-cols-1 lg:grid-cols-2 gap-6" cardClassName="h-56" />
      </div>
    )
  }

  const fmtDay = (iso: string) => formatDate(iso, i18n.language, { day: 'numeric', month: 'short' })
  const fmtNum = (n: number) => n.toLocaleString(locale)
  const noData = summary.totalArticleViews === 0
  const viewedRows = articleRows.filter((a) => a.views > 0)

  return (
    <div className="flex flex-col gap-8">
      {header}

      {noData && (
        <Alert tone="info" title={t('admin.analytics.noDataTitle')}>{t('admin.analytics.noDataMessage')}</Alert>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard label={t('admin.analytics.articleViews')}   value={fmtNum(summary.totalArticleViews)} icon={<IconEye />} />
        <StatCard label={t('admin.analytics.uniqueVisitors')} value={fmtNum(summary.uniqueVisitors)}    icon={<IconUser />} />
        <StatCard label={t('admin.analytics.totalVotes')}     value={fmtNum(totalVotes)}                icon={<IconThumb />} />
      </div>

      {/* Sparkline — daily views */}
      <Sparkline
        id="analytics-daily"
        title={t('admin.analytics.dailyViews', { count: SPARK_DAYS })}
        data={sparkData}
        fmtDay={fmtDay}
        fmtNum={fmtNum}
        valueLabel={t('admin.analytics.columns.views')}
      />

      {/* Two-column: top articles + category breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className={card}>
          <h3 className={`${cardLabel} mb-4`}>{t('admin.analytics.topArticles')}</h3>
          {viewedRows.length === 0 ? (
            <EmptyMetric label={t('admin.analytics.noViews')} />
          ) : (
            <BarChart data={viewedRows.map((a) => ({ label: a.title, value: a.views }))} colorClass="bg-primary dark:bg-primary-400" />
          )}
        </section>

        <section className={card}>
          <h3 className={`${cardLabel} mb-4`}>{t('admin.analytics.categoryViews')}</h3>
          {catData.length === 0 ? (
            <EmptyMetric label={t('admin.analytics.noCategoryData')} />
          ) : (
            <BarChart data={catData} colorClass="bg-accent-400" />
          )}
        </section>
      </div>

      {/* Vote breakdown table */}
      <section className="flex flex-col gap-3">
        <div>
          <h3 className={cardLabel}>{t('admin.analytics.votesByArticle')}</h3>
          <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted mt-0.5">
            {t('admin.analytics.votesPrivate')}
          </p>
        </div>
        {articleRows.length === 0 ? (
          <EmptyMetric label={t('admin.analytics.noViews')} />
        ) : (
          <TableCard minWidth="min-w-[540px]">
            <thead>
              <tr className={theadRowClass}>
                <Th>{t('admin.analytics.columns.article')}</Th>
                <Th>{t('admin.analytics.columns.helpful')}</Th>
                <Th>{t('admin.analytics.columns.notHelpful')}</Th>
                <Th>{t('admin.analytics.columns.ratio')}</Th>
                <Th>{t('admin.analytics.columns.views')}</Th>
              </tr>
            </thead>
            <tbody>
              {articleRows.map((a) => {
                const total = a.votes.up + a.votes.down
                const ratio = total > 0 ? Math.round((a.votes.up / total) * 100) : null
                return (
                  <tr key={a.id} className={rowClass}>
                    <td className="px-4 py-3">
                      <span className="font-body text-body-sm text-ink-primary dark:text-night-text line-clamp-2">{a.title}</span>
                    </td>
                    <td className="px-4 py-3 font-mono text-label text-emerald-700 dark:text-emerald-300">{a.votes.up}</td>
                    <td className="px-4 py-3 font-mono text-label text-red-600 dark:text-red-400">{a.votes.down}</td>
                    <td className="px-4 py-3">
                      {ratio !== null ? (
                        <span className={[
                          'font-mono text-label',
                          ratio >= 70 ? 'text-emerald-700 dark:text-emerald-300' : ratio >= 40 ? 'text-amber-700 dark:text-amber-300' : 'text-red-600 dark:text-red-400',
                        ].join(' ')}>
                          {ratio}%
                        </span>
                      ) : (
                        <span className="font-mono text-label text-ink-secondary dark:text-night-muted">
                          <span aria-hidden="true">—</span>
                          <span className="sr-only">{t('admin.analytics.noVotes')}</span>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-label text-ink-secondary dark:text-night-muted">{fmtNum(a.views)}</td>
                  </tr>
                )
              })}
            </tbody>
          </TableCard>
        )}
      </section>
    </div>
  )
}
