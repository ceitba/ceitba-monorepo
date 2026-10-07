import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuthSession } from '../hooks/useAuthSession'
import { canAccessAdmin, startGoogleSignIn } from '../store/authStore'
import { GoogleIcon } from './ContributeModal'
import { useDialogFocus } from '../hooks/useDialogFocus'

// `?write=1` reopens the explanation after the Google round-trip, so someone
// who signed in from it lands back here (or in the editor, if they turn out
// to be a member) instead of on a page that just bounces them.
const WRITE_PARAM = 'write'

// "Escribir en el newsletter" on the home page. Anyone signed in goes
// straight to the editor (independent authors' articles go through staff
// review); signed-out visitors learn how it works and sign in.
export default function WriteForNewsletter() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { profile, loading } = useAuthSession()
  const [params, setParams] = useSearchParams()
  const [open, setOpen] = useState(false)
  const canWrite = canAccessAdmin(profile)

  // StrictMode runs effects twice with the same params; act once.
  const handledRef = useRef(false)

  useEffect(() => {
    if (loading || params.get(WRITE_PARAM) !== '1' || handledRef.current) return
    handledRef.current = true
    const next = new URLSearchParams(params)
    next.delete(WRITE_PARAM)
    setParams(next, { replace: true })
    if (canWrite) navigate('/admin/articles/new')
    else setOpen(true)
  }, [loading, params, setParams, canWrite, navigate])

  // Don't flash the wrong action before the cookie session resolves.
  if (loading) return null

  const buttonClass = 'inline-flex items-center gap-2 min-h-[44px] px-5 flex-shrink-0 bg-primary text-surface font-body text-body-sm font-semibold rounded-sm hover:bg-primary-600 transition-colors duration-150 focus-visible:rounded'

  return (
    <>
      {canWrite ? (
        <Link to="/admin/articles/new" className={buttonClass}>
          <IconPen /> {t('write.cta')}
        </Link>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className={buttonClass}>
          <IconPen /> {t('write.cta')}
        </button>
      )}
      {open && <WriteDialog onClose={() => setOpen(false)} />}
    </>
  )
}

function WriteDialog({ onClose }) {
  const { t } = useTranslation()
  const closeRef = useRef(null)
  useDialogFocus(closeRef, onClose)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-labelledby="write-dialog-title" className="relative w-full max-w-md bg-white rounded-card shadow-card-hover overflow-hidden">
        <div className="relative h-20 bg-primary-900 overflow-hidden" aria-hidden="true">
          <div className="absolute top-[-40%] right-[-10%] w-1/2 h-[180%] rounded-full bg-primary-700/50" />
          <div className="absolute bottom-[-60%] left-[10%] w-1/3 h-full rotate-12 bg-accent/30" />
          <div className="absolute inset-0 flex items-center px-6 text-white"><IconPen size={26} /></div>
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label={t('write.close')}
          className="absolute top-3 right-3 w-9 h-9 flex items-center justify-center rounded-sm text-white/80 hover:text-white hover:bg-white/10"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>

        <div className="p-6 flex flex-col gap-4">
          <h2 id="write-dialog-title" className="font-display text-h4 font-bold text-ink-primary">{t('write.title')}</h2>
          <p className="font-body text-body text-ink-secondary leading-relaxed">{t('write.intro')}</p>
          <p className="font-body text-body-sm text-ink-primary leading-relaxed bg-surface border border-border rounded-sm px-4 py-3">
            {t('write.signedOut')}
          </p>

          <div className="flex flex-col gap-2 pt-1">
            <button
              type="button"
              onClick={() => startGoogleSignIn({ returnTo: `/?${WRITE_PARAM}=1` })}
              className="inline-flex items-center justify-center gap-3 min-h-[44px] px-5 bg-white border border-border rounded-sm shadow-sm hover:shadow-card font-body text-body-sm font-semibold text-ink-primary transition-shadow duration-150"
            >
              <GoogleIcon /> {t('write.signIn')}
            </button>
            <Link to="/organizations" onClick={onClose} className="inline-flex items-center justify-center min-h-[44px] px-5 font-body text-body-sm font-semibold text-primary hover:underline underline-offset-2">
              {t('write.organizations')}
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

function IconPen({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
    </svg>
  )
}
