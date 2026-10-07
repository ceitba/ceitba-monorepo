import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useCapability } from '../hooks/useCapability'
import { signOut, startGoogleSignIn } from '../store/authStore'
import { safeHttpUrl } from '../utils/url'
import DigestToggle from './DigestToggle'
import { buttonClass } from './ui'

// Enabled items of the account menu, in DOM order.
function menuItems(menu: HTMLElement | null) {
  return Array.from(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"], [role="menuitemcheckbox"]') ?? [])
    .filter((el) => !el.disabled)
}

// Renders one of three states in the navbar slot:
//   loading  -> nothing (avoid flicker before /me resolves)
//   anon     -> "Iniciar sesión" button that bounces to Google and back here
//   authed   -> avatar + dropdown with every section's personal pages
export default function AuthMenu() {
  const { t } = useTranslation()
  const { profile, loading, isStaff } = useAuth()
  const { enabled: apuntesEnabled } = useCapability('apuntes')
  // Behind the resumen_semanal capability; a 403 CAPABILITY_REQUIRED hides it too.
  const { enabled: digestEnabled } = useCapability('resumen_semanal')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const location = useLocation()

  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    // Move focus into the menu so arrow keys work right away.
    menuItems(menuRef.current)[0]?.focus()
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); triggerRef.current?.focus() }
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Arrow keys / Home / End move between items (WAI-ARIA menu button);
  // Tab leaves the menu and closes it.
  function onMenuKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    const list = menuItems(menuRef.current)
    if (list.length === 0) return
    const i = list.indexOf(document.activeElement as HTMLButtonElement)
    let next = -1
    if (e.key === 'ArrowDown') next = (i + 1) % list.length
    else if (e.key === 'ArrowUp') next = i <= 0 ? list.length - 1 : i - 1
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = list.length - 1
    else if (e.key === 'Tab') { setOpen(false); return }
    if (next < 0) return
    e.preventDefault()
    list[next].focus()
  }

  if (loading) return <div className="w-11 h-11" aria-hidden="true" />

  if (!profile) {
    return (
      <div className="flex items-center gap-2">
        {import.meta.env.DEV && import.meta.env.VITE_DEV_LOGIN === 'true' && (
          <Link
            to="/dev-login"
            className="min-h-[44px] inline-flex items-center px-2 font-mono text-label uppercase tracking-widest text-accent-600 dark:text-accent-300 border border-dashed border-accent-400 rounded-sm hover:bg-accent-50 dark:hover:bg-accent-900/30"
          >
            {t('devLogin.link', { defaultValue: 'Dev login' })}
          </Link>
        )}
        <button
          type="button"
          onClick={() => startGoogleSignIn(location.pathname + location.search)}
          className={buttonClass({ variant: 'outline' })}
        >
          {t('auth.signIn')}
        </button>
      </div>
    )
  }

  const initials = (profile.name ?? profile.email)
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
  const avatarUrl = safeHttpUrl(profile.avatarUrl)
  return (
    <div className="relative" ref={ref}>
      {/* 44px hit area around the 36px avatar. */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true) } }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? 'account-menu' : undefined}
        aria-label={t('auth.accountMenu')}
        className="group w-11 h-11 flex items-center justify-center rounded-full"
      >
        <span className="w-9 h-9 rounded-full overflow-hidden border border-border dark:border-night-border bg-primary-100 dark:bg-primary-900 flex items-center justify-center group-hover:border-primary transition-colors duration-150">
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="font-display font-bold text-label text-primary dark:text-primary-200" aria-hidden="true">{initials}</span>
          )}
        </span>
      </button>

      {open && (
        <div
          ref={menuRef}
          id="account-menu"
          role="menu"
          aria-label={t('auth.accountMenu')}
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 top-full mt-2 w-64 bg-white dark:bg-night-surface border border-border dark:border-night-border rounded-card shadow-card-hover py-1 z-50"
        >
          <div className="px-3 py-2 border-b border-border dark:border-night-border">
            <p className="font-body text-body-sm font-semibold text-ink-primary dark:text-night-text truncate">
              {profile.name ?? profile.email}
            </p>
            <p className="font-mono text-label text-ink-secondary dark:text-night-muted truncate">
              {profile.email}
            </p>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); navigate('/profile') }}
            className="w-full min-h-[44px] text-left px-3 py-2 font-body text-body-sm text-ink-primary dark:text-night-text hover:bg-primary-50 dark:hover:bg-night-raised focus-visible:bg-primary-50 dark:focus-visible:bg-night-raised"
          >
            {t('auth.profile')}
          </button>
          {apuntesEnabled && (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => { setOpen(false); navigate('/apuntes') }}
                className="w-full min-h-[44px] text-left px-3 py-2 font-body text-body-sm text-ink-primary dark:text-night-text hover:bg-primary-50 dark:hover:bg-night-raised focus-visible:bg-primary-50 dark:focus-visible:bg-night-raised"
              >
                {t('auth.apuntes')}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => { setOpen(false); navigate('/apuntes/mis-apuntes') }}
                className="w-full min-h-[44px] text-left px-3 py-2 font-body text-body-sm text-ink-primary dark:text-night-text hover:bg-primary-50 dark:hover:bg-night-raised focus-visible:bg-primary-50 dark:focus-visible:bg-night-raised"
              >
                {t('auth.myApuntes')}
              </button>
            </>
          )}
          {digestEnabled && <DigestToggle />}
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); navigate('/scheduler/saved') }}
            className="w-full min-h-[44px] text-left px-3 py-2 font-body text-body-sm text-ink-primary dark:text-night-text hover:bg-primary-50 dark:hover:bg-night-raised focus-visible:bg-primary-50 dark:focus-visible:bg-night-raised"
          >
            {t('auth.savedSchedules')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); navigate('/newsletter/mine') }}
            className="w-full min-h-[44px] text-left px-3 py-2 font-body text-body-sm text-ink-primary dark:text-night-text hover:bg-primary-50 dark:hover:bg-night-raised focus-visible:bg-primary-50 dark:focus-visible:bg-night-raised"
          >
            {t('auth.myPosts')}
          </button>
          {isStaff && (
            <button
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); navigate('/newsletter/admin') }}
              className="w-full min-h-[44px] text-left px-3 py-2 font-body text-body-sm text-ink-primary dark:text-night-text hover:bg-primary-50 dark:hover:bg-night-raised focus-visible:bg-primary-50 dark:focus-visible:bg-night-raised"
            >
              {t('auth.newsletterAdmin')}
            </button>
          )}
          {isStaff && (
            <button
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); navigate('/manage') }}
              className="w-full min-h-[44px] text-left px-3 py-2 font-body text-body-sm text-ink-primary dark:text-night-text hover:bg-primary-50 dark:hover:bg-night-raised focus-visible:bg-primary-50 dark:focus-visible:bg-night-raised"
            >
              {t('auth.manage')}
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={async () => { await signOut(); setOpen(false) }}
            className="w-full min-h-[44px] text-left px-3 py-2 font-body text-body-sm text-ink-secondary dark:text-night-muted hover:bg-primary-50 dark:hover:bg-night-raised focus-visible:bg-primary-50 dark:focus-visible:bg-night-raised"
          >
            {t('auth.signOut')}
          </button>
        </div>
      )}
    </div>
  )
}
