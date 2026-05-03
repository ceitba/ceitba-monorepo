import { useState, useEffect, useRef } from 'react'
import { Outlet, NavLink, Link, useNavigate, useLocation } from 'react-router-dom'
import { signOut, getSession } from '../store/authStore'
import { getPendingArticleSuggestionsCount } from '../store/articleStore'
import { getPendingEventSuggestionsCount } from '../store/eventStore'

const NAV = [
  {
    label: 'Contenido',
    items: [
      { to: '/admin/articles',     label: 'Artículos',    icon: <IconDoc />        },
      { to: '/admin/events',       label: 'Eventos',      icon: <IconCal />        },
      { to: '/admin/suggestions',  label: 'Sugerencias',  icon: <IconInbox />      },
    ],
  },
  {
    label: 'Medios',
    items: [
      { to: '/admin/analytics',    label: 'Analíticas',   icon: <IconChart />      },
    ],
  },
]

export default function AdminLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [session, setSession] = useState(null)
  const navigate = useNavigate()
  const location = useLocation()
  const drawerRef = useRef(null)

  useEffect(() => { getSession().then(setSession) }, [])

  // Close drawer on navigation
  useEffect(() => { setSidebarOpen(false) }, [location.pathname])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setSidebarOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    document.body.style.overflow = sidebarOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [sidebarOpen])

  function handleSignOut() {
    signOut()
    navigate('/admin/login')
  }

  const pendingSuggestions = getPendingArticleSuggestionsCount() + getPendingEventSuggestionsCount()

  const counts = {
    '/admin/articles':    null,
    '/admin/events':      null,
    '/admin/suggestions': pendingSuggestions || null,
    '/admin/analytics':   null,
  }

  const linkClass = ({ isActive }) =>
    [
      'flex items-center gap-3 px-3 py-2 rounded-sm text-body-sm font-semibold transition-colors duration-150',
      isActive
        ? 'bg-primary-700 text-white'
        : 'text-primary-200 hover:bg-primary-800 hover:text-white',
    ].join(' ')

  const sidebar = (
    <nav className="flex flex-col h-full" aria-label="Admin navigation">
      {/* Brand */}
      <div className="px-5 py-5 border-b border-primary-700">
        <Link
          to="/"
          className="flex flex-col leading-none focus-visible:rounded"
          aria-label="Volver al sitio público"
        >
          <span className="font-display text-h5 font-bold text-white">ITBA News</span>
          <span className="font-mono text-label text-primary-400 uppercase tracking-widest mt-0.5">
            Panel Admin
          </span>
        </Link>
        <Link
          to="/"
          className="mt-3 inline-flex items-center gap-1.5 font-mono text-label text-primary-400 hover:text-accent transition-colors duration-150"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><polyline points="15 18 9 12 15 6" /></svg>
          Ver sitio
        </Link>
      </div>

      {/* Nav groups */}
      <div className="flex-1 px-3 py-4 overflow-y-auto">
        {NAV.map(({ label, items }) => (
          <div key={label} className="mb-6">
            <p className="font-mono text-label uppercase tracking-widest text-primary-500 px-3 mb-2">
              {label}
            </p>
            <ul className="flex flex-col gap-1 list-none m-0 p-0">
              {items.map(({ to, label: itemLabel, icon }) => (
                <li key={to}>
                  <NavLink to={to} className={linkClass} end={false}>
                    <span className="w-4 h-4 flex-shrink-0">{icon}</span>
                    <span className="flex-1">{itemLabel}</span>
                    {counts[to] !== null && (
                      <span className="font-mono text-label bg-primary-800 text-primary-300 px-1.5 py-0.5 rounded-sm">
                        {counts[to] ?? 0}
                      </span>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Session footer */}
      <div className="px-5 py-4 border-t border-primary-700">
        <p className="font-body text-body-sm text-primary-200 truncate">{session?.name}</p>
        <p className="font-mono text-label text-primary-500 uppercase tracking-widest mt-0.5">
          {session?.role?.replace('_', ' ')}
        </p>
        <button
          type="button"
          onClick={handleSignOut}
          className="mt-3 font-mono text-label text-primary-400 hover:text-red-400 transition-colors duration-150 underline underline-offset-2"
        >
          Cerrar sesión
        </button>
      </div>
    </nav>
  )

  return (
    <div className="min-h-screen flex bg-surface">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-56 flex-shrink-0 bg-primary-900 fixed inset-y-0 left-0 z-30">
        {sidebar}
      </aside>

      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          aria-hidden="true"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Mobile sidebar drawer */}
      <aside
        ref={drawerRef}
        className={[
          'fixed inset-y-0 left-0 z-50 w-56 bg-primary-900 flex flex-col lg:hidden',
          'transition-transform duration-250',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
        aria-label="Admin navigation"
      >
        {sidebar}
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col lg:ml-56 min-w-0">
        {/* Topbar */}
        <header className="sticky top-0 z-20 bg-white border-b border-border h-14 flex items-center px-4 sm:px-6 gap-4">
          <button
            type="button"
            className="lg:hidden w-9 h-9 flex items-center justify-center text-ink-secondary hover:text-ink-primary focus-visible:rounded"
            aria-label="Abrir menú"
            onClick={() => setSidebarOpen(true)}
          >
            <IconMenu />
          </button>
          <Breadcrumb />
          <div className="ml-auto">
            <Link
              to="/admin/articles/new"
              className="hidden sm:inline-flex items-center gap-2 min-h-[36px] px-4 bg-primary text-surface font-body text-body-sm font-semibold rounded-sm hover:bg-primary-600 transition-colors duration-150 focus-visible:rounded"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Nuevo artículo
            </Link>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function Breadcrumb() {
  const { pathname } = useLocation()
  const segments = {
    '/admin/articles':       'Artículos',
    '/admin/articles/new':   'Artículos / Nuevo',
    '/admin/events':         'Eventos',
    '/admin/events/new':     'Eventos / Nuevo',
    '/admin/suggestions':    'Sugerencias',
    '/admin/analytics':      'Analíticas',
  }
  const label = segments[pathname]
    ?? (pathname.includes('/admin/suggestions/') ? 'Sugerencias / Revisar'
      : pathname.includes('/edit') ? (pathname.includes('articles') ? 'Artículos / Editar' : 'Eventos / Editar')
      : '')

  return (
    <span className="font-body text-body-sm text-ink-secondary">{label}</span>
  )
}

function IconDoc() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
}
function IconCal() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
}
function IconInbox() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
}
function IconChart() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg>
}
function IconMenu() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
}
