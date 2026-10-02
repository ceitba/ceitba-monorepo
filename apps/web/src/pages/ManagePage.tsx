import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ManageStaffSection from './manage/ManageStaffSection'
import ManageBenefitsSection from './manage/ManageBenefitsSection'
import ManageUsersSection from './manage/ManageUsersSection'
import ManageCorrectionsSection from './manage/ManageCorrectionsSection'

type Tab = 'staff' | 'benefits' | 'users' | 'corrections'

export default function ManagePage() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('staff')

  const tabs: { id: Tab; label: string }[] = [
    { id: 'staff',    label: t('manage.tabs.staff') },
    { id: 'benefits', label: t('manage.tabs.benefits') },
    { id: 'users',    label: t('manage.tabs.users') },
    { id: 'corrections', label: t('manage.tabs.corrections') },
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
            onClick={() => setTab(it.id)}
            aria-current={tab === it.id ? 'page' : undefined}
            className={`flex-shrink-0 whitespace-nowrap px-4 py-2 font-mono text-label uppercase tracking-widest transition-colors duration-150 -mb-px border-b-2 ${
              tab === it.id
                ? 'border-primary text-primary'
                : 'border-transparent text-ink-secondary dark:text-night-muted hover:text-primary'
            }`}
          >
            {it.label}
          </button>
        ))}
      </nav>

      {tab === 'staff'    && <ManageStaffSection />}
      {tab === 'benefits' && <ManageBenefitsSection />}
      {tab === 'users'    && <ManageUsersSection />}
      {tab === 'corrections' && <ManageCorrectionsSection />}
    </main>
  )
}
