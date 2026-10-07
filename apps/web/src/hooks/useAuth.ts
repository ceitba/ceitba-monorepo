import { useEffect, useState } from 'react'
import { getCachedSession, getSession, subscribe, type UserProfile } from '../store/authStore'

// React-binding for the auth store: returns the cached profile and re-renders
// when login/logout fires. `loading` is true during the very first /me call.
export function useAuth() {
  const [profile, setProfile] = useState<UserProfile | null>(getCachedSession())
  const [loading, setLoading] = useState<boolean>(getCachedSession() == null)

  useEffect(() => {
    let active = true
    getSession().then((p) => {
      if (!active) return
      setProfile(p)
      setLoading(false)
    })
    const unsub = subscribe((p) => { if (active) setProfile(p) })
    return () => { active = false; unsub() }
  }, [])

  return {
    profile,
    loading,
    isAuthenticated: profile != null,
    isStaff: profile?.role === 'staff',
  }
}
