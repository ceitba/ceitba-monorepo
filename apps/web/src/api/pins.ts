import { apiGet, apiSend } from './client'

// Pinned subjects for /apuntes quick access, on top of the existing subject
// bookmarks endpoints (/v1/wiki/bookmarks). 409 BOOKMARK_LIMIT past 30.

export const PIN_LIMIT = 30

export interface PinnedSubject {
  subjectId: string
  subjectName: string
  fileCount: number
  hasWiki: boolean
  pinnedAt: string
}

export interface BookmarkState {
  count: number
  bookmarked: boolean
}

const enc = encodeURIComponent

export function fetchPins(): Promise<PinnedSubject[]> {
  return apiGet<PinnedSubject[]>('/wiki/bookmarks')
}

export function pinSubject(subjectId: string): Promise<BookmarkState> {
  return apiSend<BookmarkState>('PUT', `/wiki/bookmarks/${enc(subjectId)}`)
}

export function unpinSubject(subjectId: string): Promise<void> {
  return apiSend<void>('DELETE', `/wiki/bookmarks/${enc(subjectId)}`)
}
