/**
 * Base API client.
 *
 * All service functions resolve through `apiRequest`. In production, replace
 * the mock resolver with a real fetch call to BASE_URL.
 *
 * Expected API base: https://api.itbanews.ar/v1
 *
 * Standard error shape:
 *   { code: string, message: string, status: number }
 *
 * Standard list response shape:
 *   { data: T[], meta: { total: number, page: number, limit: number } }
 */

const SIMULATED_DELAY_MS = 600

export class ApiError extends Error {
  constructor(message, status = 500, code = 'UNKNOWN_ERROR') {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

/**
 * Wraps a mock resolver so it behaves like a real async HTTP call.
 * Swap `resolver()` with `fetch(BASE_URL + path, options)` when the API is live.
 *
 * @template T
 * @param {() => T} resolver - function that returns the mock response data
 * @returns {Promise<T>}
 */
export async function apiRequest(resolver) {
  await new Promise((res) => setTimeout(res, SIMULATED_DELAY_MS))
  return resolver()
}
