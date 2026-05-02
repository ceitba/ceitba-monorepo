/**
 * Module-level article store backed by localStorage.
 * Both the public API layer and admin pages read from here.
 * When the real API ships, replace mutations with fetch calls
 * and drop localStorage entirely.
 */

import { ARTICLES as SEED } from '../data/articles'
import { createNotification } from './notificationStore'

const KEY = 'itbanews_articles_v1'

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : seedWithDefaults()
  } catch {
    return seedWithDefaults()
  }
}

function seedWithDefaults() {
  return SEED.map((a) => ({ status: 'published', ...a }))
}

function persist(articles) {
  try { localStorage.setItem(KEY, JSON.stringify(articles)) } catch {}
}

let _articles = load()

export function getArticles() {
  return _articles
}

export function getArticleById(id) {
  return _articles.find((a) => a.id === id) ?? null
}

export function createArticle(data) {
  // Unfeature others if this one is featured
  if (data.featured) {
    _articles = _articles.map((a) => ({ ...a, featured: false }))
  }
  const article = {
    ...data,
    id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    status: data.status ?? 'published',
  }
  _articles = [article, ..._articles]
  persist(_articles)
  return article
}

export function updateArticle(id, data) {
  if (data.featured) {
    _articles = _articles.map((a) => ({ ...a, featured: a.id === id ? true : false }))
  }
  _articles = _articles.map((a) => (a.id === id ? { ...a, ...data } : a))
  persist(_articles)
}

export function deleteArticle(id) {
  _articles = _articles.filter((a) => a.id !== id)
  persist(_articles)
}

export function resetArticles() {
  _articles = seedWithDefaults()
  localStorage.removeItem(KEY)
}

// ── Suggestion lifecycle ──────────────────────────────────────────────────────

export function submitArticleSuggestion(data, contributor) {
  const article = {
    ...data,
    id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    status: 'pending_review',
    suggestedBy: { id: contributor.id, name: contributor.name, email: contributor.email },
    staffEdits: null,
  }
  _articles = [article, ..._articles]
  persist(_articles)
  return article
}

export function resubmitArticleSuggestion(id, data) {
  _articles = _articles.map((a) =>
    a.id === id ? { ...a, ...data, status: 'pending_review', staffEdits: null } : a,
  )
  persist(_articles)
}

export function getArticleSuggestions() {
  return _articles.filter((a) => a.suggestedBy != null && a.status !== 'published')
}

export function getPendingArticleSuggestionsCount() {
  return _articles.filter(
    (a) => a.suggestedBy != null && (a.status === 'pending_review' || a.status === 'changes_requested'),
  ).length
}

export function approveArticleSuggestion(id) {
  const article = _articles.find((a) => a.id === id)
  if (!article?.suggestedBy) return
  _articles = _articles.map((a) =>
    a.id === id ? { ...a, status: 'published', staffEdits: null } : a,
  )
  persist(_articles)
  createNotification({
    for: article.suggestedBy.id,
    type: 'approved',
    resourceType: 'article',
    resourceId: id,
    title: article.title,
    message: `Tu artículo "${article.title}" fue aprobado y publicado.`,
  })
}

export function rejectArticleSuggestion(id) {
  const article = _articles.find((a) => a.id === id)
  if (!article?.suggestedBy) return
  _articles = _articles.map((a) => (a.id === id ? { ...a, status: 'rejected' } : a))
  persist(_articles)
  createNotification({
    for: article.suggestedBy.id,
    type: 'rejected',
    resourceType: 'article',
    resourceId: id,
    title: article.title,
    message: `Tu sugerencia de artículo "${article.title}" no fue aceptada.`,
  })
}

export function requestArticleChanges(id, staffEdits) {
  const article = _articles.find((a) => a.id === id)
  if (!article?.suggestedBy) return
  _articles = _articles.map((a) =>
    a.id === id ? { ...a, staffEdits, status: 'changes_requested' } : a,
  )
  persist(_articles)
  createNotification({
    for: article.suggestedBy.id,
    type: 'changes_requested',
    resourceType: 'article',
    resourceId: id,
    title: article.title,
    message: `El staff propuso cambios en tu artículo "${article.title}". Revisalos y aceptá o rechazá.`,
  })
}

export function acceptArticleChanges(id) {
  const article = _articles.find((a) => a.id === id)
  if (!article?.staffEdits) return
  _articles = _articles.map((a) =>
    a.id === id ? { ...a, ...a.staffEdits, staffEdits: null, status: 'published' } : a,
  )
  persist(_articles)
}

export function rejectArticleChanges(id) {
  _articles = _articles.map((a) =>
    a.id === id ? { ...a, staffEdits: null, status: 'pending_review' } : a,
  )
  persist(_articles)
}
