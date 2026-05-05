import { useEffect, useState, type ReactElement } from 'react'
import { Navigate } from 'react-router-dom'
import { getSession } from '../store/authStore'

// Cookie auth is HttpOnly so we can't tell synchronously whether the visitor
// is staff. Always go through /me and gate on profile.role === 'staff'.
type Status = 'pending' | 'allowed' | 'anonymous' | 'denied'

export default function StaffGuard({ children }: { children: ReactElement }) {
  const [status, setStatus] = useState<Status>('pending')

  useEffect(() => {
    let active = true
    getSession().then((profile) => {
      if (!active) return
      if (!profile) setStatus('anonymous')
      else if (profile.role === 'staff') setStatus('allowed')
      else setStatus('denied')
    })
    return () => { active = false }
  }, [])

  if (status === 'pending') return null
  if (status === 'anonymous' || status === 'denied') return <Navigate to="/" replace />
  return children
}
