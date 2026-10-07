// VITE_API_URL includes the /api/v1 prefix (e.g. https://ceitba.org.ar/api/v1).
export const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8080/api/v1'

export class ApiError extends Error {
  status: number
  code: string
  // The whole error body, for errors that carry extra fields
  // (e.g. 429 MAIL_QUOTA_EXHAUSTED's `resumeAt`).
  data: Record<string, unknown> | null
  constructor(message: string, status = 500, code = 'UNKNOWN_ERROR', data: Record<string, unknown> | null = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.data = data
  }
}

// Cookie auth: every request carries the HttpOnly session cookie set by
// /v1/auth/callback. We never read or write a token from JS. On 401 we don't
// auto-redirect: pages decide whether that means "show a sign-in button".
export async function apiRequest(
  method: string,
  path: string,
  body?: unknown,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(BASE_URL + path, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
    ...init,
  })
}

// Convenience wrappers — return parsed JSON or throw ApiError on non-2xx
// (code NETWORK_ERROR, status 0, when the request never got an answer).
export async function apiGet<T>(path: string): Promise<T> {
  const res = await send('GET', path)
  if (!res.ok) throw await toError(res)
  return res.json() as Promise<T>
}

export async function apiSend<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await send(method, path, body)
  if (!res.ok) throw await toError(res)
  // 204 No Content, or a 202 Accepted with an empty body
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  try {
    return await apiRequest(method, path, body)
  } catch {
    throw new ApiError('Network error', 0, 'NETWORK_ERROR')
  }
}

// A 403 {error: "CAPABILITY_REQUIRED"} means the user lacks a feature
// capability (e.g. "apuntes"). The auth store listens so guarded pages can
// swap to the "not enabled for your account" screen wherever the call came from.
export const CAPABILITY_REQUIRED = 'CAPABILITY_REQUIRED'
const _capabilityListeners = new Set<(capability: string | null) => void>()
export function onCapabilityRequired(fn: (capability: string | null) => void): () => void {
  _capabilityListeners.add(fn)
  return () => { _capabilityListeners.delete(fn) }
}

// Builds an ApiError from the API's `{ error, message }` error body.
export async function toError(res: Response): Promise<ApiError> {
  let body: { error?: string; code?: string; message?: string; capability?: string } | null = null
  try { body = await res.json() } catch { /* non-JSON */ }
  if (res.status === 403 && body?.error === CAPABILITY_REQUIRED) {
    _capabilityListeners.forEach((fn) => fn(body?.capability ?? null))
  }
  return new ApiError(
    body?.message ?? `Request failed (${res.status})`,
    res.status,
    body?.error ?? body?.code ?? 'HTTP_' + res.status,
    body && typeof body === 'object' ? body : null,
  )
}
