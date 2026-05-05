import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { getSession } from '../store/authStore'

// Cookie auth: must await /me before deciding — we cannot read the HttpOnly
// cookie synchronously. Renders nothing while pending so we don't flash an
// authed page only to bounce.
export default function ContributorAuthGuard({ children }) {
  const location = useLocation()
  const [status, setStatus] = useState('pending')

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
    return <Navigate to="/" state={{ from: location.pathname }} replace />
  }

  return children
}
