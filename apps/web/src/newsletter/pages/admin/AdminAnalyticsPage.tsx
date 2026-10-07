import { useState, useEffect, useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, ErrorState, LoadingRegion, Skeleton, SkeletonCards } from '@/components/ui'
import { fetchAnalyticsSummary } from '../../api/analytics'
import { useCategoryLabel } from '../../hooks/useCategoryLabel'
import AdminSectionHeader from '../../components/admin/AdminSectionHeader'
import { TableCard, Th, rowClass, theadRowClass } from '../../components/admin/AdminTable'
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

const card = 'bg-white dark:bg-night-surface rounded-card border border-border dark:border-night-border shadow-card p-5'
const cardLabel = 'font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted'

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
      title={t('admin.analytics.title')}
      subtitle={t('admin.analytics.subtitle')}
      action={<RangePicker active={days} onChange={setDays} />}
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

  const sparkValues = sparkData.map((d) => d.value)
  const sparkMax = Math.max(...sparkValues, 1)
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
      <section className={card} aria-labelledby="analytics-daily">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-4">
          <h3 id="analytics-daily" className={cardLabel}>{t('admin.analytics.dailyViews', { count: SPARK_DAYS })}</h3>
          {/* The values without hovering: min / max / today. */}
          <p className="font-mono text-label text-ink-secondary dark:text-night-muted">
            {t('admin.analytics.sparkSummary', {
              min: fmtNum(Math.min(...sparkValues)),
              max: fmtNum(Math.max(...sparkValues)),
              last: fmtNum(sparkValues[sparkValues.length - 1] ?? 0),
            })}
          </p>
        </div>
        <div className="flex items-end gap-1 h-20" aria-hidden="true">
          {sparkData.map(({ date, value }) => (
            <div key={date} className="flex-1 flex flex-col items-center">
              <div
                className="w-full bg-primary-200 dark:bg-primary-700 rounded-sm"
                style={{ height: `${Math.max(4, (value / sparkMax) * 100)}%` }}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-between mt-1 font-mono text-label text-ink-secondary dark:text-night-muted" aria-hidden="true">
          <span>{fmtDay(sparkData[0].date)}</span>
          <span>{fmtDay(sparkData[sparkData.length - 1].date)}</span>
        </div>
        <table className="sr-only">
          <caption>{t('admin.analytics.dailyViews', { count: SPARK_DAYS })}</caption>
          <thead>
            <tr><th scope="col">{t('admin.analytics.columns.day')}</th><th scope="col">{t('admin.analytics.columns.views')}</th></tr>
          </thead>
          <tbody>
            {sparkData.map(({ date, value }) => (
              <tr key={date}><td>{fmtDay(date)}</td><td>{value}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

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

// ── Sub-components ────────────────────────────────────────────────────────

function RangePicker({ active, onChange }: { active: number; onChange: (days: number) => void }) {
  const { t } = useTranslation()
  return (
    <div role="group" aria-label={t('admin.analytics.rangeLabel')} className="flex rounded-sm border border-border dark:border-night-border overflow-hidden">
      {RANGES.map(({ key, days }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(days)}
          aria-pressed={active === days}
          className={[
            'min-h-[44px] px-4 font-mono text-label uppercase tracking-widest transition-colors duration-150',
            active === days
              ? 'bg-primary text-white'
              : 'bg-white dark:bg-night-surface text-ink-secondary dark:text-night-muted hover:text-ink-primary dark:hover:text-night-text hover:bg-primary-50 dark:hover:bg-night-raised',
          ].join(' ')}
        >
          {t(`admin.analytics.ranges.${key}`)}
        </button>
      ))}
    </div>
  )
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <div className={`${card} flex flex-col gap-2`}>
      <div className="w-8 h-8 text-primary dark:text-primary-300" aria-hidden="true">{icon}</div>
      <p className="font-display text-h3 font-bold text-ink-primary dark:text-night-text tabular-nums">{value}</p>
      <p className="font-mono text-label text-ink-secondary dark:text-night-muted uppercase tracking-widest">{label}</p>
    </div>
  )
}

interface BarDatum {
  label: string
  value: number
}

function BarChart({ data, colorClass }: { data: BarDatum[]; colorClass: string }) {
  const max = Math.max(...data.map((d) => d.value), 1)
  return (
    <ul className="flex flex-col gap-3 list-none m-0 p-0">
      {data.map(({ label, value }) => (
        <li key={label} className="flex items-center gap-3">
          <span className="w-36 font-body text-body-sm text-ink-secondary dark:text-night-muted text-right flex-shrink-0 break-words">
            {label}
          </span>
          <div className="flex-1 bg-page-bg dark:bg-night-raised rounded-full h-2.5" aria-hidden="true">
            <div className={['h-2.5 rounded-full', colorClass].join(' ')} style={{ width: `${(value / max) * 100}%` }} />
          </div>
          <span className="w-10 font-mono text-label text-ink-secondary dark:text-night-muted text-right flex-shrink-0">{value}</span>
        </li>
      ))}
    </ul>
  )
}

function EmptyMetric({ label }: { label: string }) {
  return <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted py-4 text-center">{label}</p>
}

function IconEye() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
}
function IconUser() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
}
function IconThumb() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
}
