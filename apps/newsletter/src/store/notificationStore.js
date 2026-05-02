const KEY = 'itbanews_notifications_v1'

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') } catch { return [] }
}

function persist(ns) {
  try { localStorage.setItem(KEY, JSON.stringify(ns)) } catch {}
}

let _notifications = load()

export function createNotification({ for: userId, type, resourceType, resourceId, title, message }) {
  const n = {
    id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    for: userId,
    type,          // 'approved' | 'rejected' | 'changes_requested'
    resourceType,  // 'article' | 'event'
    resourceId,
    title,
    message,
    read: false,
    createdAt: Date.now(),
  }
  _notifications = [n, ..._notifications]
  persist(_notifications)
  return n
}

export function getNotificationsForUser(userId) {
  return _notifications.filter((n) => n.for === userId)
}

export function getUnreadCountForUser(userId) {
  return _notifications.filter((n) => n.for === userId && !n.read).length
}

export function markNotificationRead(id) {
  _notifications = _notifications.map((n) => (n.id === id ? { ...n, read: true } : n))
  persist(_notifications)
}

export function markAllReadForUser(userId) {
  _notifications = _notifications.map((n) => (n.for === userId ? { ...n, read: true } : n))
  persist(_notifications)
}
