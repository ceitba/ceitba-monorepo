import type { ReactElement } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

// Cookie auth is HttpOnly so we can't tell synchronously whether the visitor
// is staff: wait for /me, then gate on profile.role === 'staff'. useAuth
// subscribes to the auth store, so signing out (or losing STAFF and
// refreshing the session) while on /manage redirects immediately instead of
// leaving an admin UI whose every action 401s.
export default function StaffGuard({ children }: { children: ReactElement }) {
  const { loading, isStaff } = useAuth()
  if (loading) return null
  if (!isStaff) return <Navigate to="/" replace />
  return children
}
