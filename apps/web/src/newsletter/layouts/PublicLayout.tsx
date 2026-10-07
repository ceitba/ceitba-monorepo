import { Outlet } from 'react-router-dom'

// Public newsletter pages, under the app Navbar and above its Footer. No
// section bar: each page's header names the section and links its siblings
// (NewsletterPageHeader).
export default function PublicLayout() {
  return (
    <div className="flex flex-col bg-surface dark:bg-night-bg">
      <main id="main-content" className="flex-1">
        <Outlet />
      </main>
    </div>
  )
}
