const KEY = 'itbanews_notifications_v1'

export type NotificationType = 'approved' | 'rejected' | 'changes_requested'

export interface ContributorNotification {
  id: string
  // User id of the contributor it is for.
  for: string
  type: NotificationType
  resourceType: 'article' | 'event'
  resourceId: string
  title: string
  message: string
  read: boolean
  createdAt: number
}

export type NewNotification = Omit<ContributorNotification, 'id' | 'read' | 'createdAt'>

function load(): ContributorNotification[] {
  // Cast: the key is only ever written by persist() below.
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as ContributorNotification[] } catch { return [] }
}

function persist(ns: ContributorNotification[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(ns)) } catch { /* storage unavailable (private mode, quota): keep the in-memory state */ }
}

let _notifications = load()

export function createNotification(
  { for: userId, type, resourceType, resourceId, title, message }: NewNotification,
): ContributorNotification {
  const n: ContributorNotification = {
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

export function getNotificationsForUser(userId: string): ContributorNotification[] {
  return _notifications.filter((n) => n.for === userId)
}

export function getUnreadCountForUser(userId: string): number {
  return _notifications.filter((n) => n.for === userId && !n.read).length
}

export function markNotificationRead(id: string): void {
  _notifications = _notifications.map((n) => (n.id === id ? { ...n, read: true } : n))
  persist(_notifications)
}

export function markAllReadForUser(userId: string): void {
  _notifications = _notifications.map((n) => (n.for === userId ? { ...n, read: true } : n))
  persist(_notifications)
}
