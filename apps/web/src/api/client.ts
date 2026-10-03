export const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8080/api/v1'

export class ApiError extends Error {
  status: number
  code: string
  constructor(message: string, status = 500, code = 'UNKNOWN_ERROR') {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

// Cookie auth: every request carries the HttpOnly session cookie set by
// /v1/auth/callback. We never read or write a token from JS.
export async function apiRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  return fetch(BASE_URL + path, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
  })
}

// Convenience wrappers — return parsed JSON or throw ApiError on non-2xx.
export async function apiGet<T>(path: string): Promise<T> {
  const res = await apiRequest('GET', path)
  if (!res.ok) throw await toError(res)
  return res.json() as Promise<T>
}

export async function apiSend<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await apiRequest(method, path, body)
  if (!res.ok) throw await toError(res)
  // 204 No Content, or a 202 Accepted with an empty body
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

async function toError(res: Response): Promise<ApiError> {
  let body: { error?: string; code?: string; message?: string } = {}
  try { body = await res.json() } catch { /* non-JSON */ }
  return new ApiError(
    body.message ?? `Request failed (${res.status})`,
    res.status,
    body.error ?? body.code ?? 'HTTP_' + res.status,
  )
}
