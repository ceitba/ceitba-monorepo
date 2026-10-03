import { useEffect, useState } from 'react'
import { getJobs, getOpenRequest, getToasts, subscribe } from './jobWatchStore'

// Re-renders on any job-watch change.
export function useJobWatch() {
  const [, setN] = useState(0)
  useEffect(() => subscribe(() => setN((n) => n + 1)), [])
  return { jobs: getJobs(), toasts: getToasts(), openRequest: getOpenRequest() }
}
