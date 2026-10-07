import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { fetchArticles } from '../api/articles'
import { newsletterPath, REVIEW_PATH } from '@/newsletter/paths'
import { useOrgDirectory } from '../hooks/useOrgDirectory'
import AreaShell, { type AreaTab } from './AreaShell'

const PENDING_STATUS = 'pending_review'

// The staff newsletter admin: the review queue of articles sent by
// independent authors, the weekly digest and the analytics.
export default function StaffAdminLayout() {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const { orgs, orgName } = useOrgDirectory()
  const [pending, setPending] = useState<number | null>(null)

  const refreshPending = useCallback(() => {
    fetchArticles({ status: PENDING_STATUS, limit: 1 })
      .then(({ meta }) => setPending(meta?.total ?? null))
      // The count is a hint on the tab; the queue itself reports failures.
      .catch((err: unknown) => { console.error('newsletter admin: pending count', err); setPending(null) })
  }, [])

  // Re-count on every page change, so publishing from the editor shows up
  // as soon as staff go back to the queue.
  useEffect(refreshPending, [refreshPending, pathname])

  const context = useMemo(() => ({ orgs, orgName, refreshPending }), [orgs, orgName, refreshPending])

  const tabs: AreaTab[] = [
    { to: REVIEW_PATH, label: t('admin.nav.review'), count: pending },
    { to: newsletterPath('/admin/digests'), label: t('admin.nav.digests') },
    { to: newsletterPath('/admin/analytics'), label: t('admin.nav.analytics') },
  ]

  return (
    <AreaShell
      title={t('admin.layout.title')}
      subtitle={t('admin.layout.subtitle')}
      tabsLabel={t('admin.layout.tabsAria')}
      tabs={tabs}
      context={context}
    />
  )
}
