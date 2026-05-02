import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { fetchOrganizations } from '../api/organizations'

const GEO_BG = {
  blue:   'bg-primary-500',
  amber:  'bg-accent-400',
  green:  'bg-emerald-600',
  violet: 'bg-violet-600',
}

export default function OrganizationsPage() {
  const { t } = useTranslation()
  const [orgs, setOrgs] = useState([])
  const [status, setStatus] = useState('loading')

  useEffect(() => {
    fetchOrganizations()
      .then(({ data }) => { setOrgs(data); setStatus('success') })
      .catch(() => setStatus('error'))
  }, [])

  return (
    <div className="py-section-mobile lg:py-section">
      <div className="container-content">
        <header className="mb-10 lg:mb-14">
          <h1 className="font-display text-h1 lg:text-display font-bold text-ink-primary leading-tight">
            {t('orgs.pageTitle')}
          </h1>
          <p className="font-body text-body-lg text-ink-secondary mt-2">
            {t('orgs.pageSubtitle')}
          </p>
        </header>

        {status === 'loading' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-6" aria-busy="true">
            {[1,2,3,4].map((i) => (
              <div key={i} className="rounded-card border border-border overflow-hidden">
                <div className="skeleton h-32" />
                <div className="p-6 flex flex-col gap-3">
                  <div className="skeleton h-6 w-1/3 rounded" />
                  <div className="skeleton h-4 w-full rounded" />
                  <div className="skeleton h-4 w-4/5 rounded" />
                </div>
              </div>
            ))}
          </div>
        )}

        {status === 'success' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 lg:gap-8">
            {orgs.map((org) => (
              <OrgCard key={org.slug} org={org} t={t} />
            ))}
          </div>
        )}

        {status === 'error' && (
          <p role="alert" className="font-body text-body text-ink-secondary">
            {t('articles.error.message')}
          </p>
        )}
      </div>
    </div>
  )
}

function OrgCard({ org, t }) {
  const heroBg = GEO_BG[org.color] ?? GEO_BG.blue

  return (
    <Link
      to={`/organizations/${org.slug}`}
      className="group rounded-card border border-border bg-white overflow-hidden shadow-card hover:shadow-card-hover transition-shadow duration-200 flex flex-col animate-fade-in focus-visible:rounded-card"
    >
      {/* Geometric hero */}
      <div className={['relative h-32 overflow-hidden', heroBg].join(' ')}>
        <div className="absolute inset-0 opacity-20">
          <div className="absolute top-[-30%] right-0 w-1/2 h-full rounded-full bg-white/30" />
          <div className="absolute bottom-[-20%] left-[-5%] w-1/3 h-full rotate-12 bg-white/20" />
        </div>
        <div className="absolute inset-0 bg-gradient-to-br from-black/0 to-black/20" />
        {/* Org name on the hero */}
        <div className="absolute bottom-4 left-5">
          <span className="font-display text-h4 font-bold text-white leading-none drop-shadow-sm">
            {org.name}
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="p-5 flex flex-col gap-3 flex-1">
        <p className="font-body text-body-sm text-ink-secondary leading-relaxed line-clamp-3">
          {org.description}
        </p>
        <div className="flex items-center gap-4 mt-auto pt-3 border-t border-border">
          <span className="font-mono text-label text-ink-secondary">
            {t('orgs.members', { count: org.memberCount.toLocaleString() })}
          </span>
          <span className="text-border" aria-hidden="true">·</span>
          <span className="font-mono text-label text-ink-secondary">
            {t('orgs.founded', { year: org.foundedYear })}
          </span>
        </div>
      </div>
    </Link>
  )
}
