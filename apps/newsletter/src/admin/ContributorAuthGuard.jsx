import { Navigate, useLocation } from 'react-router-dom'
import { isAuthenticated } from '../store/authStore'

export default function ContributorAuthGuard({ children }) {
  const location = useLocation()

  if (!isAuthenticated()) {
    return <Navigate to="/" state={{ from: location.pathname }} replace />
  }

  return children
}
