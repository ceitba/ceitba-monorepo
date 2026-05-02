/**
 * Events API
 *
 * Endpoints (future REST contract):
 *
 *   GET    /events             query: category?, organization?, from?, to?, page?, limit?
 *   GET    /events/:id
 *   POST   /events             body: EventInput
 *   PATCH  /events/:id         body: Partial<EventInput>
 *   DELETE /events/:id
 *
 * Event shape:
 * {
 *   id:           string
 *   title:        string
 *   date:         string        // ISO 8601 date
 *   time:         string        // HH:MM
 *   endTime:      string        // HH:MM
 *   location:     string
 *   category:     string
 *   organization: string
 *   description:  string
 * }
 */

import { apiRequest } from './client'
import { getEvents, getEventById } from '../store/eventStore'

export function fetchEvents({ category, organization, from, to, page = 1, limit = 50 } = {}) {
  return apiRequest(() => {
    let results = [...getEvents()].sort((a, b) => a.date.localeCompare(b.date))

    if (category)     results = results.filter((e) => e.category === category)
    if (organization) results = results.filter((e) => e.organization === organization)
    if (from)         results = results.filter((e) => e.date >= from)
    if (to)           results = results.filter((e) => e.date <= to)

    const total = results.length
    const start = (page - 1) * limit
    const data  = results.slice(start, start + limit)

    return { data, meta: { total, page, limit } }
  })
}

export function fetchEventById(id) {
  return apiRequest(() => {
    const event = getEventById(id)
    if (!event) throw new Error(`Event "${id}" not found`)
    return event
  })
}
