import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ApiError } from '@/api/client'
import { Alert, EmptyState, ErrorState, LoadingRegion, Skeleton, SkeletonCards, buttonClass } from '@/components/ui'
import { isStaff } from '@/store/authStore'
import { useAuth } from '@/hooks/useAuth'
import { getOrganizations } from '@/newsletter/utils/session'
import { eventPath, orgAreaPath } from '@/newsletter/paths'
import { fetchOrgAnalytics } from '../../api/organizations'
import AdminSectionHeader from '../../components/admin/AdminSectionHeader'
import OrgSectionLinks from '../../components/admin/OrgSectionLinks'
import { TableCard, Th, rowClass, theadRowClass } from '../../components/admin/AdminTable'
import {
  BarChart, EmptyMetric, IconBell, IconEye, IconHeart, IconUser, RangePicker, Sparkline, StatCard, statCard,
  statCardLabel,
} from '../../components/admin/charts'
import { useAdminContext } from '../../admin/adminContext'
import { formatDate, localeFor } from '../../utils/dates'
import type { OrgAnalytics } from '../../types'

const RANGES = [
  { key: 'days7', days: 7 },
  { key: 'days30', days: 30 },
  { key: 'days90', days: 90 },
]

// An organization's numbers for its members: views of its articles and
// events, visitors, followers and push reach, over 7/30/90 days.
export default function OrgAnalyticsPage() {
  // The route is /mine/org/:slug/stats, so the param is always there.
  const { slug = '' } = useParams()
  const { t, i18n } = useTranslation()
  const { profile } = useAuth()
  const { orgName } = useAdminContext()
  const allowed = isStaff(profile) || getOrganizations(profile).some((m) => m.slug === slug)
  const locale = localeFor(i18n.language)

  const [days, setDays] = useState(30)
  const [data, setData] = useState<OrgAnalytics | null>(null)
  const [error, setError] = useState<'' | 'forbidden' | 'error'>('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!allowed) return
    let cancelled = false
    setError('')
    setData(null)
    fetchOrgAnalytics(slug, days)
      .then((d) => { if (!cancelled) setData(d) })
      .catch((e: unknown) => {
        console.error('newsletter: org analytics', e)
        if (!cancelled) setError(e instanceof ApiError && e.status === 403 ? 'forbidden' : 'error')
      })
    return () => { cancelled = true }
  }, [slug, days, allowed, reloadKey])

  if (!allowed || error === 'forbidden') {
    return (
      <EmptyState
        title={t('admin.orgStats.noAccessTitle')}
        body={t('admin.orgStats.noAccess')}
        action={<Link to={orgAreaPath(slug)} className={buttonClass({ variant: 'outline' })}>{t('admin.followers.backToProfileLong')}</Link>}
      />
    )
  }

  const header = (
    <>
      <AdminSectionHeader
        title={t('admin.orgStats.title')}
        subtitle={orgName(slug)}
        action={<RangePicker ranges={RANGES} active={days} onChange={setDays} />}
      />
      <OrgSectionLinks slug={slug} current="stats" />
    </>
  )

  if (error) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <ErrorState title={t('admin.orgStats.loadError')} onRetry={() => setReloadKey((k) => k + 1)} />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <SkeletonCards count={4} className="grid grid-cols-2 lg:grid-cols-4 gap-4" cardClassName="h-32" />
        <LoadingRegion className={statCard}>
          <Skeleton className="h-3 w-48 mb-4" />
          <Skeleton className="h-20 w-full" />
        </LoadingRegion>
      </div>
    )
  }

  const fmtNum = (n: number) => n.toLocaleString(locale)
  const fmtDay = (iso: string) => formatDate(iso, i18n.language, { day: 'numeric', month: 'short' })
  const views = data.articleViews + data.eventViews
  const daily = data.daily.map((d) => ({ date: d.date, value: d.articleViews + d.eventViews }))
  const followers = data.followers.cumulative.map((p) => ({ date: p.date, value: p.count }))

  return (
    <div className="flex flex-col gap-8">
      {header}

      {views === 0 && (
        <Alert tone="info" title={t('admin.orgStats.noViewsTitle')}>{t('admin.orgStats.noViews')}</Alert>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label={t('admin.orgStats.views')}
          value={fmtNum(views)}
          icon={<IconEye />}
          hint={t('admin.orgStats.viewsSplit', { articles: fmtNum(data.articleViews), events: fmtNum(data.eventViews) })}
        />
        <StatCard label={t('admin.orgStats.visitors')} value={fmtNum(data.uniqueVisitors)} icon={<IconUser />} hint={t('admin.orgStats.visitorsHint')} />
        <StatCard
          label={t('admin.orgStats.followers')}
          value={fmtNum(data.followers.total)}
          icon={<IconHeart />}
          hint={t('admin.orgStats.newFollowers', { count: data.followers.newInPeriod })}
        />
        <StatCard
          label={t('admin.orgStats.pushReach')}
          value={fmtNum(data.pushes.devicesReached)}
          icon={<IconBell />}
          hint={t('admin.orgStats.pushes', { count: data.pushes.pushes })}
        />
      </div>

      <Sparkline
        id="org-stats-daily"
        title={t('admin.orgStats.dailyViews')}
        data={daily}
        fmtDay={fmtDay}
        fmtNum={fmtNum}
        valueLabel={t('admin.analytics.columns.views')}
      />

      <Sparkline
        id="org-stats-followers"
        title={t('admin.orgStats.followersSeries')}
        data={followers}
        fmtDay={fmtDay}
        fmtNum={fmtNum}
        valueLabel={t('admin.orgStats.followers')}
        barClass="bg-accent-200 dark:bg-accent-700"
        floor={2}
      />
      <p className="-mt-6 font-body text-label text-ink-secondary dark:text-night-muted">{t('admin.orgStats.followersNote')}</p>

      <section className={statCard}>
        <h3 className={`${statCardLabel} mb-4`}>{t('admin.orgStats.topArticles')}</h3>
        {data.topArticles.length === 0 ? (
          <EmptyMetric label={t('admin.orgStats.noArticleViews')} />
        ) : (
          <BarChart data={data.topArticles.map((a) => ({ label: a.title, value: a.views }))} colorClass="bg-primary dark:bg-primary-400" />
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className={statCardLabel}>{t('admin.orgStats.events')}</h3>
        {data.events.length === 0 ? (
          <EmptyMetric label={t('admin.orgStats.noEvents')} />
        ) : (
          <TableCard minWidth="min-w-[540px]">
            <thead>
              <tr className={theadRowClass}>
                <Th>{t('admin.orgStats.columns.event')}</Th>
                <Th>{t('admin.orgStats.columns.date')}</Th>
                <Th>{t('admin.orgStats.columns.views')}</Th>
                <Th>{t('admin.orgStats.columns.rsvps')}</Th>
              </tr>
            </thead>
            <tbody>
              {data.events.map((e) => (
                <tr key={e.eventId} className={rowClass}>
                  <td className="px-4 py-3">
                    <Link to={eventPath(e.eventId)} className="font-body text-body-sm text-ink-primary dark:text-night-text hover:underline underline-offset-2 line-clamp-2">
                      {e.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-label text-ink-secondary dark:text-night-muted whitespace-nowrap">{fmtDay(e.date)}</td>
                  <td className="px-4 py-3 font-mono text-label text-ink-secondary dark:text-night-muted">{fmtNum(e.views)}</td>
                  <td className="px-4 py-3 font-mono text-label text-ink-secondary dark:text-night-muted">
                    {e.signupMode !== 'rsvp'
                      ? <span aria-label={t('admin.orgStats.noRsvp')}>—</span>
                      : e.capacity != null ? `${fmtNum(e.rsvpCount)}/${fmtNum(e.capacity)}` : fmtNum(e.rsvpCount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableCard>
        )}
      </section>
    </div>
  )
}
