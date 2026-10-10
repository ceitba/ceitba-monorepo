import { useEffect, useState } from 'react'
import { getCachedSession, getSession, isHydrated, subscribe, type UserProfile } from '../store/authStore'

// React binding for the auth store: returns the cached profile and re-renders
// on sign-in, sign-out and session patches (e.g. follow refreshes). `loading`
// is true until the first /me call has answered, which it kicks off if nobody
// has yet (cached afterwards).
export function useAuth() {
  const [profile, setProfile] = useState<UserProfile | null>(getCachedSession)
  const [loading, setLoading] = useState<boolean>(() => !isHydrated())

  useEffect(() => {
    let active = true
    const update = (p: UserProfile | null) => {
      if (!active) return
      setProfile(p)
      setLoading(false)
    }
    const unsub = subscribe(update)
    getSession().then(update)
    return () => { active = false; unsub() }
  }, [])

  return {
    profile,
    loading,
    isAuthenticated: profile != null,
    isStaff: profile?.role === 'staff',
  }
}
