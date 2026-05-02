/**
 * Client-side analytics store.
 *
 * Queues events in localStorage. When the real analytics API ships,
 * replace `flush()` with a POST /analytics/events batch call.
 *
 * Event shape:
 * {
 *   type:       'article_view' | 'vote' | 'page_view' | 'category_filter'
 *   sessionId:  string
 *   timestamp:  number   (Unix ms)
 *   articleId?: string
 *   path?:      string
 *   category?:  string
 *   voteType?:  'up' | 'down'
 * }
 */

const EVENTS_KEY  = 'itbanews_analytics_v1'
const SESSION_KEY = 'itbanews_session_id'
const MAX_EVENTS  = 2000   // cap to avoid unbounded localStorage growth

function getSessionId() {
  let id = sessionStorage.getItem(SESSION_KEY)
  if (!id) {
    id = Math.random().toString(36).slice(2) + Date.now().toString(36)
    sessionStorage.setItem(SESSION_KEY, id)
  }
  return id
}

function loadEvents() {
  try {
    const raw = localStorage.getItem(EVENTS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveEvents(events) {
  try {
    localStorage.setItem(EVENTS_KEY, JSON.stringify(events.slice(-MAX_EVENTS)))
  } catch {}
}

export function trackEvent(type, extra = {}) {
  const events = loadEvents()
  events.push({ type, sessionId: getSessionId(), timestamp: Date.now(), ...extra })
  saveEvents(events)
}

export function getEvents() {
  return loadEvents()
}

// ── Aggregation helpers (used by AdminAnalyticsPage) ──────────────────────

function filterByDays(events, days) {
  if (!days) return events
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  return events.filter((e) => e.timestamp >= cutoff)
}

export function getArticleViews(days) {
  const events = filterByDays(getEvents(), days)
  const counts = {}
  for (const e of events) {
    if (e.type === 'article_view' && e.articleId) {
      counts[e.articleId] = (counts[e.articleId] ?? 0) + 1
    }
  }
  return counts   // { articleId: viewCount }
}

export function getPageViews(days) {
  return filterByDays(getEvents(), days).filter((e) => e.type === 'page_view').length
}

export function getCategoryViews(days) {
  const events = filterByDays(getEvents(), days)
  const counts = {}
  for (const e of events) {
    if (e.type === 'article_view' && e.category) {
      counts[e.category] = (counts[e.category] ?? 0) + 1
    }
  }
  return counts   // { category: viewCount }
}

export function getUniqueVisitors(days) {
  const events = filterByDays(getEvents(), days)
  return new Set(events.map((e) => e.sessionId)).size
}

export function getDailyViews(days = 30) {
  const events = filterByDays(getEvents(), days).filter((e) => e.type === 'article_view')
  const counts = {}
  for (const e of events) {
    const day = new Date(e.timestamp).toISOString().slice(0, 10)
    counts[day] = (counts[day] ?? 0) + 1
  }
  return counts   // { 'YYYY-MM-DD': count }
}
