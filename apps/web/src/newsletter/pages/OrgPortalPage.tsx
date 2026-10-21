import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button, EmptyState, ErrorState, LoadingRegion, Skeleton, Switch, buttonClass, toast } from '@/components/ui'
import { ApiError } from '@/api/client'
import ArticleCard from '../components/ArticleCard'
import EventCard from '../components/EventCard'
import { fetchOrganizationBySlug } from '../api/organizations'
import { fetchArticles } from '../api/articles'
import { fetchEvents } from '../api/events'
import { followOrganization, unfollowOrganization } from '../api/follows'
import { fetchOrgMailPreference, setOrgMailPreference } from '../api/orgMail'
import { getSession } from '@/store/authStore'
import { isFollowing, refreshFollows } from '@/newsletter/utils/session'
import { localeFor, todayISO } from '../utils/dates'
import { eventPath, newsletterPath } from '@/newsletter/paths'
import type { Article, NewsEvent, Organization } from '../types'

const GEO_BG: Record<string, string> = {
  blue:   'bg-primary-500',
  amber:  'bg-accent-400',
  green:  'bg-emerald-600',
  violet: 'bg-violet-600',
}

export default function OrgPortalPage() {
  // The route always defines :slug.
  const { slug = '' } = useParams()
  const { t, i18n } = useTranslation()

  const [org, setOrg]         = useState<Organization | null>(null)
  const [articles, setArticles] = useState<Article[]>([])
  const [events, setEvents]     = useState<NewsEvent[]>([])
  const [status, setStatus]     = useState<'loading' | 'success' | 'notFound' | 'error'>('loading')
  const [reloadKey, setReloadKey] = useState(0)
  const [authed, setAuthed]     = useState(false)
  const [following, setFollowing] = useState(false)
  const [followBusy, setFollowBusy] = useState(false)
  // Whether the follower gets the org's emails (null = unknown / not following).
  const [mailOn, setMailOn] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')

    Promise.all([
      fetchOrganizationBySlug(slug),
      fetchArticles({ organization: slug }),
      fetchEvents({ organization: slug, from: todayISO(), limit: 4 }),
    ])
      .then(([orgData, articlesRes, eventsRes]) => {
        if (cancelled) return
        setOrg(orgData)
        setArticles(articlesRes.data)
        const today = todayISO()
        setEvents(eventsRes.data.filter((e) => e.date >= today).slice(0, 4))
        setStatus('success')
      })
      .catch((err: unknown) => {
        if (!cancelled) setStatus(err instanceof ApiError && err.status === 404 ? 'notFound' : 'error')
      })

    return () => { cancelled = true }
  }, [slug, reloadKey])

  useEffect(() => {
    let cancelled = false
    // Cookie auth is invisible to JS — just ask /me. getSession() caches so
    // this is one round-trip per page load even across multiple components.
    getSession().then((profile) => {
      if (cancelled) return
      setAuthed(Boolean(profile))
      setFollowing(profile ? isFollowing(slug) : false)
    })
    return () => { cancelled = true }
  }, [slug])

  useEffect(() => {
    if (!authed || !following) { setMailOn(null); return }
    let cancelled = false
    fetchOrgMailPreference(slug)
      .then((on) => { if (!cancelled) setMailOn(on) })
      .catch((err: unknown) => console.error('newsletter: mail preference', err))
    return () => { cancelled = true }
  }, [authed, following, slug])

  async function toggleMail(next: boolean) {
    const previously = mailOn
    setMailOn(next)
    try {
      setMailOn(await setOrgMailPreference(slug, next))
    } catch (err) {
      console.error(err)
      setMailOn(previously)
      toast.error(t('orgs.mailError'))
    }
  }

  async function toggleFollow() {
    setFollowBusy(true)
    const previously = following
    setFollowing(!previously)
    try {
      if (previously) await unfollowOrganization(slug)
      else await followOrganization(slug)
      await refreshFollows()
      setFollowing(isFollowing(slug))
      try {
        const updated = await fetchOrganizationBySlug(slug)
        setOrg(updated)
      } catch { /* keep stale count on error */ }
    } catch (err) {
      console.error(err)
      setFollowing(previously)
      toast.error(t('orgs.followError'))
    } finally {
      setFollowBusy(false)
    }
  }

  if (status === 'loading') return <PortalSkeleton />
  if (status === 'notFound' || (status === 'success' && !org)) {
    return (
      <div className="container-content py-section-mobile lg:py-section">
        <ErrorState
          title={t('orgs.error.title')}
          message={t('orgs.error.message')}
          backTo={newsletterPath('/organizations')}
          backLabel={t('orgs.backToList')}
        />
      </div>
    )
  }
  if (status === 'error' || !org) {
    return (
      <div className="container-content py-section-mobile lg:py-section">
        <ErrorState
          message={t('orgs.portalLoadError')}
          onRetry={() => setReloadKey((k) => k + 1)}
          backTo={newsletterPath('/organizations')}
          backLabel={t('orgs.backToList')}
        />
      </div>
    )
  }

  const heroBg = GEO_BG[org.color ?? ''] ?? GEO_BG.blue
  const featured  = articles.find((a) => a.featured)
  const secondary = articles.filter((a) => !a.featured)
  const followers = org.followerCount ?? 0

  return (
    <div>
      {/* Hero band */}
      <div className={['relative h-52 lg:h-64 overflow-hidden', heroBg].join(' ')}>
        {org.backgroundUrl ? (
          <img src={org.backgroundUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 opacity-20">
            <div className="absolute top-[-20%] right-[-10%] w-2/3 h-full rounded-full bg-white/30" />
            <div className="absolute bottom-[-30%] left-[-5%] w-1/2 h-full rotate-12 bg-white/20" />
            <div className="absolute top-1/4 left-1/3 w-1/4 h-1/4 rounded-xs rotate-45 bg-black/10" />
          </div>
        )}
        <div className={`absolute inset-0 bg-linear-to-b ${org.backgroundUrl ? 'from-black/20 to-black/70' : 'from-black/10 to-black/40'}`} />

        <div className="absolute bottom-0 left-0 right-0 container-content pb-6">
          <p className="font-mono text-label text-white/70 uppercase tracking-widest mb-1">
            {t('nav.organizations')}
          </p>
          <div className="flex items-end gap-4">
            {org.logoUrl && (
              <img src={org.logoUrl} alt="" className="w-14 h-14 sm:w-16 sm:h-16 rounded-xs object-cover bg-white shrink-0 border border-white/40" />
            )}
            <h1 className="font-display text-h2 sm:text-h1 lg:text-display sm:font-extrabold sm:leading-[1.1] lg:leading-[1.05] font-bold text-white leading-tight wrap-anywhere hyphens-auto min-w-0">
              {org.name}
            </h1>
          </div>
          <p className="font-body text-body text-white/80 mt-1 max-w-xl">
            {org.fullName}
          </p>
          {authed && (
            <div className="mt-4">
              <Button variant="outline" onClick={toggleFollow} disabled={followBusy} aria-pressed={following}>
                {following ? t('orgs.unfollow') : t('orgs.follow')}
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="py-section-mobile lg:py-section">
        <div className="container-content flex flex-col gap-16">
          {/* About strip */}
          <div className="flex flex-col sm:flex-row gap-6 sm:gap-12 items-start">
            <div className="flex flex-col gap-4 sm:max-w-xl flex-1">
              <p className="font-body text-body text-ink-secondary leading-relaxed">
                {org.description}
              </p>
              <OrgLinks org={org} />
              {mailOn !== null && (
                <Switch
                  checked={mailOn}
                  onChange={toggleMail}
                  label={t('orgs.receiveMail', { org: org.name })}
                  hint={t('orgs.receiveMailHint')}
                />
              )}
            </div>
            <div className="flex sm:flex-col gap-6 sm:gap-3 shrink-0 sm:text-right">
              <Stat label={t('orgs.followersLabel', { count: followers })} value={followers.toLocaleString(localeFor(i18n.language))} />
            </div>
          </div>

          {org.recruitingOpen && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 rounded-card border border-accent-200 dark:border-accent-800 bg-accent-50 dark:bg-accent-900/30 p-5">
              <div className="flex-1 min-w-0">
                <p className="font-mono text-label uppercase tracking-widest text-accent-700 dark:text-accent-200">{t('orgs.recruiting.eyebrow')}</p>
                <p className="font-body text-body text-ink-primary dark:text-night-text mt-1">
                  {org.recruitingText || t('orgs.recruiting.default', { org: org.name })}
                </p>
              </div>
              {org.recruitingUrl && (
                <a href={org.recruitingUrl} target="_blank" rel="noopener noreferrer" className={buttonClass({ variant: 'accent' })}>
                  {t('orgs.recruiting.cta')}
                </a>
              )}
            </div>
          )}

          {org.board && org.board.length > 0 && (
            <section aria-labelledby="org-board-heading">
              <SectionHeader id="org-board-heading" label={t('orgs.board')} />
              <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 list-none m-0 p-0">
                {org.board.map((m, i) => (
                  <li key={`${m.name}-${i}`} className="flex items-center gap-3">
                    {m.avatarUrl
                      ? <img src={m.avatarUrl} alt="" className="w-11 h-11 rounded-full object-cover bg-page-bg dark:bg-night-raised shrink-0" />
                      : <div className="w-11 h-11 rounded-full bg-page-bg dark:bg-night-raised shrink-0" aria-hidden="true" />}
                    <div className="min-w-0">
                      <p className="font-display text-body-sm font-bold text-ink-primary dark:text-night-text truncate">{m.name}</p>
                      {m.title && <p className="font-mono text-label text-ink-secondary dark:text-night-muted truncate">{m.title}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Articles section */}
          <section aria-labelledby="org-articles-heading">
            <SectionHeader id="org-articles-heading" label={t('orgs.latestArticles')} />
            {articles.length === 0 ? (
              <EmptyState compact title={t('orgs.noArticles')} />
            ) : (
              <div className="flex flex-col gap-6">
                {featured && <ArticleCard article={featured} featured />}
                {secondary.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    {secondary.map((a) => <ArticleCard key={a.id} article={a} />)}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Events section */}
          <section aria-labelledby="org-events-heading">
            <SectionHeader
              id="org-events-heading"
              label={t('orgs.upcomingEvents')}
              linkTo={`${newsletterPath('/events')}?organization=${encodeURIComponent(org.slug)}`}
              linkLabel={t('orgs.viewAll')}
            />
            {events.length === 0 ? (
              <EmptyState compact title={t('orgs.noEvents')} />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {events.map((e) => <EventCard key={e.id} event={e} to={eventPath(e.id)} />)}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

interface StatProps {
  label: string
  value: string
}

function Stat({ label, value }: StatProps) {
  return (
    <div>
      <p className="font-display text-h3 font-bold text-ink-primary tabular-nums">{value}</p>
      <p className="font-mono text-label text-ink-secondary uppercase tracking-widest">{label}</p>
    </div>
  )
}

interface SectionHeaderProps {
  id: string
  label: string
  linkTo?: string
  linkLabel?: string
}

function SectionHeader({ id, label, linkTo, linkLabel }: SectionHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-4 mb-6 border-b border-border dark:border-night-border pb-3">
      <h2 id={id} className="font-display text-h3 font-bold text-ink-primary">
        {label}
      </h2>
      {linkTo && (
        <Link
          to={linkTo}
          className="inline-flex items-center min-h-[44px] font-mono text-label text-ink-secondary hover:text-primary transition-colors duration-150 underline underline-offset-2"
        >
          {linkLabel}
        </Link>
      )}
    </div>
  )
}

function PortalSkeleton() {
  return (
    <LoadingRegion>
      <div className="skeleton h-52 lg:h-64" aria-hidden="true" />
      <div className="py-section-mobile lg:py-section">
        <div className="container-content flex flex-col gap-8">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-5 w-3/4" />
        </div>
      </div>
    </LoadingRegion>
  )
}

// The org's public contact links, if it filled any.
function OrgLinks({ org }: { org: Organization }) {
  const { t } = useTranslation()
  const links = [
    org.instagram && { label: 'Instagram', href: `https://www.instagram.com/${encodeURIComponent(org.instagram)}/` },
    org.linkedinUrl && { label: 'LinkedIn', href: org.linkedinUrl },
    org.websiteUrl && { label: t('orgs.links.website'), href: org.websiteUrl },
    org.contactEmail && { label: org.contactEmail, href: `mailto:${org.contactEmail}` },
  ].filter((l): l is { label: string; href: string } => Boolean(l))
  if (links.length === 0) return null
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1 list-none m-0 p-0" aria-label={t('orgs.links.label')}>
      {links.map((l) => (
        <li key={l.href}>
          <a
            href={l.href}
            {...(l.href.startsWith('mailto:') ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
            className="inline-flex items-center min-h-[44px] font-mono text-label uppercase tracking-widest text-primary dark:text-primary-300 hover:underline underline-offset-4 wrap-anywhere"
          >
            {l.label}
          </a>
        </li>
      ))}
    </ul>
  )
}
