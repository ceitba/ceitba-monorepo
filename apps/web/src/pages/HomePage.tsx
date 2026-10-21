import HeroSection from './sections/HeroSection'
import AppsSection from './sections/AppsSection'
import DepartmentsSection from './sections/DepartmentsSection'
import HomeBenefitsPreview from './sections/HomeBenefitsPreview'
import HomeJoinCTA from './sections/HomeJoinCTA'

// The landing page: one scroll, no tabs. It's also where the CEITBA explains
// itself (hero + departments); Benefits has its own page in the navbar.
export default function HomePage() {
  return (
    <main id="main-content" tabIndex={-1} className="outline-hidden">
      <HeroSection />
      <AppsSection />
      <DepartmentsSection />
      <HomeBenefitsPreview />
      <HomeJoinCTA />
    </main>
  )
}
