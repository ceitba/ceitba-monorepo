import { useState, useRef, useEffect } from 'react'
import { Outlet, Link, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { getSession, signOut } from '../store/authStore'
import {
  getNotificationsForUser,
  getUnreadCountForUser,
  markNotificationRead,
  markAllReadForUser,
} from '../store/notificationStore'

export default function ContributorLayout() {
  const [session, setSession] = useState(null)
  const navigate = useNavigate()
  const location = useLocation()
  const [notifOpen, setNotifOpen] = useState(false)
  const [notifications, setNotifications] = useState([])
  const unread = notifications.filter((n) => !n.read).length
  const bellRef = useRef(null)

  useEffect(() => {
    getSession().then((s) => {
      setSession(s)
      if (s) setNotifications(getNotificationsForUser(s.id))
    })
  }, [])

  useEffect(() => { setNotifOpen(false) }, [location.pathname])

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') setNotifOpen(false) }
    function onClickOutside(e) {
      if (bellRef.current && !bellRef.current.contains(e.target)) setNotifOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClickOutside)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClickOutside)
    }
  }, [])

  function handleSignOut() {
    signOut()
    navigate('/')
  }

  function openNotifs() {
    if (session) {
      setNotifications(getNotificationsForUser(session.id))
    }
    setNotifOpen((v) => !v)
  }

  function handleMarkRead(id) {
    markNotificationRead(id)
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
  }

  function handleMarkAllRead() {
    if (session) {
      markAllReadForUser(session.id)
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
    }
  }

  function notifLink(n) {
    if (n.type === 'changes_requested') {
      return `/contribute/review/${n.resourceType}/${n.resourceId}`
    }
    return '/contribute'
  }

  return (
    <div className="min-h-screen flex flex-col bg-surface">
      {/* Top bar */}
      <header className="sticky top-0 z-20 bg-white border-b border-border h-14 flex items-center px-4 sm:px-6 gap-4">
        {/* Brand */}
        <Link to="/" className="flex items-baseline gap-2 focus-visible:rounded">
          <span className="font-display text-h5 font-bold text-primary">ITBA News</span>
          <span className="font-mono text-label text-accent-500 uppercase tracking-widest hidden sm:inline">
            Contribuir
          </span>
        </Link>

        {/* Nav links */}
        <nav className="hidden sm:flex items-center gap-1 ml-4">
          <ContribNavLink to="/contribute">Mis sugerencias</ContribNavLink>
          <ContribNavLink to="/contribute/suggest/article">+ Artículo</ContribNavLink>
          <ContribNavLink to="/contribute/suggest/event">+ Evento</ContribNavLink>
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {/* Notification bell */}
          <div ref={bellRef} className="relative">
            <button
              type="button"
              onClick={openNotifs}
              className="relative w-9 h-9 flex items-center justify-center text-ink-secondary hover:text-ink-primary rounded-sm focus-visible:rounded transition-colors duration-150"
              aria-label={`Notificaciones${unread > 0 ? ` (${unread} sin leer)` : ''}`}
            >
              <IconBell />
              {unread > 0 && (
                <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-accent text-white font-mono text-[9px] font-bold flex items-center justify-center leading-none">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </button>

            {notifOpen && (
              <div className="absolute right-0 mt-2 w-80 bg-white rounded-card border border-border shadow-lg z-50 overflow-hidden animate-fade-in">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                  <p className="font-body text-body-sm font-semibold text-ink-primary">Notificaciones</p>
                  {unread > 0 && (
                    <button
                      type="button"
                      onClick={handleMarkAllRead}
                      className="font-mono text-label text-primary hover:underline"
                    >
                      Marcar todas leídas
                    </button>
                  )}
                </div>
                <ul className="max-h-72 overflow-y-auto divide-y divide-border">
                  {notifications.length === 0 ? (
                    <li className="px-4 py-6 text-center font-body text-body-sm text-ink-secondary">
                      Sin notificaciones
                    </li>
                  ) : (
                    notifications.map((n) => (
                      <li key={n.id} className={['transition-colors duration-100', !n.read ? 'bg-primary-50' : ''].join(' ')}>
                        <Link
                          to={notifLink(n)}
                          onClick={() => handleMarkRead(n.id)}
                          className="block px-4 py-3 hover:bg-surface"
                        >
                          <div className="flex items-start gap-2">
                            <NotifIcon type={n.type} />
                            <div className="flex-1 min-w-0">
                              <p className="font-body text-body-sm text-ink-primary line-clamp-2">{n.message}</p>
                              <p className="font-mono text-label text-ink-secondary mt-1">
                                {new Date(n.createdAt).toLocaleDateString('es-AR', {
                                  day: 'numeric', month: 'short',
                                })}
                              </p>
                            </div>
                            {!n.read && (
                              <span className="w-2 h-2 rounded-full bg-accent flex-shrink-0 mt-1" />
                            )}
                          </div>
                        </Link>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            )}
          </div>

          {/* User info */}
          <div className="hidden sm:flex items-center gap-2">
            <span className="font-body text-body-sm text-ink-secondary truncate max-w-[140px]">
              {session?.name}
            </span>
            <button
              type="button"
              onClick={handleSignOut}
              className="font-mono text-label text-ink-secondary hover:text-red-500 transition-colors duration-150 underline underline-offset-2"
            >
              Salir
            </button>
          </div>
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1120px] mx-auto w-full">
        <Outlet />
      </main>
    </div>
  )
}

function ContribNavLink({ to, children }) {
  return (
    <NavLink
      to={to}
      end={to === '/contribute'}
      className={({ isActive }) => [
        'px-3 py-1.5 rounded-sm font-body text-body-sm font-semibold transition-colors duration-150',
        isActive
          ? 'bg-primary-50 text-primary'
          : 'text-ink-secondary hover:text-ink-primary hover:bg-surface',
      ].join(' ')}
    >
      {children}
    </NavLink>
  )
}

function NotifIcon({ type }) {
  if (type === 'approved') {
    return (
      <span className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
      </span>
    )
  }
  if (type === 'rejected') {
    return (
      <span className="w-6 h-6 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </span>
    )
  }
  return (
    <span className="w-6 h-6 rounded-full bg-accent-100 flex items-center justify-center flex-shrink-0">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
    </span>
  )
}

function IconBell() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
      <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
    </svg>
  )
}
