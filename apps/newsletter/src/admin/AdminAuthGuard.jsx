import { Navigate, useLocation } from 'react-router-dom'
import { isAuthenticated } from '../store/authStore'

export default function AdminAuthGuard({ children }) {
  const location = useLocation()

  if (!isAuthenticated()) {
    return (
      <Navigate
        to="/admin/login"
        state={{ from: location.pathname }}
        replace
      />
    )
  }

  return children
}
