import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import ArticleCard from '../components/ArticleCard'
import EventCard from '../components/EventCard'
import { fetchOrganizationBySlug } from '../api/organizations'
import { fetchArticles } from '../api/articles'
import { fetchEvents } from '../api/events'
import { followOrganization, unfollowOrganization } from '../api/follows'
import { getSession, isFollowing, refreshFollows } from '../store/authStore'

const GEO_BG = {
  blue:   'bg-primary-500',
  amber:  'bg-accent-400',
  green:  'bg-emerald-600',
  violet: 'bg-violet-600',
}

export default function OrgPortalPage() {
  const { slug } = useParams()
  const { t } = useTranslation()

  const [org, setOrg]         = useState(null)
  const [articles, setArticles] = useState([])
  const [events, setEvents]     = useState([])
  const [status, setStatus]     = useState('loading')
  const [authed, setAuthed]     = useState(false)
  const [following, setFollowing] = useState(false)
  const [followBusy, setFollowBusy] = useState(false)
  const [followError, setFollowError] = useState('')

  useEffect(() => {
    let cancelled = false
    setStatus('loading')

    Promise.all([
      fetchOrganizationBySlug(slug),
      fetchArticles({ organization: slug }),
      fetchEvents({ organization: slug }),
    ])
      .then(([orgData, articlesRes, eventsRes]) => {
        if (cancelled) return
        setOrg(orgData)
        setArticles(articlesRes.data)
        const today = new Date().toISOString().slice(0, 10)
        setEvents(eventsRes.data.filter((e) => e.date >= today).slice(0, 4))
        setStatus('success')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })

    return () => { cancelled = true }
  }, [slug])

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

  async function toggleFollow() {
    setFollowBusy(true)
    setFollowError('')
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
      setFollowing(previously)
      setFollowError(t('orgs.followError'))
    } finally {
      setFollowBusy(false)
    }
  }

  if (status === 'loading') return <PortalSkeleton />
  if (status === 'error' || !org) return <ErrorState t={t} />

  const heroBg = GEO_BG[org.color] ?? GEO_BG.blue
  const featured  = articles.find((a) => a.featured)
  const secondary = articles.filter((a) => !a.featured)

  return (
    <div className="animate-fade-in">
      {/* Hero band */}
      <div className={['relative h-52 lg:h-64 overflow-hidden', heroBg].join(' ')}>
        <div className="absolute inset-0 opacity-20">
          <div className="absolute top-[-20%] right-[-10%] w-2/3 h-full rounded-full bg-white/30" />
          <div className="absolute bottom-[-30%] left-[-5%] w-1/2 h-full rotate-12 bg-white/20" />
          <div className="absolute top-1/4 left-1/3 w-1/4 h-1/4 rounded-sm rotate-45 bg-black/10" />
        </div>
        <div className="absolute inset-0 bg-gradient-to-b from-black/10 to-black/40" />

        <div className="absolute bottom-0 left-0 right-0 container-content pb-6">
          <p className="font-mono text-label text-white/70 uppercase tracking-widest mb-1">
            {t('nav.organizations')}
          </p>
          <h1 className="font-display text-h1 lg:text-display font-bold text-white leading-tight">
            {org.name}
          </h1>
          <p className="font-body text-body text-white/80 mt-1 max-w-xl">
            {org.fullName}
          </p>
          {authed && (
            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                onClick={toggleFollow}
                disabled={followBusy}
                className={[
                  'inline-flex items-center gap-2 min-h-[36px] px-4 font-body text-body-sm font-semibold rounded-sm transition-colors duration-150 disabled:opacity-60',
                  following
                    ? 'bg-white/10 text-white border border-white/30 hover:bg-white/20'
                    : 'bg-white text-ink-primary hover:bg-white/90',
                ].join(' ')}
              >
                {following ? t('orgs.unfollow') : t('orgs.follow')}
              </button>
              {followError && (
                <span className="font-mono text-label text-red-200">{followError}</span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="py-section-mobile lg:py-section">
        <div className="container-content flex flex-col gap-16">
          {/* About strip */}
          <div className="flex flex-col sm:flex-row gap-6 sm:gap-12 items-start">
            <p className="font-body text-body text-ink-secondary leading-relaxed sm:max-w-xl flex-1">
              {org.description}
            </p>
            <div className="flex sm:flex-col gap-6 sm:gap-3 flex-shrink-0 sm:text-right">
              <Stat label={t('orgs.followers', { count: '' }).trim()} value={(org.followerCount ?? 0).toLocaleString()} />
            </div>
          </div>

          {/* Articles section */}
          <section aria-labelledby="org-articles-heading">
            <SectionHeader id="org-articles-heading" label={t('orgs.latestArticles')} />
            {articles.length === 0 ? (
              <EmptySection message={t('orgs.noArticles')} />
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
              linkTo="/events"
              linkLabel={t('orgs.viewAll')}
            />
            {events.length === 0 ? (
              <EmptySection message={t('orgs.noEvents')} />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {events.map((e) => <EventCard key={e.id} event={e} />)}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div>
      <p className="font-display text-h3 font-bold text-ink-primary tabular-nums">{value}</p>
      <p className="font-mono text-label text-ink-secondary uppercase tracking-widest">{label}</p>
    </div>
  )
}

function SectionHeader({ id, label, linkTo, linkLabel }) {
  return (
    <div className="flex items-baseline justify-between mb-6 border-b border-border pb-3">
      <h2 id={id} className="font-display text-h3 font-bold text-ink-primary">
        {label}
      </h2>
      {linkTo && (
        <Link
          to={linkTo}
          className="font-mono text-label text-ink-secondary hover:text-primary transition-colors duration-150 underline underline-offset-2"
        >
          {linkLabel}
        </Link>
      )}
    </div>
  )
}

function EmptySection({ message }) {
  return (
    <p className="font-body text-body text-ink-secondary py-8 text-center border border-dashed border-border rounded-card">
      {message}
    </p>
  )
}

function PortalSkeleton() {
  return (
    <div aria-busy="true">
      <div className="skeleton h-52 lg:h-64" />
      <div className="py-section-mobile lg:py-section">
        <div className="container-content flex flex-col gap-8">
          <div className="skeleton h-5 w-2/3 rounded" />
          <div className="skeleton h-5 w-1/2 rounded" />
          <div className="skeleton h-5 w-3/4 rounded" />
        </div>
      </div>
    </div>
  )
}

function ErrorState({ t }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center py-32 gap-6 text-center">
      <div>
        <p className="font-display text-h4 font-bold text-ink-primary">{t('orgs.error.title')}</p>
        <p className="font-body text-body text-ink-secondary mt-1">{t('orgs.error.message')}</p>
      </div>
      <Link
        to="/organizations"
        className="min-h-[44px] px-6 py-2.5 bg-primary text-surface font-body font-semibold rounded-sm hover:bg-primary-600 transition-colors duration-150 focus-visible:rounded inline-flex items-center"
      >
        {t('common.backHome')}
      </Link>
    </div>
  )
}
