import HeroSection from './sections/HeroSection'
import AppsSection from './sections/AppsSection'
import HomeDepartmentsPreview from './sections/HomeDepartmentsPreview'
import HomeBenefitsPreview from './sections/HomeBenefitsPreview'
import HomeJoinCTA from './sections/HomeJoinCTA'

// The landing page: one scroll, no tabs. Benefits and the departments/staff
// have their own pages (/benefits, /about), linked from the navbar and from
// each preview's "Ver todo".
export default function HomePage() {
  return (
    <main id="main-content" tabIndex={-1} className="outline-none">
      <HeroSection />
      <AppsSection />
      <HomeDepartmentsPreview />
      <HomeBenefitsPreview />
      <HomeJoinCTA />
    </main>
  )
}
