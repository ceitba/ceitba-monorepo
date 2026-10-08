import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ApiError } from '@/api/client'
import { EmptyState, ErrorState, Field, LoadingRegion, Skeleton, buttonClass, inputClass } from '@/components/ui'
import { fetchOrganizationFollowers } from '../../api/follows'
import { canViewFollowers } from '../../store/authStore'
import { useAuthSession } from '../../hooks/useAuthSession'
import AdminSectionHeader from '../../components/admin/AdminSectionHeader'
import { useAdminContext } from '../../admin/adminContext'
import { localeFor } from '../../utils/dates'
import { newsletterPath } from '@/newsletter/paths'
import type { Follower } from '../../types'

// GET /organizations/{slug}/followers → { data, count }.
interface FollowersResponse {
  data?: Follower[]
  count?: number
}

// Followers expose names and emails: the API serves them only to staff and
// to the org's admins (membership role 'admin'), so plain members get the
// no-access screen instead of a request that would 403.
export default function OrgFollowersPage() {
  // The route is /mine/org/:slug, so the param is always there.
  const { slug = '' } = useParams()
  const { t, i18n } = useTranslation()
  const { profile } = useAuthSession()
  const { orgName } = useAdminContext()
  const allowed = canViewFollowers(slug, profile)

  const [data, setData]       = useState<FollowersResponse | null>(null)
  const [error, setError]     = useState<'' | 'forbidden' | 'loadError'>('')
  const [query, setQuery]     = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!allowed) return
    let cancelled = false
    setData(null)
    setError('')
    fetchOrganizationFollowers(slug)
      .then((followers) => { if (!cancelled) setData(followers) })
      // Roles can change server-side after /auth/me was cached, so a 403
      // is still possible; show it as a message, not a crash.
      .catch((e: unknown) => {
        console.error('newsletter admin: followers', e)
        if (!cancelled) setError(e instanceof ApiError && e.status === 403 ? 'forbidden' : 'loadError')
      })
    return () => { cancelled = true }
  }, [slug, allowed, reloadKey])

  const back = { to: newsletterPath(`/mine/org/${slug}`), label: t('admin.followers.backToProfile') }

  if (!allowed || error === 'forbidden') {
    return (
      <EmptyState
        title={t('admin.followers.noAccessTitle')}
        body={t(allowed ? 'admin.followers.forbidden' : 'admin.followers.noAccess')}
        action={<Link to={back.to} className={buttonClass({ variant: 'outline' })}>{t('admin.followers.backToProfileLong')}</Link>}
      />
    )
  }

  if (error) {
    return (
      <ErrorState
        title={t('admin.followers.loadError')}
        onRetry={() => setReloadKey((k) => k + 1)}
        backTo={back.to}
        backLabel={t('admin.followers.backToProfileLong')}
      />
    )
  }

  const followers = data?.data ?? []
  const count = data?.count ?? followers.length

  const q = query.trim().toLowerCase()
  const visible = q
    ? followers.filter((f) =>
        (f.name ?? '').toLowerCase().includes(q) ||
        (f.email ?? '').toLowerCase().includes(q))
    : followers

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <AdminSectionHeader
        title={t('admin.followers.title')}
        subtitle={data ? t('admin.followers.subtitle', { org: orgName(slug), count }) : orgName(slug)}
        back={back}
      />

      {!data ? (
        <LoadingRegion className="flex flex-col gap-3">
          <Skeleton className="h-11 w-full" />
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
        </LoadingRegion>
      ) : followers.length === 0 ? (
        <EmptyState title={t('admin.followers.emptyTitle')} body={t('admin.followers.empty')} />
      ) : (
        <>
          <Field label={t('admin.followers.searchLabel')}>
            {(p) => (
              <input
                {...p}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('admin.followers.searchPlaceholder')}
                className={inputClass()}
              />
            )}
          </Field>

          {visible.length === 0 ? (
            <EmptyState compact title={t('admin.followers.noMatches')} />
          ) : (
            <ul className="flex flex-col list-none m-0 p-0 border border-border dark:border-night-border rounded-card bg-white dark:bg-night-surface divide-y divide-border dark:divide-night-border">
              {visible.map((f) => (
                <li key={f.userId} className="flex items-center gap-3 p-3">
                  {f.avatarUrl
                    ? <img src={f.avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover bg-page-bg dark:bg-night-raised" />
                    : <div className="w-9 h-9 rounded-full bg-page-bg dark:bg-night-raised" aria-hidden="true" />}
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-body font-bold text-ink-primary dark:text-night-text truncate">
                      {f.name || f.email}
                    </p>
                    {f.name && (
                      <p className="font-mono text-label text-ink-secondary dark:text-night-muted truncate">{f.email}</p>
                    )}
                  </div>
                  <time
                    dateTime={f.followedAt}
                    className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted whitespace-nowrap"
                  >
                    {formatFollowedAt(f.followedAt, i18n.language)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

function formatFollowedAt(iso: string | null | undefined, lang: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(localeFor(lang), { day: '2-digit', month: 'short', year: 'numeric' })
}
