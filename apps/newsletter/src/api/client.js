export const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8080/v1'

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
// On 401 we don't auto-redirect any more: pages decide whether unauth means
// "show login button" or "send to /admin/login". Returning the response
// keeps things composable.
export async function apiRequest(method, path, body) {
  const res = await fetch(BASE_URL + path, {
    method,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: body != null ? JSON.stringify(body) : undefined,
  })
  return res
}
