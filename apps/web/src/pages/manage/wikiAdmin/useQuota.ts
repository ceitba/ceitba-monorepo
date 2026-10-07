import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchQuota, type KbQuota } from '../../../api/kbAdmin'
import { isUnavailable } from './useLoad'
import { QUOTA_POLL_MS } from './quota'

// Polls the DigitalOcean quota every 60 s, only while the page is visible
// (and refetches when it becomes visible again). `unavailable` = the API
// doesn't have the endpoint (404): stops polling and the card hides.
export function useQuota() {
  const [data, setData] = useState<KbQuota | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const alive = useRef(true)
  const stopped = useRef(false)

  const load = useCallback(async (refresh = false) => {
    if (stopped.current) return
    if (refresh) setRefreshing(true)
    try {
      const q = await fetchQuota(refresh)
      if (alive.current) setData(q)
    } catch (e) {
      if (isUnavailable(e)) { stopped.current = true; if (alive.current) setUnavailable(true) }
      // Other errors: keep the last reading; the next poll retries.
    } finally {
      if (refresh && alive.current) setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    alive.current = true
    stopped.current = false
    const visible = () => document.visibilityState === 'visible'
    if (visible()) void load()
    const id = window.setInterval(() => { if (visible()) void load() }, QUOTA_POLL_MS)
    const onVis = () => { if (visible()) void load() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      alive.current = false
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [load])

  return { data, unavailable, refreshing, refresh: () => load(true) }
}
