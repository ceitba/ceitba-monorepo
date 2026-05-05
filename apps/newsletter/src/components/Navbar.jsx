import { useState, useEffect, useRef } from 'react'
import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { setLang, getTheme, setTheme } from '../store/prefsStore'
import AuthMenu from './AuthMenu'

export default function Navbar() {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const [theme, setThemeState] = useState(getTheme)
  const drawerRef = useRef(null)

  const NAV_LINKS = [
    { to: '/',               label: t('nav.articles'),      end: true },
    { to: '/events',         label: t('nav.events'),        end: false },
    { to: '/organizations',  label: t('nav.organizations'), end: false },
  ]

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  useEffect(() => {
    if (open && drawerRef.current) {
      drawerRef.current.querySelector('a')?.focus()
    }
  }, [open])

  const linkClass = ({ isActive }) =>
    [
      'font-body text-body font-semibold tracking-wide transition-colors duration-150',
      isActive
        ? 'text-primary border-b-2 border-accent pb-0.5'
        : 'text-ink-primary hover:text-primary',
    ].join(' ')

  const toggleLang = () => {
    const next = i18n.language === 'es' ? 'en' : 'es'
    i18n.changeLanguage(next)
    setLang(next)
  }

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    setThemeState(next)
  }

  return (
    <>
      <header className="sticky top-0 z-40 bg-surface/95 dark:bg-[#18181b]/95 backdrop-blur-sm border-b border-border dark:border-[#3f3f46]">
        <div className="container-content">
          <nav
            className="flex items-center justify-between h-16"
            aria-label={t('nav.articles')}
          >
            {/* Logotype */}
            <a
              href="https://ceitba.org.ar/"
              className="flex flex-col leading-none focus-visible:rounded"
              aria-label={t('nav.home')}
            >
              <span className="font-display text-h5 font-bold text-primary tracking-tight">
                {t('nav.home')}
              </span>
              <span className="font-mono text-label text-ink-secondary uppercase tracking-widest">
                {t('nav.tagline')}
              </span>
            </a>

            {/* Desktop nav */}
            <div className="hidden sm:flex items-center gap-6">
              <ul className="flex items-center gap-8 list-none m-0 p-0">
                {NAV_LINKS.map(({ to, label, end }) => (
                  <li key={to}>
                    <NavLink to={to} end={end} className={linkClass}>
                      {label}
                    </NavLink>
                  </li>
                ))}
              </ul>
              <AuthMenu mobile={false} />
              <LangToggle lang={i18n.language} onToggle={toggleLang} />
              <ThemeToggle theme={theme} onToggle={toggleTheme} />
            </div>

            {/* Mobile controls */}
            <div className="flex sm:hidden items-center gap-2">
              <LangToggle lang={i18n.language} onToggle={toggleLang} />
              <ThemeToggle theme={theme} onToggle={toggleTheme} />
              <button
                type="button"
                className="flex items-center justify-center w-11 h-11 rounded text-ink-primary hover:text-primary focus-visible:rounded"
                aria-label={open ? t('nav.closeMenu') : t('nav.openMenu')}
                aria-expanded={open}
                aria-controls="mobile-drawer"
                onClick={() => setOpen((v) => !v)}
              >
                {open ? <IconClose /> : <IconMenu />}
              </button>
            </div>
          </nav>
        </div>
      </header>

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-ink-primary/40 sm:hidden"
          aria-hidden="true"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Drawer */}
      <div
        id="mobile-drawer"
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('nav.openMenu')}
        className={[
          'fixed top-0 right-0 z-50 h-full w-72 bg-white shadow-xl flex flex-col pt-20 px-8 gap-6 sm:hidden',
          'transition-transform duration-250',
          open ? 'translate-x-0 animate-slide-in' : 'translate-x-full',
        ].join(' ')}
      >
        <button
          type="button"
          className="absolute top-4 right-4 w-11 h-11 flex items-center justify-center text-ink-secondary hover:text-ink-primary focus-visible:rounded"
          aria-label={t('nav.closeMenu')}
          onClick={() => setOpen(false)}
        >
          <IconClose />
        </button>
        <ul className="flex flex-col gap-6 list-none m-0 p-0">
          {NAV_LINKS.map(({ to, label, end }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                className={linkClass}
                onClick={() => setOpen(false)}
              >
                {label}
              </NavLink>
            </li>
          ))}
          <li>
            <AuthMenu mobile={true} />
          </li>
        </ul>
      </div>

    </>
  )
}

function ThemeToggle({ theme, onToggle }) {
  const isDark = theme === 'dark'
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="min-h-[36px] w-9 flex items-center justify-center text-ink-secondary hover:text-primary transition-colors duration-150 rounded-sm hover:bg-primary-50 focus-visible:rounded"
    >
      {isDark ? <IconSun /> : <IconMoon />}
    </button>
  )
}

function LangToggle({ lang, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={lang === 'es' ? 'Switch to English' : 'Cambiar a español'}
      className="min-h-[36px] px-2 font-mono text-label uppercase tracking-widest text-ink-secondary hover:text-primary transition-colors duration-150 focus-visible:rounded"
    >
      {lang === 'es' ? 'EN' : 'ES'}
    </button>
  )
}

function IconSun() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2"  x2="12" y2="4"  />
      <line x1="12" y1="20" x2="12" y2="22" />
      <line x1="4.22" y1="4.22"  x2="5.64" y2="5.64"  />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="2" y1="12" x2="4"  y2="12" />
      <line x1="20" y1="12" x2="22" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64"  x2="19.78" y2="4.22"  />
    </svg>
  )
}

function IconMoon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}

function IconMenu() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <line x1="3" y1="6"  x2="21" y2="6"  />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  )
}

function IconClose() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <line x1="18" y1="6"  x2="6"  y2="18" />
      <line x1="6"  y1="6"  x2="18" y2="18" />
    </svg>
  )
}
