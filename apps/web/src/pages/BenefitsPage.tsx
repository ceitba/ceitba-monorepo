import BenefitsSection from './sections/BenefitsSection'

// Every student benefit, by category (linked from the navbar and the home
// preview).
export default function BenefitsPage() {
  return (
    <main id="main-content" tabIndex={-1} className="outline-hidden">
      <BenefitsSection />
    </main>
  )
}
