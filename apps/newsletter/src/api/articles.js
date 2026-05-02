/**
 * Articles API
 *
 * Endpoints (future REST contract):
 *
 *   GET    /articles          query: category?, organization?, status?, page?, limit?
 *   GET    /articles/:id
 *   POST   /articles          body: ArticleInput
 *   PATCH  /articles/:id      body: Partial<ArticleInput>
 *   DELETE /articles/:id
 *
 * Article shape:
 * {
 *   id:           string
 *   title:        string
 *   excerpt:      string
 *   body:         string[]
 *   category:     string
 *   organization: string
 *   author:       string
 *   date:         string        // ISO 8601 date
 *   readingTime:  string
 *   featured:     boolean
 *   colorScheme:  'blue' | 'amber' | 'green' | 'violet'
 *   status:       'published' | 'draft'
 * }
 */

import { apiRequest, ApiError } from './client'
import { getArticles, getArticleById } from '../store/articleStore'

export function fetchArticles({ category, organization, status, page = 1, limit = 20 } = {}) {
  return apiRequest(() => {
    let results = getArticles()

    // Public-facing callers pass status=undefined → show only published
    if (status === undefined) {
      results = results.filter((a) => (a.status ?? 'published') === 'published')
    } else if (status !== 'all') {
      results = results.filter((a) => (a.status ?? 'published') === status)
    }

    if (category && category !== 'Todos') {
      results = results.filter((a) => a.category === category)
    }
    if (organization) {
      results = results.filter((a) => a.organization === organization)
    }

    const total = results.length
    const start = (page - 1) * limit
    const data  = results.slice(start, start + limit)

    return { data, meta: { total, page, limit } }
  })
}

export function fetchArticleById(id) {
  return apiRequest(() => {
    const article = getArticleById(id)
    if (!article) throw new ApiError(`Article "${id}" not found`, 404, 'NOT_FOUND')
    return article
  })
}
