import { apiGet, apiSend } from '@/api/client'
import type { Article, ArticleInput, ArticleResponse, ArticleStatus, IsoDate, Page } from '../types'

export interface ArticleFilters {
  category?: string
  organization?: string
  status?: string
  mine?: boolean
  page?: number
  limit?: number
}

// Tolerates an already-normalized article (`date` set, no publishedAt).
type ArticleLike = ArticleResponse & { date?: IsoDate | null }

function normalize(a: ArticleLike): Article {
  if (!a) return a
  return { ...a, date: a.publishedAt ?? a.date }
}

export async function fetchArticles(
  { category, organization, status, mine, page = 1, limit = 20 }: ArticleFilters = {},
): Promise<Page<Article>> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (category) params.set('category', category)
  if (organization) params.set('organization', organization)
  if (status) params.set('status', status)
  // Only the caller's own articles, any status (independent authors).
  if (mine) params.set('mine', 'true')

  const json = await apiGet<Page<ArticleResponse>>(`/articles?${params}`)
  return { ...json, data: json.data.map(normalize) }
}

export async function fetchArticleById(id: string): Promise<Article> {
  return normalize(await apiGet<ArticleResponse>(`/articles/${encodeURIComponent(id)}`))
}

export async function createArticle(data: ArticleInput): Promise<Article> {
  const { date, ...rest } = data
  return normalize(await apiSend<ArticleResponse>('POST', '/articles', { ...rest, publishedAt: date || null }))
}

// `date: null` (or '', an emptied date input) empties the date: the API reads
// a null field as "unchanged", so that's sent as clearPublishedAt.
// `expectedStatus` makes the write conditional: the API answers 409 if the
// article's status is no longer that one (someone else already moved it).
export async function updateArticle(
  id: string,
  data: ArticleInput,
  { expectedStatus }: { expectedStatus?: ArticleStatus } = {},
): Promise<Article> {
  const payload: ArticleInput & {
    publishedAt?: IsoDate | null
    clearPublishedAt?: boolean
    expectedStatus?: ArticleStatus
  } = { ...data }
  if (payload.date) { payload.publishedAt = payload.date; delete payload.date }
  else if (payload.date === null || payload.date === '') { payload.clearPublishedAt = true; delete payload.date }
  if (expectedStatus) payload.expectedStatus = expectedStatus
  return normalize(await apiSend<ArticleResponse>('PATCH', `/articles/${encodeURIComponent(id)}`, payload))
}

export async function deleteArticle(id: string): Promise<void> {
  await apiSend<void>('DELETE', `/articles/${encodeURIComponent(id)}`)
}

// `?status=all` lists every status. The API honours it (and `draft`) for
// STAFF, and for members of the organization named in `?organization=`;
// anyone else gets published articles whatever they pass. Omitting status
// always means published.
export const ALL_STATUSES = 'all'

// Walks every page of a filtered list — for admin tables, which must not
// silently stop at the first page.
//
// The API pages with OFFSET over `ORDER BY createdAt DESC`, which is not a
// total order: rows sharing a createdAt (bulk imports, same-transaction
// inserts) can shift between page requests and show up twice. Rows are
// keyed by id (first occurrence wins, keeping the API order) so the table
// never renders duplicate React keys or an inflated count. pageSize must
// not exceed the API's MAX_LIMIT (100), or a full page would look short.
export async function fetchAllArticles(
  filters: Omit<ArticleFilters, 'page' | 'limit'> = {},
  { pageSize = 100, maxPages = 50 }: { pageSize?: number; maxPages?: number } = {},
): Promise<Article[]> {
  const byId = new Map<string, Article>()
  for (let page = 1; page <= maxPages; page++) {
    const { data, meta } = await fetchArticles({ ...filters, page, limit: pageSize })
    for (const a of data) if (!byId.has(a.id)) byId.set(a.id, a)
    if (data.length < pageSize || page * pageSize >= (meta?.total ?? 0)) break
  }
  return [...byId.values()]
}
