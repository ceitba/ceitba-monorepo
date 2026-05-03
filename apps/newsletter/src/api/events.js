import { apiRequest, ApiError } from './client'

// The API uses eventDate/startTime; internally we use date/time
function normalize(e) {
  if (!e) return e
  return {
    ...e,
    date: e.eventDate ?? e.date,
    time: e.startTime ?? e.time,
  }
}

export async function fetchEvents({ category, organization, from, to, page = 1, limit = 50 } = {}) {
  const params = new URLSearchParams({ page, limit })
  if (category) params.set('category', category)
  if (organization) params.set('organization', organization)
  if (from) params.set('from', from)
  if (to) params.set('to', to)

  const res = await apiRequest('GET', `/news/events?${params}`)
  if (!res || !res.ok) throw new ApiError('Failed to fetch events', res?.status)
  const json = await res.json()
  return { ...json, data: json.data.map(normalize) }
}

export async function fetchEventById(id) {
  const res = await apiRequest('GET', `/news/events/${id}`)
  if (!res) throw new ApiError('Request failed', 0)
  if (res.status === 404) throw new ApiError(`Event "${id}" not found`, 404, 'NOT_FOUND')
  if (!res.ok) throw new ApiError('Failed to fetch event', res.status)
  return normalize(await res.json())
}

export async function createEvent(data) {
  const { date, time, ...rest } = data
  const res = await apiRequest('POST', '/news/events', { ...rest, eventDate: date, startTime: time })
  if (!res || !res.ok) throw new ApiError('Failed to create event', res?.status)
  return normalize(await res.json())
}

export async function updateEvent(id, data) {
  const payload = { ...data }
  if (payload.date) { payload.eventDate = payload.date; delete payload.date }
  if (payload.time) { payload.startTime = payload.time; delete payload.time }
  const res = await apiRequest('PATCH', `/news/events/${id}`, payload)
  if (!res || !res.ok) throw new ApiError('Failed to update event', res?.status)
  return normalize(await res.json())
}

export async function deleteEvent(id) {
  const res = await apiRequest('DELETE', `/news/events/${id}`)
  if (res && !res.ok && res.status !== 204) throw new ApiError('Failed to delete event', res.status)
}
