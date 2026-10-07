/**
 * Module-level article store backed by localStorage.
 * Both the public API layer and admin pages read from here.
 * When the real API ships, replace mutations with fetch calls
 * and drop localStorage entirely.
 */

import type { UserProfile } from '@/store/authStore'
import { ARTICLES as SEED, type SeedArticle } from '../data/articles'
import type { ArticleStatus } from '../types'
import { createNotification } from './notificationStore'

// Who suggested an article (a subset of the signed-in profile).
export type Contributor = Pick<UserProfile, 'id' | 'name' | 'email'>

export interface StoredArticle extends SeedArticle {
  status: ArticleStatus
  suggestedBy?: Contributor | null
  // Changes staff proposed on a suggestion, awaiting the contributor.
  staffEdits?: ArticleEdits | null
}

// The editable fields of an article.
export type ArticleEdits = Partial<Omit<StoredArticle, 'id' | 'status' | 'suggestedBy' | 'staffEdits'>>

// What the forms hand to create/submit.
export type ArticleDraft = Omit<StoredArticle, 'id' | 'status'> & { status?: ArticleStatus }

const KEY = 'itbanews_articles_v1'

function load(): StoredArticle[] {
  try {
    const raw = localStorage.getItem(KEY)
    // Cast: the key is only ever written by persist() below.
    return raw ? (JSON.parse(raw) as StoredArticle[]) : seedWithDefaults()
  } catch {
    return seedWithDefaults()
  }
}

function seedWithDefaults(): StoredArticle[] {
  return SEED.map((a) => ({ status: 'published', ...a }))
}

function persist(articles: StoredArticle[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(articles)) } catch { /* storage unavailable (private mode, quota): keep the in-memory state */ }
}

let _articles = load()

export function getArticles(): StoredArticle[] {
  return _articles
}

export function getArticleById(id: string): StoredArticle | null {
  return _articles.find((a) => a.id === id) ?? null
}

export function createArticle(data: ArticleDraft): StoredArticle {
  // Unfeature others if this one is featured
  if (data.featured) {
    _articles = _articles.map((a) => ({ ...a, featured: false }))
  }
  const article: StoredArticle = {
    ...data,
    id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    status: data.status ?? 'published',
  }
  _articles = [article, ..._articles]
  persist(_articles)
  return article
}

export function updateArticle(id: string, data: Partial<Omit<StoredArticle, 'id'>>): void {
  if (data.featured) {
    _articles = _articles.map((a) => ({ ...a, featured: a.id === id ? true : false }))
  }
  _articles = _articles.map((a) => (a.id === id ? { ...a, ...data } : a))
  persist(_articles)
}

export function deleteArticle(id: string): void {
  _articles = _articles.filter((a) => a.id !== id)
  persist(_articles)
}

export function resetArticles(): void {
  _articles = seedWithDefaults()
  localStorage.removeItem(KEY)
}

// ── Suggestion lifecycle ──────────────────────────────────────────────────────

export function submitArticleSuggestion(data: ArticleDraft, contributor: Contributor): StoredArticle {
  const article: StoredArticle = {
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

export function resubmitArticleSuggestion(id: string, data: ArticleEdits): void {
  _articles = _articles.map((a) =>
    a.id === id ? { ...a, ...data, status: 'pending_review', staffEdits: null } : a,
  )
  persist(_articles)
}

export function getArticleSuggestions(): StoredArticle[] {
  return _articles.filter((a) => a.suggestedBy != null && a.status !== 'published')
}

export function getPendingArticleSuggestionsCount(): number {
  return _articles.filter(
    (a) => a.suggestedBy != null && (a.status === 'pending_review' || a.status === 'changes_requested'),
  ).length
}

export function approveArticleSuggestion(id: string): void {
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

export function rejectArticleSuggestion(id: string): void {
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

export function requestArticleChanges(id: string, staffEdits: ArticleEdits): void {
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

export function acceptArticleChanges(id: string): void {
  const article = _articles.find((a) => a.id === id)
  if (!article?.staffEdits) return
  _articles = _articles.map((a) =>
    a.id === id ? { ...a, ...a.staffEdits, staffEdits: null, status: 'published' } : a,
  )
  persist(_articles)
}

export function rejectArticleChanges(id: string): void {
  _articles = _articles.map((a) =>
    a.id === id ? { ...a, staffEdits: null, status: 'pending_review' } : a,
  )
  persist(_articles)
}
