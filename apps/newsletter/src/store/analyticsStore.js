import { apiRequest } from '../api/client'

const SESSION_KEY  = 'itbanews_session_id'
const FLUSH_MS     = 10_000
const MAX_BATCH    = 50

let _queue = []

function getSessionId() {
  let id = sessionStorage.getItem(SESSION_KEY)
  if (!id) {
    id = Math.random().toString(36).slice(2) + Date.now().toString(36)
    sessionStorage.setItem(SESSION_KEY, id)
  }
  return id
}

export function trackEvent(type, extra = {}) {
  _queue.push({ type, sessionId: getSessionId(), timestamp: Date.now(), ...extra })
}

async function flush() {
  if (_queue.length === 0) return
  const batch = _queue.splice(0, MAX_BATCH)
  try {
    await apiRequest('POST', '/analytics/events', { events: batch })
  } catch {
    // analytics are best-effort — silently drop on failure
  }
}

setInterval(flush, FLUSH_MS)

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })
  window.addEventListener('pagehide', flush)
}
