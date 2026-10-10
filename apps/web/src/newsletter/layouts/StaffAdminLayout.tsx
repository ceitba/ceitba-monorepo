import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ANALYTICS_PATH, DIGESTS_PATH, REVIEW_PATH } from '@/newsletter/paths'
import { useQueueOptional } from '@/pages/manage/review/queueContext'
import { useOrgDirectory } from '../hooks/useOrgDirectory'
import AreaShell, { type AreaTab } from './AreaShell'

// The Newsletter area of the site's Administración (/manage/newsletter): the
// review queue of articles sent by independent authors, the weekly digest
// and the analytics. Rendered inside /manage's rail layout, so it brings no
// <main> or page container of its own. The Revisión count comes from the
// same review queue as the rail's badge, so the two always agree.
export default function StaffAdminLayout() {
  const { t } = useTranslation()
  const { orgs, orgName } = useOrgDirectory()
  const queue = useQueueOptional()
  // Like the rail, no badge when nothing waits.
  const pending = queue && queue.status.articles === 'ok' && queue.counts.articles > 0 ? queue.counts.articles : null
  const refreshPending = useCallback(() => { queue?.reloadSource('articles') }, [queue])

  const context = useMemo(() => ({ orgs, orgName, refreshPending }), [orgs, orgName, refreshPending])

  const tabs: AreaTab[] = [
    { to: REVIEW_PATH, label: t('admin.nav.review'), count: pending },
    { to: DIGESTS_PATH, label: t('admin.nav.digests') },
    { to: ANALYTICS_PATH, label: t('admin.nav.analytics') },
  ]

  return (
    <AreaShell
      title={t('admin.layout.title')}
      subtitle={t('admin.layout.subtitle')}
      tabsLabel={t('admin.layout.tabsAria')}
      tabs={tabs}
      context={context}
      embedded
    />
  )
}
