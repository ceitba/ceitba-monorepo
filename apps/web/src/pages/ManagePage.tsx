import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ManageStaffSection from './manage/ManageStaffSection'
import ManageBenefitsSection from './manage/ManageBenefitsSection'
import ManageUsersSection from './manage/ManageUsersSection'

type Tab = 'staff' | 'benefits' | 'users'

export default function ManagePage() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('staff')

  const tabs: { id: Tab; label: string }[] = [
    { id: 'staff',    label: t('manage.tabs.staff') },
    { id: 'benefits', label: t('manage.tabs.benefits') },
    { id: 'users',    label: t('manage.tabs.users') },
  ]

  return (
    <main className="container-content py-section-mobile lg:py-section">
      <header className="mb-6">
        <h1 className="font-display font-bold text-h2 text-ink-primary dark:text-[#f4f4f5]">
          {t('manage.title')}
        </h1>
        <p className="font-body text-body text-ink-secondary dark:text-[#a1a1aa] mt-1">
          {t('manage.subtitle')}
        </p>
      </header>

      <nav className="flex gap-2 border-b border-border dark:border-[#3f3f46] mb-6" aria-label="Manage sections">
        {tabs.map((it) => (
          <button
            key={it.id}
            type="button"
            onClick={() => setTab(it.id)}
            aria-current={tab === it.id ? 'page' : undefined}
            className={`px-4 py-2 font-mono text-label uppercase tracking-widest transition-colors duration-150 -mb-px border-b-2 ${
              tab === it.id
                ? 'border-primary text-primary'
                : 'border-transparent text-ink-secondary dark:text-[#a1a1aa] hover:text-primary'
            }`}
          >
            {it.label}
          </button>
        ))}
      </nav>

      {tab === 'staff'    && <ManageStaffSection />}
      {tab === 'benefits' && <ManageBenefitsSection />}
      {tab === 'users'    && <ManageUsersSection />}
    </main>
  )
}
