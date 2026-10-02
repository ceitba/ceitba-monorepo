// VITE_API_URL includes the /api/v1 prefix (e.g. https://ceitba.org.ar/api/v1).
export const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8080/api/v1'

export class ApiError extends Error {
  constructor(message, status = 500, code = 'UNKNOWN_ERROR') {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

// All requests carry the HttpOnly session cookie set by /v1/auth/callback.
// We deliberately do NOT touch the Authorization header — that's reserved
// for non-browser clients (curl, scripts) using API keys or Bearer tokens.
//
// On 401 we don't auto-redirect: pages decide whether unauth means "show
// login button" or "send to /admin/login".
export async function apiRequest(method, path, body, init = {}) {
  return fetch(BASE_URL + path, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
    ...init,
  })
}

// Convenience wrappers — return parsed JSON or throw ApiError on non-2xx.
export async function apiGet(path) {
  const res = await send('GET', path)
  if (!res.ok) throw await toError(res)
  return res.json()
}

export async function apiSend(method, path, body) {
  const res = await send(method, path, body)
  if (!res.ok) throw await toError(res)
  // 204 No Content (e.g. DELETE)
  if (res.status === 204) return undefined
  const text = await res.text()
  return text ? JSON.parse(text) : undefined
}

async function send(method, path, body) {
  try {
    return await apiRequest(method, path, body)
  } catch {
    throw new ApiError('Network error', 0, 'NETWORK_ERROR')
  }
}

// Builds an ApiError from the API's `{ code, message }` error body.
export async function toError(res) {
  let body = {}
  try { body = await res.json() } catch { /* non-JSON */ }
  return new ApiError(
    body?.message ?? `Request failed (${res.status})`,
    res.status,
    body?.code ?? 'HTTP_' + res.status,
  )
}
