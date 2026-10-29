import { useState, useRef, useEffect, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { IconButton } from '@/components/ui'
import { localeFor } from '../utils/dates'
import { Outlet, Link, NavLink, useNavigate, useLocation } from 'react-router-dom'
import type { UserProfile } from '@/store/authStore'
import { getSession, signOut } from '@/store/authStore'
import {
  getNotificationsForUser,
  markNotificationRead,
  markAllReadForUser,
  type ContributorNotification,
  type NotificationType,
} from '../store/notificationStore'
import { newsletterPath } from '@/newsletter/paths'

export default function ContributorLayout() {
  const { t, i18n } = useTranslation()
  const [session, setSession] = useState<UserProfile | null>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const [notifOpen, setNotifOpen] = useState(false)
  const [notifications, setNotifications] = useState<ContributorNotification[]>([])
  const unread = notifications.filter((n) => !n.read).length
  const bellRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    getSession().then((s) => {
      setSession(s)
      if (s) setNotifications(getNotificationsForUser(s.id))
    })
  }, [])

  useEffect(() => { setNotifOpen(false) }, [location.pathname])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setNotifOpen(false) }
    function onClickOutside(e: MouseEvent) {
      // Cast: mousedown on the document always targets a DOM node.
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setNotifOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClickOutside)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClickOutside)
    }
  }, [])

  async function handleSignOut() {
    await signOut()
    navigate(newsletterPath('/'), { replace: true })
  }

  function openNotifs() {
    if (session) {
      setNotifications(getNotificationsForUser(session.id))
    }
    setNotifOpen((v) => !v)
  }

  function handleMarkRead(id: string) {
    markNotificationRead(id)
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
  }

  function handleMarkAllRead() {
    if (session) {
      markAllReadForUser(session.id)
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
    }
  }

  function notifLink(n: ContributorNotification) {
    if (n.type === 'changes_requested') {
      return newsletterPath(`/contribute/review/${n.resourceType}/${n.resourceId}`)
    }
    return newsletterPath('/contribute')
  }

  return (
    <div className="min-h-screen flex flex-col bg-surface dark:bg-night-bg">
      {/* Top bar */}
      <header className="sticky top-0 z-20 bg-white dark:bg-night-surface border-b border-border dark:border-night-border h-14 flex items-center px-4 sm:px-6 gap-4">
        {/* Brand */}
        <Link to={newsletterPath('/')} className="flex items-baseline gap-2 focus-visible:rounded-sm">
          <span className="font-display text-h5 font-bold text-primary">ITBA News</span>
          <span className="font-mono text-label text-accent-500 uppercase tracking-widest hidden sm:inline">
            {t('contributor.brand')}
          </span>
        </Link>

        {/* Nav links */}
        <nav aria-label={t('contributor.brand')} className="hidden sm:flex items-center gap-1 ml-4">
          <ContribNavLink to={newsletterPath('/contribute')}>{t('contributor.nav.mine')}</ContribNavLink>
          <ContribNavLink to={newsletterPath('/contribute/suggest/article')}>{t('contributor.nav.article')}</ContribNavLink>
          <ContribNavLink to={newsletterPath('/contribute/suggest/event')}>{t('contributor.nav.event')}</ContribNavLink>
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {/* Notification bell */}
          <div ref={bellRef} className="relative">
            <IconButton
              onClick={openNotifs}
              aria-expanded={notifOpen}
              className="relative"
              aria-label={unread > 0 ? t('contributor.notificationsUnread', { count: unread }) : t('contributor.notifications')}
            >
              <IconBell />
              {unread > 0 && (
                <span aria-hidden="true" className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-ink-primary font-mono text-label font-bold flex items-center justify-center leading-none">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </IconButton>

            {notifOpen && (
              <div className="absolute right-0 mt-2 w-80 bg-white dark:bg-night-surface rounded-card border border-border dark:border-night-border shadow-card z-50 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border dark:border-night-border">
                  <p className="font-body text-body-sm font-semibold text-ink-primary">{t('contributor.notifications')}</p>
                  {unread > 0 && (
                    <button
                      type="button"
                      onClick={handleMarkAllRead}
                      className="min-h-[44px] px-2 font-mono text-label text-primary hover:underline"
                    >
                      {t('contributor.markAllRead')}
                    </button>
                  )}
                </div>
                <ul className="max-h-72 overflow-y-auto divide-y divide-border dark:divide-night-border">
                  {notifications.length === 0 ? (
                    <li className="px-4 py-6 text-center font-body text-body-sm text-ink-secondary">
                      {t('contributor.noNotifications')}
                    </li>
                  ) : (
                    notifications.map((n) => (
                      <li key={n.id} className={['transition-colors duration-100', !n.read ? 'bg-primary-50 dark:bg-primary-800' : ''].join(' ')}>
                        <Link
                          to={notifLink(n)}
                          onClick={() => handleMarkRead(n.id)}
                          className="block px-4 py-3 hover:bg-surface dark:hover:bg-night-bg"
                        >
                          <div className="flex items-start gap-2">
                            <NotifIcon type={n.type} />
                            <div className="flex-1 min-w-0">
                              <p className="font-body text-body-sm text-ink-primary line-clamp-2">{n.message}</p>
                              <p className="font-mono text-label text-ink-secondary mt-1">
                                {new Date(n.createdAt).toLocaleDateString(localeFor(i18n.language), {
                                  day: 'numeric', month: 'short',
                                })}
                              </p>
                            </div>
                            {!n.read && (
                              <span className="w-2 h-2 rounded-full bg-accent shrink-0 mt-1" />
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
              className="min-h-[44px] px-2 font-mono text-label text-ink-secondary hover:text-ink-primary transition-colors duration-150 underline underline-offset-2"
            >
              {t('auth.signOut')}
            </button>
          </div>
        </div>
      </header>

      {/* Page content */}
      <main id="main-content" className="flex-1 p-4 sm:p-6 lg:p-8 max-w-content mx-auto w-full">
        <Outlet />
      </main>
    </div>
  )
}

interface ContribNavLinkProps {
  to: string
  children: ReactNode
}

function ContribNavLink({ to, children }: ContribNavLinkProps) {
  return (
    <NavLink
      to={to}
      end={to === newsletterPath('/contribute')}
      className={({ isActive }) => [
        'inline-flex items-center min-h-[44px] px-3 rounded-xs font-body text-body-sm font-semibold transition-colors duration-150',
        isActive
          ? 'bg-primary-50 dark:bg-primary-800 text-primary'
          : 'text-ink-secondary hover:text-ink-primary hover:bg-surface dark:hover:bg-night-bg',
      ].join(' ')}
    >
      {children}
    </NavLink>
  )
}

interface NotifIconProps {
  type: NotificationType
}

function NotifIcon({ type }: NotifIconProps) {
  if (type === 'approved') {
    return (
      <span className="w-6 h-6 rounded-full bg-emerald-100 dark:bg-emerald-900 flex items-center justify-center shrink-0">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-emerald-600 dark:text-emerald-400" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
      </span>
    )
  }
  if (type === 'rejected') {
    return (
      <span className="w-6 h-6 rounded-full bg-red-100 dark:bg-red-950 flex items-center justify-center shrink-0">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-red-600 dark:text-red-400" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </span>
    )
  }
  return (
    <span className="w-6 h-6 rounded-full bg-accent-100 dark:bg-accent-900 flex items-center justify-center shrink-0">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-amber-600 dark:text-amber-400" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
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
