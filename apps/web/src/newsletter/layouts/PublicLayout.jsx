import { NavLink, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import SectionHeader from '@/components/SectionHeader'
import { sectionLinkClass } from '@/components/sectionLinkClass'
import { newsletterPath } from '@/newsletter/paths'

// Public newsletter pages, under the app Navbar and above its Footer.
export default function PublicLayout() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col bg-surface">
      <SectionHeader title={t('nav.home')} subtitle={t('nav.tagline')} to={newsletterPath('/')}>
        <nav aria-label={t('nav.home')} className="flex items-center gap-6">
          <NavLink to={newsletterPath('/')} end className={sectionLinkClass}>{t('nav.articles')}</NavLink>
          <NavLink to={newsletterPath('/events')} className={sectionLinkClass}>{t('nav.events')}</NavLink>
          <NavLink to={newsletterPath('/organizations')} className={sectionLinkClass}>{t('nav.organizations')}</NavLink>
        </nav>
      </SectionHeader>
      <main id="main-content" className="flex-1">
        <Outlet />
      </main>
    </div>
  )
}
