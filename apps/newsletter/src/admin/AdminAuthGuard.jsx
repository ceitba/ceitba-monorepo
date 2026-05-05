import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { getSession, isAdmin, isOrgMember } from '../store/authStore'

// Cookie auth: the cookie is HttpOnly so we cannot synchronously know whether
// the user is signed in. Always go through getSession() and decide from the
// returned profile.
export default function AdminAuthGuard({ children }) {
  const location = useLocation()
  const [status, setStatus] = useState('pending')

  useEffect(() => {
    let cancelled = false
    getSession().then((profile) => {
      if (cancelled) return
      if (!profile) setStatus('anonymous')
      else if (isAdmin() || isOrgMember()) setStatus('allowed')
      else setStatus('denied')
    })
    return () => { cancelled = true }
  }, [])

  if (status === 'pending') return null

  if (status === 'anonymous') {
    return (
      <Navigate
        to="/admin/login"
        state={{ from: location.pathname }}
        replace
      />
    )
  }

  if (status === 'denied') {
    return <Navigate to="/" replace />
  }

  return children
}
