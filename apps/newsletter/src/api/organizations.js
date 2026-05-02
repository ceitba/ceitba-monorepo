/**
 * Organizations API
 *
 * Endpoints (future REST contract):
 *
 *   GET  /organizations
 *     Returns: { data: Organization[] }
 *
 *   GET  /organizations/:slug
 *     Returns: Organization
 *     Errors: 404 if not found
 *
 * Organization shape:
 * {
 *   slug:        string
 *   name:        string
 *   fullName:    string
 *   description: string
 *   category:    string
 *   color:       'blue' | 'amber' | 'violet' | 'green'
 *   memberCount: number
 *   foundedYear: number
 * }
 */

import { apiRequest } from './client'
import { ORGANIZATIONS } from '../data/organizations'

/**
 * Fetch all organizations.
 */
export function fetchOrganizations() {
  return apiRequest(() => ({ data: ORGANIZATIONS }))
}

/**
 * Fetch a single organization by slug.
 *
 * @param {string} slug
 */
export function fetchOrganizationBySlug(slug) {
  return apiRequest(() => {
    const org = ORGANIZATIONS.find((o) => o.slug === slug)
    if (!org) throw new Error(`Organization "${slug}" not found`)
    return org
  })
}
