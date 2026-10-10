import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { canViewFollowers } from '@/newsletter/utils/session'
import { useAuth } from '@/hooks/useAuth'
import { orgAreaPath } from '@/newsletter/paths'

export type OrgPage = 'profile' | 'stats' | 'members' | 'followers' | 'mail'

// Sibling pages of one organization (Perfil · Estadísticas · Miembros ·
// Seguidores · Correo), as
// plain links under the section header: the "mine" area already has its tab
// strip, and a page carries at most one (EDITORIAL_UI_SYSTEM §6). Members,
// followers and mail expose emails or send to them, so they are listed only
// for the org's admins and staff.
export default function OrgSectionLinks({ slug, current }: { slug: string; current: OrgPage }) {
  const { t } = useTranslation()
  const { profile } = useAuth()
  const manage = canViewFollowers(slug, profile)
  const pages: { id: OrgPage; to: string }[] = [
    { id: 'profile', to: orgAreaPath(slug) },
    { id: 'stats', to: orgAreaPath(slug, 'stats') },
    ...(manage ? [
      { id: 'members' as const, to: orgAreaPath(slug, 'members') },
      { id: 'followers' as const, to: orgAreaPath(slug, 'followers') },
      { id: 'mail' as const, to: orgAreaPath(slug, 'mail') },
    ] : []),
  ]
  if (pages.length < 2) return null
  return (
    <nav aria-label={t('admin.orgPages.label')}>
      <ul className="flex flex-wrap items-center gap-x-5 list-none m-0 p-0">
        {pages.map((p) => (
          <li key={p.id}>
            {p.id === current ? (
              <span aria-current="page" className="inline-flex items-center min-h-[44px] font-mono text-label uppercase tracking-widest font-bold text-ink-primary dark:text-night-text">
                {t(`admin.orgPages.${p.id}`)}
              </span>
            ) : (
              <Link
                to={p.to}
                className="inline-flex items-center gap-1 min-h-[44px] font-mono text-label uppercase tracking-widest text-primary dark:text-primary-300 hover:underline underline-offset-4"
              >
                {t(`admin.orgPages.${p.id}`)}
                <span aria-hidden="true">→</span>
              </Link>
            )}
          </li>
        ))}
      </ul>
    </nav>
  )
}
