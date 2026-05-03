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
    <div className="border-b border-border dark:border-[#3f3f46] bg-surface dark:bg-[#18181b] sticky top-16 z-30">
      <div className="container-content">
        <nav className="flex gap-0 overflow-x-auto scrollbar-none" aria-label="Page sections" role="tablist">
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
                  : 'text-ink-secondary dark:text-[#a1a1aa] hover:text-ink-primary dark:hover:text-[#f4f4f5]'
                }
              `}
            >
              {t(`tabs.${tab}`)}
              {active === tab && (
                <span
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary dark:bg-[#7FA1D4] rounded-full"
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
