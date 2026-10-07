import type { ReactNode } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import type { AdminOutletContext } from '../admin/adminContext'

export interface AreaTab {
  to: string
  label: string
  // Live count next to the label, like the kit Tabs (omit when unknown).
  count?: number | null
}

// The page shell of the newsletter's signed-in areas (Mis publicaciones and
// the staff admin), in the same language as /manage: the site's Navbar and
// Footer around it, a page title and one tab strip. Tabs are routes, so they
// are links (aria-current="page") styled exactly like the kit Tabs.
export default function AreaShell({
  title,
  subtitle,
  tabsLabel,
  tabs,
  context,
}: {
  title: ReactNode
  subtitle: ReactNode
  tabsLabel: string
  tabs: AreaTab[]
  context: AdminOutletContext
}) {
  return (
    <main id="main-content" className="container-content py-section-mobile lg:py-section">
      <header className="mb-6">
        <h1 className="font-display font-bold text-h2 text-ink-primary dark:text-night-text">{title}</h1>
        <p className="font-body text-body text-ink-secondary dark:text-night-muted mt-1">{subtitle}</p>
      </header>

      {/* A single tab is not navigation: hide the strip until there's a choice. */}
      {tabs.length > 1 && (
      <nav
        aria-label={tabsLabel}
        className="flex overflow-x-auto scrollbar-none border-b border-border dark:border-night-border mb-8"
      >
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) => [
              'relative flex-shrink-0 inline-flex items-center gap-2 min-h-[44px] px-4 font-mono text-label uppercase tracking-widest whitespace-nowrap transition-colors duration-150',
              isActive
                ? 'text-primary dark:text-primary-300 font-bold'
                : 'text-ink-secondary dark:text-night-muted hover:text-ink-primary dark:hover:text-night-text',
            ].join(' ')}
          >
            {({ isActive }) => (
              <>
                {tab.label}
                {tab.count != null && (
                  <span className="px-1.5 py-0.5 rounded-sm bg-primary-50 dark:bg-night-raised text-ink-secondary dark:text-night-muted font-mono text-label normal-case tracking-normal">
                    {tab.count}
                  </span>
                )}
                {isActive && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary dark:bg-primary-300 rounded-full" aria-hidden="true" />
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>
      )}

      <Outlet context={context} />
    </main>
  )
}
