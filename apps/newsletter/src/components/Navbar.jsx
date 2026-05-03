import { useState, useEffect, useRef } from 'react'
import { NavLink, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { getSession } from '../store/authStore'
import ContributeModal from './ContributeModal'

const ADMIN_ROLES = ['staff', 'admin', 'editor']

export default function Navbar() {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [session, setSession] = useState(undefined)
  const drawerRef = useRef(null)

  useEffect(() => {
    getSession().then(setSession)
  }, [])

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

  const toggleLang = () =>
    i18n.changeLanguage(i18n.language === 'es' ? 'en' : 'es')

  function handleContributeClick() {
    setOpen(false)
    setModalOpen(true)
  }

  const btnClass =
    'min-h-[36px] px-4 inline-flex items-center font-body text-body-sm font-semibold bg-primary text-surface rounded-sm hover:bg-primary-600 transition-colors duration-150 focus-visible:rounded'

  function AuthButton({ mobile }) {
    const cls = mobile
      ? 'inline-flex items-center gap-2 min-h-[44px] px-5 bg-primary text-surface font-body font-semibold rounded-sm hover:bg-primary-600 transition-colors duration-150'
      : btnClass

    if (session === undefined) return null

    if (session && ADMIN_ROLES.includes(session.role)) {
      return (
        <Link to="/admin/articles" onClick={() => setOpen(false)} className={cls}>
          Panel admin
        </Link>
      )
    }
    if (session) {
      return (
        <Link to="/contribute" onClick={() => setOpen(false)} className={cls}>
          Contribuir
        </Link>
      )
    }
    return (
      <button type="button" onClick={handleContributeClick} className={cls}>
        Contribuir
      </button>
    )
  }

  return (
    <>
      <header className="sticky top-0 z-40 bg-surface/95 backdrop-blur-sm border-b border-border">
        <div className="container-content">
          <nav
            className="flex items-center justify-between h-16"
            aria-label={t('nav.articles')}
          >
            {/* Logotype */}
            <Link
              to="/"
              className="flex flex-col leading-none focus-visible:rounded"
              aria-label={t('nav.home')}
            >
              <span className="font-display text-h5 font-bold text-primary tracking-tight">
                {t('nav.home')}
              </span>
              <span className="font-mono text-label text-ink-secondary uppercase tracking-widest">
                {t('nav.tagline')}
              </span>
            </Link>

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
              <AuthButton mobile={false} />
              <LangToggle lang={i18n.language} onToggle={toggleLang} />
            </div>

            {/* Mobile controls */}
            <div className="flex sm:hidden items-center gap-2">
              <LangToggle lang={i18n.language} onToggle={toggleLang} />
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
          'fixed top-0 right-0 z-50 h-full w-72 bg-surface shadow-xl flex flex-col pt-20 px-8 gap-6 sm:hidden',
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
            <AuthButton mobile={true} />
          </li>
        </ul>
      </div>

      <ContributeModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  )
}

function LangToggle({ lang, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={lang === 'es' ? 'Switch to English' : 'Cambiar a español'}
      className="font-mono text-label uppercase tracking-widest px-2.5 py-1.5 min-h-[36px] rounded-sm border border-border text-ink-secondary hover:border-primary hover:text-primary transition-colors duration-150 focus-visible:rounded"
    >
      {lang === 'es' ? 'EN' : 'ES'}
    </button>
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
