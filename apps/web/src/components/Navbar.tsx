import { useTranslation } from 'react-i18next'
import { Link, NavLink } from 'react-router-dom'
import { useThemeContext } from '../context/useThemeContext'
import AuthMenu from './AuthMenu'
import { useCapability } from '../hooks/useCapability'
import { iconButtonClass } from './ui'

// The CEITBA app's sections. Home is the brand link.
const SECTIONS = [
  { to: '/scheduler', label: 'nav.scheduler' },
  { to: '/newsletter', label: 'nav.newsletter' },
  { to: '/apuntes', label: 'nav.apuntes', capability: 'apuntes' },
] as const

function SectionLinks({ className, linkClassName }: { className: string; linkClassName: string }) {
  const { t } = useTranslation()
  const { enabled: apuntesEnabled } = useCapability('apuntes')
  return (
    <nav aria-label={t('nav.sectionsAria')} className={className}>
      {SECTIONS.filter((s) => !('capability' in s) || apuntesEnabled).map(({ to, label }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            `${linkClassName} min-h-[44px] inline-flex items-center flex-shrink-0 font-mono text-label uppercase tracking-widest transition-colors duration-150 border-b-2 ${
              isActive
                ? 'text-primary border-accent'
                : 'text-ink-secondary dark:text-night-muted hover:text-primary border-transparent'
            }`
          }
        >
          {t(label)}
        </NavLink>
      ))}
    </nav>
  )
}

// One header for every section. Only the top row is sticky (sections'
// sticky elements assume its 4rem height); on phones the section links get
// their own row below it, which scrolls away.
export default function Navbar() {
  const { t, i18n } = useTranslation()
  const { theme, toggle } = useThemeContext()

  const toggleLanguage = () => {
    const next = i18n.language === 'es' ? 'en' : 'es'
    // languageChanged listeners persist it: src/i18n.ts writes localStorage,
    // ThemeContext PATCHes the server for signed-in users.
    i18n.changeLanguage(next)
  }

  return (
    <>
      <header className="sticky top-0 z-40 bg-surface/95 dark:bg-night-bg/95 backdrop-blur-sm border-b border-border dark:border-night-border">
        <div className="h-[3px] bg-primary" aria-hidden="true" />
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:bg-primary focus:text-white focus:px-4 focus:py-2 focus:rounded-sm"
        >
          {t('nav.skipToContent')}
        </a>
        <div className="container-content h-16 flex items-center justify-between">
          <Link
            to="/"
            aria-label={t('nav.homeAria')}
            className="flex flex-col justify-center hover:opacity-80 transition-opacity duration-150"
          >
            <span className="font-display text-h5 font-bold text-primary tracking-tight leading-tight">CEITBA</span>
            <span className="hidden sm:block font-mono text-label text-ink-secondary dark:text-night-muted uppercase tracking-widest leading-tight">
              {t('nav.tagline')}
            </span>
          </Link>

          <SectionLinks className="hidden md:flex items-center gap-6 mr-auto ml-10" linkClassName="px-0.5" />

          <div className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={toggleLanguage}
              className="min-h-[44px] min-w-[44px] px-2 rounded-sm font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted hover:text-primary transition-colors duration-150"
              aria-label={t('nav.langToggleAria')}
            >
              {t('nav.langToggleLabel')}
            </button>

            <button
              type="button"
              onClick={toggle}
              className={iconButtonClass()}
              aria-label={theme === 'dark' ? t('nav.themeToggleLight') : t('nav.themeToggleDark')}
            >
              {theme === 'dark' ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="5" />
                  <line x1="12" y1="1" x2="12" y2="3" />
                  <line x1="12" y1="21" x2="12" y2="23" />
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                  <line x1="1" y1="12" x2="3" y2="12" />
                  <line x1="21" y1="12" x2="23" y2="12" />
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
            </button>

            <AuthMenu />
          </div>
        </div>
      </header>
      <SectionLinks
        className="md:hidden flex items-center gap-5 overflow-x-auto px-4 border-b border-border dark:border-night-border bg-surface dark:bg-night-bg"
        linkClassName=""
      />
    </>
  )
}
