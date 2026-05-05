import { useEffect, useState } from 'react'
import { getCachedSession, getSession } from '../store/authStore'

// React-binding for the auth store. Because authStore caches at module level,
// any component using this hook gets the same cached profile reference and
// re-renders when sign-in/out fires (we re-fetch on mount rather than wiring
// pub/sub — the cost of one extra /me round-trip on first mount is fine and
// the cached path on subsequent mounts is sync).
export function useAuthSession() {
  const [profile, setProfile] = useState(getCachedSession())
  const [loading, setLoading] = useState(getCachedSession() == null)

  useEffect(() => {
    let active = true
    getSession().then((p) => {
      if (!active) return
      setProfile(p)
      setLoading(false)
    })
    return () => { active = false }
  }, [])

  return { profile, loading }
}
