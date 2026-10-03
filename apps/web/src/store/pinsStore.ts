import { fetchPins, pinSubject, unpinSubject, type PinnedSubject } from '../api/pins'
import { getCachedSession, subscribe as subscribeAuth } from './authStore'

// Module-level store for pinned subjects (same subscribe/notify pattern as
// authStore): every pin toggle on the page reads and updates one list, so
// they stay in sync without refetching. Toggles are optimistic and roll back
// on error; the error goes to the toggle's caller and to `lastError` (for a
// page-level notice).

export interface PinsState {
  pins: PinnedSubject[] | null // null until loaded
  loading: boolean
  failed: boolean
  lastError: unknown
}

let state: PinsState = { pins: null, loading: false, failed: false, lastError: null }
let loadPromise: Promise<void> | null = null
let loadedFor: string | null = null
const listeners = new Set<(s: PinsState) => void>()

function set(next: Partial<PinsState>) {
  state = { ...state, ...next }
  listeners.forEach((fn) => fn(state))
}

export function subscribe(fn: (s: PinsState) => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function getPinsState(): PinsState {
  return state
}

// Another user signing in (or signing out) must not see stale pins.
subscribeAuth((profile) => {
  if ((profile?.id ?? null) !== loadedFor) {
    loadedFor = null
    loadPromise = null
    set({ pins: null, failed: false, lastError: null })
  }
})

export function loadPins(opts: { force?: boolean } = {}): Promise<void> {
  const userId = getCachedSession()?.id ?? null
  if (!opts.force && loadPromise && loadedFor === userId) return loadPromise
  loadedFor = userId
  set({ loading: true, failed: false })
  loadPromise = fetchPins()
    .then((pins) => set({ pins: pins ?? [], loading: false }))
    .catch(() => {
      loadPromise = null
      set({ loading: false, failed: true, pins: state.pins ?? [] })
    })
  return loadPromise
}

export function isPinned(subjectId: string): boolean {
  return !!state.pins?.some((p) => p.subjectId === subjectId)
}

export interface PinInput {
  subjectId: string
  subjectName: string
  fileCount?: number | null
  hasWiki?: boolean | null
}

export async function togglePin(subject: PinInput): Promise<void> {
  const before = state.pins ?? []
  const wasPinned = before.some((p) => p.subjectId === subject.subjectId)
  const optimistic = wasPinned
    ? before.filter((p) => p.subjectId !== subject.subjectId)
    : [
        {
          subjectId: subject.subjectId,
          subjectName: subject.subjectName,
          fileCount: subject.fileCount ?? 0,
          hasWiki: subject.hasWiki ?? false,
          pinnedAt: new Date().toISOString(),
        },
        ...before,
      ]
  set({ pins: optimistic, lastError: null })
  try {
    if (wasPinned) await unpinSubject(subject.subjectId)
    else await pinSubject(subject.subjectId)
  } catch (e) {
    // Roll back only this subject, keeping concurrent toggles of others.
    const current = state.pins ?? []
    const rolledBack = wasPinned
      ? [...current.filter((p) => p.subjectId !== subject.subjectId), ...before.filter((p) => p.subjectId === subject.subjectId)]
      : current.filter((p) => p.subjectId !== subject.subjectId)
    set({ pins: rolledBack, lastError: e })
    throw e
  }
}

export function clearPinError(): void {
  set({ lastError: null })
}
