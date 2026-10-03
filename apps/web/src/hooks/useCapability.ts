import { useEffect, useState } from 'react'
import { getCachedSession, getSession, hasCapability, subscribe } from '../store/authStore'

// Whether the signed-in user has a feature capability (from GET /auth/me;
// STAFF has all of them). False while logged out, and false once the API
// answered 403 CAPABILITY_REQUIRED for it. `loading` is true until the first
// /me resolves, so callers can avoid flashing gated UI.
export function useCapability(key: string): { enabled: boolean; loading: boolean } {
  const [enabled, setEnabled] = useState(() => hasCapability(getCachedSession(), key))
  const [loading, setLoading] = useState(() => getCachedSession() == null)

  useEffect(() => {
    let active = true
    getSession().then((p) => {
      if (!active) return
      setEnabled(hasCapability(p, key))
      setLoading(false)
    })
    // The store notifies with the same profile object when a capability is
    // denied, so recompute the boolean instead of storing the profile.
    const unsub = subscribe((p) => { if (active) setEnabled(hasCapability(p, key)) })
    return () => { active = false; unsub() }
  }, [key])

  return { enabled, loading }
}
