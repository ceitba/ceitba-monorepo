import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ManageStaffSection from './manage/ManageStaffSection'
import ManageBenefitsSection from './manage/ManageBenefitsSection'
import ManageUsersSection from './manage/ManageUsersSection'
import ManageCorrectionsSection from './manage/ManageCorrectionsSection'
import ManageOrganizationsSection from './manage/ManageOrganizationsSection'
// Apuntes moderation pulls in the Drive/wiki APIs and badges: load on demand.
const ManageDriveSection = lazy(() => import('./manage/ManageDriveSection'))
const ManageWikiAiSection = lazy(() => import('./manage/ManageWikiAiSection'))
// Watches evals/runs seen RUNNING and toasts when they finish, from any tab.
const JobWatcher = lazy(() => import('./manage/wikiAdmin/JobWatcher'))
import { activeJobs, unseenCount } from './manage/wikiAdmin/jobWatchStore'
import { useJobWatch } from './manage/wikiAdmin/useJobWatch'
import type { OrganizationSummary } from '../api/admin'

type Tab = 'staff' | 'benefits' | 'users' | 'organizations' | 'corrections' | 'drive' | 'wikiAi'

export default function ManagePage() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('staff')
  // Org to open the Users tab in "adding members" mode for (set by
  // "Agregar miembros" after creating an org). Picking a tab from the nav
  // clears it.
  const [addingTo, setAddingTo] = useState<OrganizationSummary | undefined>(undefined)
  const watch = useJobWatch()
  const wikiUnseen = unseenCount()
  const watching = activeJobs().length > 0 || watch.toasts.length > 0

  function selectTab(next: Tab) {
    setAddingTo(undefined)
    setTab(next)
  }

  function addMembers(org: OrganizationSummary) {
    setAddingTo(org)
    setTab('users')
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'staff',    label: t('manage.tabs.staff') },
    { id: 'benefits', label: t('manage.tabs.benefits') },
    { id: 'users',    label: t('manage.tabs.users') },
    { id: 'organizations', label: t('manage.tabs.organizations') },
    { id: 'corrections', label: t('manage.tabs.corrections') },
    { id: 'drive', label: t('manage.tabs.drive') },
    { id: 'wikiAi', label: t('manage.tabs.wikiAi') },
  ]

  return (
    <main className="container-content py-section-mobile lg:py-section">
      <header className="mb-6">
        <h1 className="font-display font-bold text-h2 text-ink-primary dark:text-night-text">
          {t('manage.title')}
        </h1>
        <p className="font-body text-body text-ink-secondary dark:text-night-muted mt-1">
          {t('manage.subtitle')}
        </p>
      </header>

      <nav className="flex gap-2 overflow-x-auto border-b border-border dark:border-night-border mb-6" aria-label={t('manage.tabsAria')}>
        {tabs.map((it) => (
          <button
            key={it.id}
            type="button"
            onClick={() => selectTab(it.id)}
            aria-current={tab === it.id ? 'page' : undefined}
            className={`flex-shrink-0 whitespace-nowrap px-4 py-2 font-mono text-label uppercase tracking-widest transition-colors duration-150 -mb-px border-b-2 ${
              tab === it.id
                ? 'border-primary text-primary'
                : 'border-transparent text-ink-secondary dark:text-night-muted hover:text-primary'
            }`}
          >
            {it.label}
            {it.id === 'wikiAi' && wikiUnseen > 0 && (
              <span className="ml-1.5 inline-block w-2 h-2 rounded-full bg-accent align-middle" aria-label={t('manage.tabs.wikiAiUnseen', { count: wikiUnseen })} />
            )}
          </button>
        ))}
      </nav>

      {tab === 'staff'    && <ManageStaffSection />}
      {tab === 'benefits' && <ManageBenefitsSection />}
      {tab === 'users'    && <ManageUsersSection initialAddingTo={addingTo} />}
      {tab === 'organizations' && <ManageOrganizationsSection onAddMembers={addMembers} />}
      {tab === 'corrections' && <ManageCorrectionsSection />}
      {tab === 'drive' && (
        <Suspense fallback={<p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('manage.loading')}</p>}>
          <ManageDriveSection />
        </Suspense>
      )}
      {tab === 'wikiAi' && (
        <Suspense fallback={<p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('manage.loading')}</p>}>
          <ManageWikiAiSection />
        </Suspense>
      )}
      {watching && (
        <Suspense fallback={null}>
          <JobWatcher onOpen={() => selectTab('wikiAi')} />
        </Suspense>
      )}
    </main>
  )
}
