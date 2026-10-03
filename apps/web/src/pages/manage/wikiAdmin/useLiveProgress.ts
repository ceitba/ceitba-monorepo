import { useEffect, useRef, useState } from 'react'
import type { Progress } from '../../../api/kbAdmin'
import { isUnavailable } from './useLoad'

// Live progress for a running eval or pipeline run.
// - While `active`, polls GET …/progress every 3 s (30 s when the browser
//   tab is hidden).
// - If that endpoint doesn't exist yet (404), polls the full detail every
//   5 s instead, so the stage, tokens and cost still move.
// - When the job stops being active, refetches the detail once (metrics
//   appear without a reload) and stops.
export function useLiveProgress(opts: {
  active: boolean
  fetchProgress: () => Promise<Progress>
  refreshDetail: () => void
}): { progress: Progress | null; supported: boolean | null; updatedAt: number | null } {
  const { active, fetchProgress, refreshDetail } = opts
  const [progress, setProgress] = useState<Progress | null>(null)
  const [supported, setSupported] = useState<boolean | null>(null)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const fetchRef = useRef(fetchProgress)
  fetchRef.current = fetchProgress
  const refreshRef = useRef(refreshDetail)
  refreshRef.current = refreshDetail
  const wasActive = useRef(active)

  // Final refetch when the job finishes while we're watching.
  useEffect(() => {
    if (wasActive.current && !active) refreshRef.current()
    wasActive.current = active
  }, [active])

  useEffect(() => {
    if (!active) return
    let cancelled = false
    let timer = 0
    let progressSupported = supported !== false

    const tick = async () => {
      if (cancelled) return
      if (progressSupported) {
        try {
          const p = await fetchRef.current()
          if (cancelled) return
          setProgress(p)
          setSupported(true)
          setUpdatedAt(Date.now())
        } catch (e) {
          if (cancelled) return
          if (isUnavailable(e)) { progressSupported = false; setSupported(false) }
        }
        // Keep the detail (status, tokens, cost) fresh at a slower pace too.
      }
      if (!progressSupported) {
        refreshRef.current()
        setUpdatedAt(Date.now())
      }
      schedule()
    }
    const schedule = () => {
      if (cancelled) return
      const hidden = document.visibilityState === 'hidden'
      const ms = hidden ? 30000 : progressSupported ? 3000 : 5000
      timer = window.setTimeout(tick, ms)
    }
    // Detail refresh every ~15 s while the progress endpoint drives the UI,
    // so status changes (RUNNING → SUCCEEDED) are noticed.
    const detailTimer = window.setInterval(() => {
      if (progressSupported && document.visibilityState !== 'hidden') refreshRef.current()
    }, 15000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') { window.clearTimeout(timer); void tick() }
    }
    document.addEventListener('visibilitychange', onVisible)
    void tick()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      window.clearInterval(detailTimer)
      document.removeEventListener('visibilitychange', onVisible)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  return { progress, supported, updatedAt }
}
