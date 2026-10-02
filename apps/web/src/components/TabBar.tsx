import { useTranslation } from 'react-i18next'

export type TabId = 'home' | 'departments' | 'benefits' | 'staff'

interface TabBarProps {
  active: TabId
  onChange: (tab: TabId) => void
}

const TABS: TabId[] = ['home', 'departments', 'benefits', 'staff']

export default function TabBar({ active, onChange }: TabBarProps) {
  const { t } = useTranslation()

  return (
    <div className="border-b border-border dark:border-night-border bg-surface dark:bg-night-bg sticky top-16 z-30">
      <div className="container-content">
        <nav className="flex gap-0 overflow-x-auto scrollbar-none" aria-label={t('tabs.aria')} role="tablist">
          {TABS.map((tab) => (
            <button
              key={tab}
              role="tab"
              aria-selected={active === tab}
              onClick={() => onChange(tab)}
              className={`
                relative flex-shrink-0 px-4 py-3.5 font-mono text-label uppercase tracking-widest transition-colors duration-150
                ${active === tab
                  ? 'text-primary font-bold'
                  : 'text-ink-secondary dark:text-night-muted hover:text-ink-primary dark:hover:text-night-text'
                }
              `}
            >
              {t(`tabs.${tab}`)}
              {active === tab && (
                <span
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary dark:bg-primary-300 rounded-full"
                  aria-hidden="true"
                />
              )}
            </button>
          ))}
        </nav>
      </div>
    </div>
  )
}
