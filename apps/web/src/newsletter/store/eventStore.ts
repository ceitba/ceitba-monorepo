import type { UserProfile } from '@/store/authStore'
import { EVENTS as SEED, type SeedEvent } from '../data/events'
import type { ArticleStatus } from '../types'
import { createNotification } from './notificationStore'

// Who suggested an event (a subset of the signed-in profile).
export type Contributor = Pick<UserProfile, 'id' | 'name' | 'email'>

// Seed events carry no status; suggestions do (same lifecycle as articles).
export interface StoredEvent extends SeedEvent {
  status?: ArticleStatus
  suggestedBy?: Contributor | null
  // Changes staff proposed on a suggestion, awaiting the contributor.
  staffEdits?: EventEdits | null
}

// The editable fields of an event.
export type EventEdits = Partial<Omit<StoredEvent, 'id' | 'status' | 'suggestedBy' | 'staffEdits'>>

// What the forms hand to create/submit.
export type EventDraft = Omit<StoredEvent, 'id' | 'status'> & { status?: ArticleStatus }

const KEY = 'itbanews_events_v1'

function load(): StoredEvent[] {
  try {
    const raw = localStorage.getItem(KEY)
    // Cast: the key is only ever written by persist() below.
    return raw ? (JSON.parse(raw) as StoredEvent[]) : [...SEED]
  } catch {
    return [...SEED]
  }
}

function persist(events: StoredEvent[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(events)) } catch { /* storage unavailable (private mode, quota): keep the in-memory state */ }
}

let _events: StoredEvent[] = load()

export function getEvents(): StoredEvent[] {
  return _events
}

export function getEventById(id: string): StoredEvent | null {
  return _events.find((e) => e.id === id) ?? null
}

export function createEvent(data: EventDraft): StoredEvent {
  const event: StoredEvent = {
    ...data,
    id: `e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  }
  _events = [event, ..._events]
  persist(_events)
  return event
}

export function updateEvent(id: string, data: Partial<Omit<StoredEvent, 'id'>>): void {
  _events = _events.map((e) => (e.id === id ? { ...e, ...data } : e))
  persist(_events)
}

export function deleteEvent(id: string): void {
  _events = _events.filter((e) => e.id !== id)
  persist(_events)
}

export function resetEvents(): void {
  _events = [...SEED]
  localStorage.removeItem(KEY)
}

// ── Suggestion lifecycle ──────────────────────────────────────────────────────

export function submitEventSuggestion(data: EventDraft, contributor: Contributor): StoredEvent {
  const event: StoredEvent = {
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

export function resubmitEventSuggestion(id: string, data: EventEdits): void {
  _events = _events.map((e) =>
    e.id === id ? { ...e, ...data, status: 'pending_review', staffEdits: null } : e,
  )
  persist(_events)
}

export function getEventSuggestions(): StoredEvent[] {
  return _events.filter((e) => e.suggestedBy != null && e.status !== 'published')
}

export function getPendingEventSuggestionsCount(): number {
  return _events.filter(
    (e) => e.suggestedBy != null && (e.status === 'pending_review' || e.status === 'changes_requested'),
  ).length
}

export function approveEventSuggestion(id: string): void {
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

export function rejectEventSuggestion(id: string): void {
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

export function requestEventChanges(id: string, staffEdits: EventEdits): void {
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

export function acceptEventChanges(id: string): void {
  const event = _events.find((e) => e.id === id)
  if (!event?.staffEdits) return
  _events = _events.map((e) =>
    e.id === id ? { ...e, ...e.staffEdits, staffEdits: null, status: 'published' } : e,
  )
  persist(_events)
}

export function rejectEventChanges(id: string): void {
  _events = _events.map((e) =>
    e.id === id ? { ...e, staffEdits: null, status: 'pending_review' } : e,
  )
  persist(_events)
}
