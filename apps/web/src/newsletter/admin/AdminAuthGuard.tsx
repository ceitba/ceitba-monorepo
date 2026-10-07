import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { canAccessAdmin, getSession } from '../store/authStore'
import { newsletterPath } from '@/newsletter/paths'

// Cookie auth: the cookie is HttpOnly so we cannot synchronously know whether
// the user is signed in. Always go through getSession() and decide from the
// returned profile.
interface AdminAuthGuardProps {
  children: ReactNode
}

export default function AdminAuthGuard({ children }: AdminAuthGuardProps) {
  const location = useLocation()
  const [status, setStatus] = useState<'pending' | 'anonymous' | 'allowed' | 'denied'>('pending')

  useEffect(() => {
    let cancelled = false
    getSession().then((profile) => {
      if (cancelled) return
      if (!profile) setStatus('anonymous')
      else if (canAccessAdmin(profile)) setStatus('allowed')
      else setStatus('denied')
    })
    return () => { cancelled = true }
  }, [])

  if (status === 'pending') return null

  if (status === 'anonymous') {
    return (
      <Navigate
        to={newsletterPath('/admin/login')}
        state={{ from: location.pathname }}
        replace
      />
    )
  }

  if (status === 'denied') {
    return <Navigate to={newsletterPath('/')} replace />
  }

  return children
}
