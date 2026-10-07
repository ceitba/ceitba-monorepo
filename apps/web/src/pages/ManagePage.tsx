import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { SkeletonTable, Tabs, type TabItem } from '../components/ui'
import ManageStaffSection from './manage/ManageStaffSection'
import ManageBenefitsSection from './manage/ManageBenefitsSection'
import ManageUsersSection from './manage/ManageUsersSection'
import ManageCorrectionsSection from './manage/ManageCorrectionsSection'
import ManageOrganizationsSection from './manage/ManageOrganizationsSection'
import ManageCapabilitiesSection from './manage/ManageCapabilitiesSection'
// Apuntes moderation pulls in the Drive/wiki APIs and badges: load on demand.
const ManageDriveSection = lazy(() => import('./manage/ManageDriveSection'))
const ManageWikiAiSection = lazy(() => import('./manage/ManageWikiAiSection'))
// Watches evals/runs seen RUNNING and toasts when they finish, from any tab.
const JobWatcher = lazy(() => import('./manage/wikiAdmin/JobWatcher'))
import { activeJobs, unseenCount } from './manage/wikiAdmin/jobWatchStore'
import { useJobWatch } from './manage/wikiAdmin/useJobWatch'
import type { OrganizationSummary } from '../api/admin'

const TABS = ['staff', 'benefits', 'users', 'organizations', 'corrections', 'capabilities', 'drive', 'wikiAi'] as const
type Tab = (typeof TABS)[number]
const DEFAULT_TAB: Tab = 'staff'

function isTab(v: string | null): v is Tab {
  return v != null && (TABS as readonly string[]).includes(v)
}

// The active tab lives in the URL (/manage?tab=drive) so a reload, a shared
// link or the back button land on the same section; plain /manage (and any
// unknown value) opens Staff.
export default function ManagePage() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const raw = params.get('tab')
  const tab: Tab = isTab(raw) ? raw : DEFAULT_TAB
  // Org to open the Users tab in "adding members" mode for (set by
  // "Agregar miembros" in Organizations). Picking a tab from the nav
  // clears it.
  const [addingTo, setAddingTo] = useState<OrganizationSummary | undefined>(undefined)
  const watch = useJobWatch()
  const wikiUnseen = unseenCount()
  const watching = activeJobs().length > 0 || watch.toasts.length > 0

  function goTo(next: Tab) {
    setParams((prev) => {
      const out = new URLSearchParams(prev)
      if (next === DEFAULT_TAB) out.delete('tab')
      else out.set('tab', next)
      return out
    })
  }

  function selectTab(next: Tab) {
    setAddingTo(undefined)
    goTo(next)
  }

  function addMembers(org: OrganizationSummary) {
    setAddingTo(org)
    goTo('users')
  }

  const tabs: TabItem<Tab>[] = [
    { id: 'staff',    label: t('manage.tabs.staff') },
    { id: 'benefits', label: t('manage.tabs.benefits') },
    { id: 'users',    label: t('manage.tabs.users') },
    { id: 'organizations', label: t('manage.tabs.organizations') },
    { id: 'corrections', label: t('manage.tabs.corrections') },
    { id: 'capabilities', label: t('manage.tabs.capabilities') },
    { id: 'drive', label: t('manage.tabs.drive') },
    {
      id: 'wikiAi',
      label: t('manage.tabs.wikiAi'),
      dot: wikiUnseen > 0,
      dotLabel: t('manage.tabs.wikiAiUnseen', { count: wikiUnseen }),
    },
  ]

  const lazyFallback = <SkeletonTable rows={6} cols={4} />

  return (
    <main id="main-content" tabIndex={-1} className="outline-none container-content py-section-mobile lg:py-section">
      <header className="mb-6">
        <h1 className="font-display font-bold text-h2 text-ink-primary dark:text-night-text">
          {t('manage.title')}
        </h1>
        <p className="font-body text-body text-ink-secondary dark:text-night-muted mt-1">
          {t('manage.subtitle')}
        </p>
      </header>

      <Tabs items={tabs} active={tab} onChange={selectTab} label={t('manage.tabsAria')} idPrefix="manage" className="mb-6" />

      <div role="tabpanel" id={`manage-panel-${tab}`} aria-labelledby={`manage-tab-${tab}`}>
        {tab === 'staff'    && <ManageStaffSection />}
        {tab === 'benefits' && <ManageBenefitsSection />}
        {tab === 'users'    && <ManageUsersSection initialAddingTo={addingTo} />}
        {tab === 'organizations' && <ManageOrganizationsSection onAddMembers={addMembers} />}
        {tab === 'corrections' && <ManageCorrectionsSection />}
        {tab === 'capabilities' && <ManageCapabilitiesSection />}
        {tab === 'drive' && (
          <Suspense fallback={lazyFallback}>
            <ManageDriveSection />
          </Suspense>
        )}
        {tab === 'wikiAi' && (
          <Suspense fallback={lazyFallback}>
            <ManageWikiAiSection />
          </Suspense>
        )}
      </div>
      {watching && (
        <Suspense fallback={null}>
          <JobWatcher onOpen={() => selectTab('wikiAi')} />
        </Suspense>
      )}
    </main>
  )
}
