import { useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { startGoogleSignIn } from '@/store/authStore'

// A sign-in that comes back to the current page. Pages with unsaved state
// snapshot it through onBeforeSignIn (see CareerPage), so this works the
// same from any button, the navbar's included.
export function useBeginSignIn(): () => void {
  const location = useLocation()
  return useCallback(
    () => startGoogleSignIn(location.pathname + location.search),
    [location.pathname, location.search],
  )
}
