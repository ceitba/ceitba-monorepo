import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { signOut, startGoogleSignIn } from '../store/authStore'
import { useAuthSession } from '../hooks/useAuthSession'

const ADMIN_ROLES = ['staff', 'admin', 'editor']

// Same shape as CeitbaPage's AuthMenu — sign-in button when anonymous,
// avatar dropdown when signed in. The previous "Contribuir" CTA moves into
// the dropdown; admins see "Panel admin" instead of "Contribuir" plus the
// Manage hub on ceitba.org.ar.
export default function AuthMenu({ mobile = false }) {
  const { profile, loading } = useAuthSession()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const navigate = useNavigate()

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
      <button type="button" onClick={startGoogleSignIn} className={signInBtnClass}>
        Iniciar sesión
      </button>
    )
  }

  const isAdmin = ADMIN_ROLES.includes(profile.role)
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
            className="block px-3 py-2 font-body text-body-sm text-ink-primary dark:text-[#f4f4f5] hover:bg-primary-50 dark:hover:bg-primary-900"
          >
            Mi perfil
          </a>
          {isAdmin ? (
            <Link
              to="/admin/articles"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block px-3 py-2 font-body text-body-sm text-ink-primary dark:text-[#f4f4f5] hover:bg-primary-50 dark:hover:bg-primary-900"
            >
              Panel admin
            </Link>
          ) : (
            <button
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); navigate('/contribute') }}
              className="w-full text-left px-3 py-2 font-body text-body-sm text-ink-primary dark:text-[#f4f4f5] hover:bg-primary-50 dark:hover:bg-primary-900"
            >
              Contribuir
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={async () => { await signOut(); setOpen(false) }}
            className="w-full text-left px-3 py-2 font-body text-body-sm text-ink-secondary dark:text-[#a1a1aa] hover:bg-primary-50 dark:hover:bg-primary-900"
          >
            Cerrar sesión
          </button>
        </div>
      )}
    </div>
  )
}
