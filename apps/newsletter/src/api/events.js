import { apiGet, apiSend } from './client'

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

  const json = await apiGet(`/news/events?${params}`)
  return { ...json, data: json.data.map(normalize) }
}

export async function fetchEventById(id) {
  return normalize(await apiGet(`/news/events/${encodeURIComponent(id)}`))
}

export async function createEvent(data) {
  const { date, time, ...rest } = data
  return normalize(await apiSend('POST', '/news/events', { ...rest, eventDate: date, startTime: time }))
}

export async function updateEvent(id, data) {
  const payload = { ...data }
  if (payload.date) { payload.eventDate = payload.date; delete payload.date }
  if (payload.time) { payload.startTime = payload.time; delete payload.time }
  return normalize(await apiSend('PATCH', `/news/events/${encodeURIComponent(id)}`, payload))
}

export async function deleteEvent(id) {
  await apiSend('DELETE', `/news/events/${encodeURIComponent(id)}`)
}

// Walks every page of a filtered list (the API caps each page at `limit`
// and sorts by eventDate ascending), so callers never silently drop the
// later events.
export async function fetchAllEvents(filters = {}, { pageSize = 100, maxPages = 50 } = {}) {
  const all = []
  for (let page = 1; page <= maxPages; page++) {
    const { data, meta } = await fetchEvents({ ...filters, page, limit: pageSize })
    all.push(...data)
    if (data.length < pageSize || all.length >= (meta?.total ?? 0)) break
  }
  return all
}
