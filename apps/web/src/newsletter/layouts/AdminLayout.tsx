import { useCallback, useEffect, useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { fetchOrganizations } from '../api/organizations'
import { getOrganizations, isStaff as isStaffProfile } from '../store/authStore'
import { useAuthSession } from '../hooks/useAuthSession'
import { newsletterPath, stripNewsletterBase } from '@/newsletter/paths'
import type { AdminOutletContext } from '../admin/adminContext'
import type { Organization } from '../types'

interface TabLink {
  to: string
  label: string
}

// The newsletter admin, in the same language as /manage: the site's Navbar
// and Footer around it, a page title and one tab strip. Tabs are routes, so
// they are links (aria-current="page") styled exactly like the kit Tabs.
export default function AdminLayout() {
  const { t } = useTranslation()
  const { profile } = useAuthSession()
  const { pathname } = useLocation()
  const [orgs, setOrgs] = useState<Organization[]>([])

  useEffect(() => {
    let active = true
    fetchOrganizations()
      .then(({ data }) => { if (active) setOrgs(data ?? []) })
      // Names are a nicety on top of slugs; pages still work without them.
      .catch((err: unknown) => console.error('newsletter admin: organizations', err))
    return () => { active = false }
  }, [])

  const orgName = useCallback(
    (slug: string | null | undefined) => (slug ? orgs.find((o) => o.slug === slug)?.name ?? slug : ''),
    [orgs],
  )
  const context = useMemo<AdminOutletContext>(() => ({ orgs, orgName }), [orgs, orgName])

  const staff = isStaffProfile(profile)
  const memberSlugs = getOrganizations(profile).map((m) => m.slug)
  // Staff reach any org's profile by URL (from /manage → Organizaciones);
  // that org gets a tab while they're on it.
  const currentOrg = /^\/admin\/org\/([^/]+)/.exec(stripNewsletterBase(pathname))?.[1]
  const orgSlugs = currentOrg && !memberSlugs.includes(currentOrg) ? [...memberSlugs, currentOrg] : memberSlugs

  const tabs: TabLink[] = [
    { to: newsletterPath('/admin/articles'), label: t('admin.nav.articles') },
    // Events always belong to an organization.
    ...(staff || memberSlugs.length > 0 ? [{ to: newsletterPath('/admin/events'), label: t('admin.nav.events') }] : []),
    ...orgSlugs.map((slug) => ({ to: newsletterPath(`/admin/org/${slug}`), label: orgName(slug) })),
    // Analytics and the weekly digest are STAFF-only on the API.
    ...(staff
      ? [
          { to: newsletterPath('/admin/analytics'), label: t('admin.nav.analytics') },
          { to: newsletterPath('/admin/digests'), label: t('admin.nav.digests') },
        ]
      : []),
  ]

  return (
    <main id="main-content" className="container-content py-section-mobile lg:py-section">
      <header className="mb-6">
        <h1 className="font-display font-bold text-h2 text-ink-primary dark:text-night-text">
          {t('admin.layout.title')}
        </h1>
        <p className="font-body text-body text-ink-secondary dark:text-night-muted mt-1">
          {staff ? t('admin.layout.subtitleStaff') : t('admin.layout.subtitle')}
        </p>
      </header>

      <nav
        aria-label={t('admin.layout.tabsAria')}
        className="flex overflow-x-auto scrollbar-none border-b border-border dark:border-night-border mb-8"
      >
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) => [
              'relative flex-shrink-0 inline-flex items-center gap-2 min-h-[44px] px-4 font-mono text-label uppercase tracking-widest whitespace-nowrap transition-colors duration-150',
              isActive
                ? 'text-primary dark:text-primary-300 font-bold'
                : 'text-ink-secondary dark:text-night-muted hover:text-ink-primary dark:hover:text-night-text',
            ].join(' ')}
          >
            {({ isActive }) => (
              <>
                {tab.label}
                {isActive && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary dark:bg-primary-300 rounded-full" aria-hidden="true" />
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <Outlet context={context} />
    </main>
  )
}
