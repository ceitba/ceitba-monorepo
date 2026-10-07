import { useTranslation } from 'react-i18next'
import { Tabs } from './ui'

export type TabId = 'home' | 'departments' | 'benefits' | 'staff'

// Prefix for the tab and panel ids: the home page renders each panel with
// id={`${HOME_TABS_ID}-panel-${tab}`} and aria-labelledby the tab.
export const HOME_TABS_ID = 'home-tabs'

const TABS: TabId[] = ['home', 'departments', 'benefits', 'staff']

// The home page's sticky tab strip (sits right under the 4rem navbar).
export default function TabBar({ active, onChange }: { active: TabId; onChange: (tab: TabId) => void }) {
  const { t } = useTranslation()

  return (
    <div className="border-b border-border dark:border-night-border bg-surface dark:bg-night-bg sticky top-16 z-30">
      <div className="container-content">
        <Tabs
          items={TABS.map((id) => ({ id, label: t(`tabs.${id}`) }))}
          active={active}
          onChange={onChange}
          label={t('tabs.aria')}
          idPrefix={HOME_TABS_ID}
          className="!border-b-0"
        />
      </div>
    </div>
  )
}
