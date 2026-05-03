import { apiRequest, ApiError } from './client'

function normalize(a) {
  if (!a) return a
  return { ...a, date: a.publishedAt ?? a.date }
}

export async function fetchArticles({ category, organization, status, page = 1, limit = 20 } = {}) {
  const params = new URLSearchParams({ page, limit })
  if (category && category !== 'Todos') params.set('category', category)
  if (organization) params.set('organization', organization)
  if (status) params.set('status', status)

  const res = await apiRequest('GET', `/articles?${params}`)
  if (!res || !res.ok) throw new ApiError('Failed to fetch articles', res?.status)
  const json = await res.json()
  return { ...json, data: json.data.map(normalize) }
}

export async function fetchArticleById(id) {
  const res = await apiRequest('GET', `/articles/${id}`)
  if (!res) throw new ApiError('Request failed', 0)
  if (res.status === 404) throw new ApiError(`Article "${id}" not found`, 404, 'NOT_FOUND')
  if (!res.ok) throw new ApiError('Failed to fetch article', res.status)
  return normalize(await res.json())
}

export async function createArticle(data) {
  const { date, ...rest } = data
  const res = await apiRequest('POST', '/articles', { ...rest, publishedAt: date })
  if (!res || !res.ok) throw new ApiError('Failed to create article', res?.status)
  return normalize(await res.json())
}

export async function updateArticle(id, data) {
  const payload = { ...data }
  if (payload.date) { payload.publishedAt = payload.date; delete payload.date }
  const res = await apiRequest('PATCH', `/articles/${id}`, payload)
  if (!res || !res.ok) throw new ApiError('Failed to update article', res?.status)
  return normalize(await res.json())
}

export async function deleteArticle(id) {
  const res = await apiRequest('DELETE', `/articles/${id}`)
  if (res && !res.ok && res.status !== 204) throw new ApiError('Failed to delete article', res.status)
}
