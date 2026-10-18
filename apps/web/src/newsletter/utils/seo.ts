import { bodyToMarkdown, markdownToPlainText } from './articleBody'
import type { Article } from '../types'

const MAX_DESCRIPTION = 200

// Collapses whitespace and cuts at ~200 chars with an ellipsis, the length
// search engines show. Mirrors the API's ArticleLinkPreviewService.
export function truncateDescription(text: string | null | undefined, max = MAX_DESCRIPTION): string {
  const plain = (text ?? '').replace(/\s+/g, ' ').trim()
  return plain.length <= max ? plain : plain.slice(0, max - 1).trim() + '…'
}

// <meta name="description"> of an article: the excerpt, else its first
// non-empty body paragraph without the Markdown.
export function articleDescription(article: Pick<Article, 'excerpt' | 'body'>): string {
  if (article.excerpt?.trim()) return truncateDescription(article.excerpt)
  // The editor saves one Markdown document as a single element, so split on blank lines too.
  for (const paragraph of bodyToMarkdown(article.body).split(/\n\s*\n/)) {
    const plain = markdownToPlainText(paragraph)
    if (plain) return truncateDescription(plain)
  }
  return ''
}

// <meta name="description"> of an event: its description as plain text.
export function eventDescription(description: string | null | undefined): string {
  return truncateDescription(markdownToPlainText(description))
}
