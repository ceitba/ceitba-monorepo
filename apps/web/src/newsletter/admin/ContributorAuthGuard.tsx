import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { getSession } from '@/store/authStore'
import { newsletterPath } from '@/newsletter/paths'

// Cookie auth: must await /me before deciding — we cannot read the HttpOnly
// cookie synchronously. Renders nothing while pending so we don't flash an
// authed page only to bounce.
interface ContributorAuthGuardProps {
  children: ReactNode
}

export default function ContributorAuthGuard({ children }: ContributorAuthGuardProps) {
  const location = useLocation()
  const [status, setStatus] = useState<'pending' | 'anonymous' | 'allowed'>('pending')

  useEffect(() => {
    let cancelled = false
    getSession().then((profile) => {
      if (cancelled) return
      setStatus(profile ? 'allowed' : 'anonymous')
    })
    return () => { cancelled = true }
  }, [])

  if (status === 'pending') return null

  if (status === 'anonymous') {
    return <Navigate to={newsletterPath('/')} state={{ from: location.pathname }} replace />
  }

  return children
}
