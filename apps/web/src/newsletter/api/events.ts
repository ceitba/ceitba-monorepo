import { apiGet, apiSend } from '@/api/client'
import type { IsoDate, IsoTime, NewsEvent, NewsEventInput, NewsEventResponse, Page } from '../types'

export interface EventFilters {
  category?: string
  organization?: string
  // "YYYY-MM-DD" bounds on eventDate.
  from?: IsoDate
  to?: IsoDate
  page?: number
  limit?: number
}

// Tolerates an already-normalized event (`date`/`time` set).
type EventLike = NewsEventResponse & { date?: IsoDate; time?: IsoTime | null }

// The API uses eventDate/startTime; internally we use date/time
function normalize(e: EventLike): NewsEvent {
  if (!e) return e
  return {
    ...e,
    date: e.eventDate ?? e.date,
    time: e.startTime ?? e.time,
  }
}

export async function fetchEvents(
  { category, organization, from, to, page = 1, limit = 50 }: EventFilters = {},
): Promise<Page<NewsEvent>> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (category) params.set('category', category)
  if (organization) params.set('organization', organization)
  if (from) params.set('from', from)
  if (to) params.set('to', to)

  const json = await apiGet<Page<NewsEventResponse>>(`/news/events?${params}`)
  return { ...json, data: json.data.map(normalize) }
}

export async function fetchEventById(id: string): Promise<NewsEvent> {
  return normalize(await apiGet<NewsEventResponse>(`/news/events/${encodeURIComponent(id)}`))
}

export async function createEvent(data: NewsEventInput): Promise<NewsEvent> {
  const { date, time, ...rest } = data
  return normalize(await apiSend<NewsEventResponse>('POST', '/news/events', { ...rest, eventDate: date, startTime: time }))
}

export async function updateEvent(id: string, data: NewsEventInput): Promise<NewsEvent> {
  const payload: NewsEventInput & { eventDate?: IsoDate; startTime?: IsoTime | null } = { ...data }
  if (payload.date) { payload.eventDate = payload.date; delete payload.date }
  if (payload.time) { payload.startTime = payload.time; delete payload.time }
  return normalize(await apiSend<NewsEventResponse>('PATCH', `/news/events/${encodeURIComponent(id)}`, payload))
}

export async function deleteEvent(id: string): Promise<void> {
  await apiSend<void>('DELETE', `/news/events/${encodeURIComponent(id)}`)
}

// Walks every page of a filtered list (the API caps each page at `limit`
// and sorts by eventDate ascending), so callers never silently drop the
// later events.
export async function fetchAllEvents(
  filters: Omit<EventFilters, 'page' | 'limit'> = {},
  { pageSize = 100, maxPages = 50 }: { pageSize?: number; maxPages?: number } = {},
): Promise<NewsEvent[]> {
  const all: NewsEvent[] = []
  for (let page = 1; page <= maxPages; page++) {
    const { data, meta } = await fetchEvents({ ...filters, page, limit: pageSize })
    all.push(...data)
    if (data.length < pageSize || all.length >= (meta?.total ?? 0)) break
  }
  return all
}
