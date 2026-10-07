import { useEffect, useState } from 'react'
import { getCachedSession, getSession, isHydrated, subscribe } from '../store/authStore'

// React binding for the auth store. Subscribes to store changes so every
// component re-renders on sign-in, sign-out and follow refreshes, and kicks
// off the first /me round-trip if nobody has yet (cached afterwards).
export function useAuthSession() {
  const [profile, setProfile] = useState(getCachedSession)
  const [loading, setLoading] = useState(() => !isHydrated())

  useEffect(() => {
    let active = true
    const update = (p) => {
      if (!active) return
      setProfile(p)
      setLoading(false)
    }
    const unsubscribe = subscribe(update)
    getSession().then(update)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  return { profile, loading }
}
