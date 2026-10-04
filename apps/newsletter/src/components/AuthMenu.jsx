import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { canAccessAdmin, canManageOrganizations, signOut, startGoogleSignIn } from '../store/authStore'
import { useAuthSession } from '../hooks/useAuthSession'
import { CONTRIBUTIONS_ENABLED } from '../config/features'
import { fetchDigestSubscription, setDigestSubscription } from '../api/digests'

// Same shape as CeitbaPage's AuthMenu — sign-in button when anonymous,
// avatar dropdown when signed in. The previous "Contribuir" CTA moves into
// the dropdown; admins see "Panel admin" instead of "Contribuir" plus the
// Manage hub on ceitba.org.ar.
export default function AuthMenu({ mobile = false }) {
  const { profile, loading } = useAuthSession()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useTranslation()

  useEffect(() => {
    if (!open) return
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (loading) return <div className="w-9 h-9" aria-hidden="true" />

  const signInBtnClass = mobile
    ? 'inline-flex items-center gap-2 min-h-[44px] px-5 bg-primary text-surface font-body font-semibold rounded-sm hover:bg-primary-600'
    : 'min-h-[36px] px-4 inline-flex items-center font-body text-body-sm font-semibold bg-primary text-surface rounded-sm hover:bg-primary-600 transition-colors duration-150'

  if (!profile) {
    return (
      <button
        type="button"
        onClick={() => startGoogleSignIn({ returnTo: location.pathname + location.search })}
        className={signInBtnClass}
      >
        {t('auth.signIn')}
      </button>
    )
  }

  const isAdmin = canAccessAdmin(profile)
  const initials = (profile.name ?? profile.email)
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('auth.accountMenu')}
        className="w-9 h-9 rounded-full overflow-hidden border border-border dark:border-[#3f3f46] bg-primary-100 dark:bg-primary-900 flex items-center justify-center hover:border-primary transition-colors duration-150"
      >
        {profile.avatarUrl ? (
          <img src={profile.avatarUrl} alt={profile.name ?? profile.email} className="w-full h-full object-cover" />
        ) : (
          <span className="font-display font-bold text-label text-primary">{initials}</span>
        )}
      </button>

      {open && (
        <div role="menu" className="absolute right-0 top-full mt-2 w-56 bg-white dark:bg-[#27272a] border border-border dark:border-[#3f3f46] rounded-card shadow-card-hover py-1 z-50">
          <div className="px-3 py-2 border-b border-border dark:border-[#3f3f46]">
            <p className="font-body text-body-sm font-semibold text-ink-primary dark:text-[#f4f4f5] truncate">
              {profile.name ?? profile.email}
            </p>
            <p className="font-mono text-label text-ink-secondary dark:text-[#a1a1aa] truncate">
              {profile.email}
            </p>
          </div>
          {/* CeitbaPage owns the canonical /profile route — deep link from here. */}
          <a
            href="https://ceitba.org.ar/profile"
            role="menuitem"
            className="block px-3 py-2 font-body text-body-sm text-ink-primary dark:text-[#f4f4f5] hover:bg-primary-50 dark:hover:bg-primary-900"
          >
            {t('auth.myProfile')}
          </a>
          <DigestToggle />
          {isAdmin ? (
            <Link
              to="/admin/articles"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block px-3 py-2 font-body text-body-sm text-ink-primary dark:text-[#f4f4f5] hover:bg-primary-50 dark:hover:bg-primary-900"
            >
              {canManageOrganizations(profile) ? t('auth.adminPanel') : t('auth.myArticles')}
            </Link>
          ) : CONTRIBUTIONS_ENABLED && (
            <button
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); navigate('/contribute') }}
              className="w-full text-left px-3 py-2 font-body text-body-sm text-ink-primary dark:text-[#f4f4f5] hover:bg-primary-50 dark:hover:bg-primary-900"
            >
              {t('auth.contribute')}
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={async () => { await signOut(); setOpen(false) }}
            className="w-full text-left px-3 py-2 font-body text-body-sm text-ink-secondary dark:text-[#a1a1aa] hover:bg-primary-50 dark:hover:bg-primary-900"
          >
            {t('auth.signOut')}
          </button>
        </div>
      )}
    </div>
  )
}

// "Recibir 'La semana en ITBA' por mail" — loaded when the menu opens,
// toggled optimistically and rolled back if the PUT fails.
function DigestToggle() {
  const { t } = useTranslation()
  const [enabled, setEnabled] = useState(null) // null until loaded
  const [state, setState] = useState('loading') // 'loading' | 'ready' | 'saving' | 'loadError'
  const [error, setError] = useState(false)

  useEffect(() => {
    let active = true
    fetchDigestSubscription()
      .then(({ enabled: value }) => { if (active) { setEnabled(Boolean(value)); setState('ready') } })
      .catch(() => { if (active) setState('loadError') })
    return () => { active = false }
  }, [])

  async function toggle() {
    if (state !== 'ready') return
    const previous = enabled
    setEnabled(!previous)
    setError(false)
    setState('saving')
    try {
      const res = await setDigestSubscription(!previous)
      setEnabled(Boolean(res?.enabled ?? !previous))
    } catch {
      setEnabled(previous)
      setError(true)
    } finally {
      setState('ready')
    }
  }

  if (state === 'loadError') return null

  const on = Boolean(enabled)
  return (
    <div className="px-3 py-2 border-b border-border dark:border-[#3f3f46]">
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={on}
        onClick={toggle}
        disabled={state !== 'ready'}
        className="w-full flex items-center justify-between gap-3 text-left font-body text-body-sm text-ink-primary dark:text-[#f4f4f5] disabled:cursor-wait"
      >
        <span className="leading-snug">{t('digest.toggle')}</span>
        <span
          aria-hidden="true"
          className={[
            'relative inline-flex flex-shrink-0 w-9 h-5 rounded-full transition-colors duration-150',
            on ? 'bg-primary dark:bg-primary-400' : 'bg-border dark:bg-[#3f3f46]',
            enabled === null ? 'opacity-50' : '',
          ].join(' ')}
        >
          <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-[#fff] shadow transition-transform duration-150 ${on ? 'translate-x-4' : ''}`} />
        </span>
      </button>
      {error && (
        <p role="alert" className="mt-1 font-body text-label text-red-600">{t('digest.toggleError')}</p>
      )}
    </div>
  )
}
