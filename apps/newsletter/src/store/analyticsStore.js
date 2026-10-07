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

// `keepalive` lets the request outlive the page when flushing on
// pagehide/visibilitychange (a plain fetch is cancelled on unload). We use
// it instead of navigator.sendBeacon so the body stays application/json
// (what the API's @RequestBody expects) and the request goes through the
// same credentials: 'include' client. keepalive bodies are capped at 64 KB,
// far above a 50-event batch.
// All batches are dispatched synchronously so none is lost when the page
// goes away mid-flush.
function flush({ keepalive = false } = {}) {
  const sends = []
  while (_queue.length > 0) {
    const batch = _queue.splice(0, MAX_BATCH)
    sends.push(
      apiRequest('POST', '/analytics/events', { events: batch }, keepalive ? { keepalive: true } : {})
        .catch(() => { /* analytics are best-effort — silently drop on failure */ }),
    )
  }
  return Promise.all(sends)
}

const flushOnExit = () => flush({ keepalive: true })

setInterval(() => flush(), FLUSH_MS)

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushOnExit()
  })
  window.addEventListener('pagehide', flushOnExit)
}
