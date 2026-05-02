import { Navigate, useLocation } from 'react-router-dom'
import { isContributorAuthenticated } from '../store/contributorAuthStore'

export default function ContributorAuthGuard({ children }) {
  const location = useLocation()

  if (!isContributorAuthenticated()) {
    return (
      <Navigate
        to="/contribute/login"
        state={{ from: location.pathname }}
        replace
      />
    )
  }

  return children
}
