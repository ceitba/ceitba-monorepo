import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { isStaff } from '@/store/authStore'
import { getOrganizations } from '@/newsletter/utils/session'
import { useAuth } from '@/hooks/useAuth'
import { newsletterPath, stripNewsletterBase } from '@/newsletter/paths'
import { useOrgDirectory } from '../hooks/useOrgDirectory'
import AreaShell, { type AreaTab } from './AreaShell'

// "Mis publicaciones": where every signed-in user writes. Their articles
// (drafts are private until sent to review) and their organizations'
// articles, events and profiles.
export default function WriterLayout() {
  const { t } = useTranslation()
  const { profile } = useAuth()
  const { pathname } = useLocation()
  const { orgs, orgName } = useOrgDirectory()
  const context = useMemo(() => ({ orgs, orgName }), [orgs, orgName])

  const staff = isStaff(profile)
  const memberSlugs = getOrganizations(profile).map((m) => m.slug)
  // Staff reach any org's profile by URL (from /manage → Organizaciones);
  // that org gets a tab while they're on it.
  const currentOrg = /^\/mine\/org\/([^/]+)/.exec(stripNewsletterBase(pathname))?.[1]
  const orgSlugs = currentOrg && !memberSlugs.includes(currentOrg) ? [...memberSlugs, currentOrg] : memberSlugs

  const tabs: AreaTab[] = [
    { to: newsletterPath('/mine/articles'), label: t('mine.nav.articles') },
    // Events always belong to an organization; staff manage every org's.
    ...(staff || memberSlugs.length > 0 ? [{ to: newsletterPath('/mine/events'), label: t('mine.nav.events') }] : []),
    ...orgSlugs.map((slug) => ({ to: newsletterPath(`/mine/org/${slug}`), label: orgName(slug) })),
  ]

  return (
    <AreaShell
      title={t('mine.layout.title')}
      subtitle={memberSlugs.length > 0 ? t('mine.layout.subtitleMember') : t('mine.layout.subtitle')}
      tabsLabel={t('mine.layout.tabsAria')}
      tabs={tabs}
      context={context}
    />
  )
}
