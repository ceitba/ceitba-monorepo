import DepartmentsSection from './sections/DepartmentsSection'
import StaffSection from './sections/StaffSection'

// Who the CEITBA is: its departments and the people in them.
export default function AboutPage() {
  return (
    <main id="main-content" tabIndex={-1} className="outline-none">
      <DepartmentsSection />
      <StaffSection />
    </main>
  )
}
