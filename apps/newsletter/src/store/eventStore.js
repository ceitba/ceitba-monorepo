import { EVENTS as SEED } from '../data/events'
import { createNotification } from './notificationStore'

const KEY = 'itbanews_events_v1'

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : [...SEED]
  } catch {
    return [...SEED]
  }
}

function persist(events) {
  try { localStorage.setItem(KEY, JSON.stringify(events)) } catch {}
}

let _events = load()

export function getEvents() {
  return _events
}

export function getEventById(id) {
  return _events.find((e) => e.id === id) ?? null
}

export function createEvent(data) {
  const event = {
    ...data,
    id: `e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  }
  _events = [event, ..._events]
  persist(_events)
  return event
}

export function updateEvent(id, data) {
  _events = _events.map((e) => (e.id === id ? { ...e, ...data } : e))
  persist(_events)
}

export function deleteEvent(id) {
  _events = _events.filter((e) => e.id !== id)
  persist(_events)
}

export function resetEvents() {
  _events = [...SEED]
  localStorage.removeItem(KEY)
}

// ── Suggestion lifecycle ──────────────────────────────────────────────────────

export function submitEventSuggestion(data, contributor) {
  const event = {
    ...data,
    id: `e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    status: 'pending_review',
    suggestedBy: { id: contributor.id, name: contributor.name, email: contributor.email },
    staffEdits: null,
  }
  _events = [event, ..._events]
  persist(_events)
  return event
}

export function resubmitEventSuggestion(id, data) {
  _events = _events.map((e) =>
    e.id === id ? { ...e, ...data, status: 'pending_review', staffEdits: null } : e,
  )
  persist(_events)
}

export function getEventSuggestions() {
  return _events.filter((e) => e.suggestedBy != null && e.status !== 'published')
}

export function getPendingEventSuggestionsCount() {
  return _events.filter(
    (e) => e.suggestedBy != null && (e.status === 'pending_review' || e.status === 'changes_requested'),
  ).length
}

export function approveEventSuggestion(id) {
  const event = _events.find((e) => e.id === id)
  if (!event?.suggestedBy) return
  _events = _events.map((e) =>
    e.id === id ? { ...e, status: 'published', staffEdits: null } : e,
  )
  persist(_events)
  createNotification({
    for: event.suggestedBy.id,
    type: 'approved',
    resourceType: 'event',
    resourceId: id,
    title: event.title,
    message: `Tu evento "${event.title}" fue aprobado y publicado.`,
  })
}

export function rejectEventSuggestion(id) {
  const event = _events.find((e) => e.id === id)
  if (!event?.suggestedBy) return
  _events = _events.map((e) => (e.id === id ? { ...e, status: 'rejected' } : e))
  persist(_events)
  createNotification({
    for: event.suggestedBy.id,
    type: 'rejected',
    resourceType: 'event',
    resourceId: id,
    title: event.title,
    message: `Tu sugerencia de evento "${event.title}" no fue aceptada.`,
  })
}

export function requestEventChanges(id, staffEdits) {
  const event = _events.find((e) => e.id === id)
  if (!event?.suggestedBy) return
  _events = _events.map((e) =>
    e.id === id ? { ...e, staffEdits, status: 'changes_requested' } : e,
  )
  persist(_events)
  createNotification({
    for: event.suggestedBy.id,
    type: 'changes_requested',
    resourceType: 'event',
    resourceId: id,
    title: event.title,
    message: `El staff propuso cambios en tu evento "${event.title}". Revisalos y aceptá o rechazá.`,
  })
}

export function acceptEventChanges(id) {
  const event = _events.find((e) => e.id === id)
  if (!event?.staffEdits) return
  _events = _events.map((e) =>
    e.id === id ? { ...e, ...e.staffEdits, staffEdits: null, status: 'published' } : e,
  )
  persist(_events)
}

export function rejectEventChanges(id) {
  _events = _events.map((e) =>
    e.id === id ? { ...e, staffEdits: null, status: 'pending_review' } : e,
  )
  persist(_events)
}
