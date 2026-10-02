import { apiGet, apiSend } from './client'

function normalize(a) {
  if (!a) return a
  return { ...a, date: a.publishedAt ?? a.date }
}

export async function fetchArticles({ category, organization, status, page = 1, limit = 20 } = {}) {
  const params = new URLSearchParams({ page, limit })
  if (category) params.set('category', category)
  if (organization) params.set('organization', organization)
  if (status) params.set('status', status)

  const json = await apiGet(`/articles?${params}`)
  return { ...json, data: json.data.map(normalize) }
}

export async function fetchArticleById(id) {
  return normalize(await apiGet(`/articles/${encodeURIComponent(id)}`))
}

export async function createArticle(data) {
  const { date, ...rest } = data
  return normalize(await apiSend('POST', '/articles', { ...rest, publishedAt: date }))
}

export async function updateArticle(id, data) {
  const payload = { ...data }
  if (payload.date) { payload.publishedAt = payload.date; delete payload.date }
  return normalize(await apiSend('PATCH', `/articles/${encodeURIComponent(id)}`, payload))
}

export async function deleteArticle(id) {
  await apiSend('DELETE', `/articles/${encodeURIComponent(id)}`)
}

// `?status=all` lists every status. The API honours it (and `draft`) for
// STAFF, and for members of the organization named in `?organization=`;
// anyone else gets published articles whatever they pass. Omitting status
// always means published.
export const ALL_STATUSES = 'all'

// Walks every page of a filtered list — for admin tables, which must not
// silently stop at the first page.
export async function fetchAllArticles(filters = {}, { pageSize = 100, maxPages = 50 } = {}) {
  const all = []
  for (let page = 1; page <= maxPages; page++) {
    const { data, meta } = await fetchArticles({ ...filters, page, limit: pageSize })
    all.push(...data)
    if (data.length < pageSize || all.length >= (meta?.total ?? 0)) break
  }
  return all
}
