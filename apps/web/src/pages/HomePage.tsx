import { useState } from 'react'
import TabBar, { HOME_TABS_ID, TabId } from '../components/TabBar'
import HeroSection from './sections/HeroSection'
import AppsSection from './sections/AppsSection'
import DepartmentsSection from './sections/DepartmentsSection'
import BenefitsSection from './sections/BenefitsSection'
import StaffSection from './sections/StaffSection'
import HomeDepartmentsPreview from './sections/HomeDepartmentsPreview'
import HomeBenefitsPreview from './sections/HomeBenefitsPreview'
import HomeJoinCTA from './sections/HomeJoinCTA'

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<TabId>('home')

  return (
    <>
      <TabBar active={activeTab} onChange={setActiveTab} />
      <main id="main-content" tabIndex={-1} className="outline-none">
        <div
          role="tabpanel"
          id={`${HOME_TABS_ID}-panel-${activeTab}`}
          aria-labelledby={`${HOME_TABS_ID}-tab-${activeTab}`}
        >
          {activeTab === 'home' && (
            <>
              <HeroSection />
              <AppsSection />
              <HomeDepartmentsPreview onSeeAll={() => setActiveTab('departments')} />
              <HomeBenefitsPreview onSeeAll={() => setActiveTab('benefits')} />
              <HomeJoinCTA />
            </>
          )}
          {activeTab === 'departments' && <DepartmentsSection />}
          {activeTab === 'benefits' && <BenefitsSection />}
          {activeTab === 'staff' && <StaffSection />}
        </div>
      </main>
    </>
  )
}
