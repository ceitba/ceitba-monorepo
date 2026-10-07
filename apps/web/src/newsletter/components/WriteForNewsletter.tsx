import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuthSession } from '../hooks/useAuthSession'
import { startGoogleSignIn } from '../store/authStore'
import { Button, Modal, buttonClass } from '@/components/ui'
import GoogleIcon from './GoogleIcon'
import { NEW_ARTICLE_PATH, newsletterPath } from '@/newsletter/paths'

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
  // Anyone signed in writes (from Mis publicaciones).
  const canWrite = profile != null

  // StrictMode runs effects twice with the same params; act once.
  const handledRef = useRef(false)

  useEffect(() => {
    if (loading || params.get(WRITE_PARAM) !== '1' || handledRef.current) return
    handledRef.current = true
    const next = new URLSearchParams(params)
    next.delete(WRITE_PARAM)
    setParams(next, { replace: true })
    if (canWrite) navigate(NEW_ARTICLE_PATH)
    else setOpen(true)
  }, [loading, params, setParams, canWrite, navigate])

  // Don't flash the wrong action before the cookie session resolves.
  if (loading) return null

  return (
    <>
      {canWrite ? (
        <Link to={NEW_ARTICLE_PATH} className={buttonClass({ className: 'flex-shrink-0' })}>
          <IconPen /> {t('write.cta')}
        </Link>
      ) : (
        <Button onClick={() => setOpen(true)} className="flex-shrink-0">
          <IconPen /> {t('write.cta')}
        </Button>
      )}
      {open && <WriteDialog onClose={() => setOpen(false)} />}
    </>
  )
}

interface WriteDialogProps {
  onClose: () => void
}

function WriteDialog({ onClose }: WriteDialogProps) {
  const { t } = useTranslation()
  return (
    <Modal
      title={t('write.title')}
      onClose={onClose}
      footer={
        <>
          <Link to={newsletterPath('/organizations')} onClick={onClose} className={buttonClass({ variant: 'ghost' })}>
            {t('write.organizations')}
          </Link>
          <Button variant="outline" onClick={() => startGoogleSignIn({ returnTo: newsletterPath(`/?${WRITE_PARAM}=1`) })}>
            <GoogleIcon /> {t('write.signIn')}
          </Button>
        </>
      }
    >
      <p className="font-body text-body text-ink-secondary leading-relaxed">{t('write.intro')}</p>
      <p className="font-body text-body-sm text-ink-primary leading-relaxed bg-surface dark:bg-night-bg border border-border dark:border-night-border rounded-sm px-4 py-3">
        {t('write.signedOut')}
      </p>
    </Modal>
  )
}

function IconPen({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
    </svg>
  )
}
