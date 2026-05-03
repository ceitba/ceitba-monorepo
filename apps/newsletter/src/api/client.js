export const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8080/v1'

export class ApiError extends Error {
  constructor(message, status = 500, code = 'UNKNOWN_ERROR') {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export async function apiRequest(method, path, body) {
  const token = sessionStorage.getItem('auth_token')
  const res = await fetch(BASE_URL + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401) {
    sessionStorage.removeItem('auth_token')
    window.location.replace('/admin/login')
    return null
  }
  return res
}
