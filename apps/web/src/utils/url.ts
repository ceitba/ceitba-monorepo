import { BASE_URL } from '../api/client'

// Guards for URLs that come from API data (staff photos/LinkedIn, benefit
// images/CTAs, avatars). React does not block `javascript:` / `data:` hrefs,
// so anything rendered into href/src must pass through here first.
// Returns the normalized URL when safe, otherwise null (render no link/image).

export function safeHttpUrl(raw: string | null | undefined): string | null {
  return safeUrl(raw, ['http:', 'https:'])
}

// For links where an email address is a legitimate target (e.g. a benefit CTA).
export function safeLinkUrl(raw: string | null | undefined): string | null {
  return safeUrl(raw, ['http:', 'https:', 'mailto:'])
}

function safeUrl(raw: string | null | undefined, protocols: string[]): string | null {
  const value = raw?.trim()
  if (!value) return null
  let url: URL
  try {
    // No base: relative or scheme-less values are rejected.
    url = new URL(value)
  } catch {
    return null
  }
  return protocols.includes(url.protocol) ? url.href : null
}

// BASE_URL is ".../api/v1" (absolute, or "/api/v1" behind a proxy); its
// parent is where "/v1/…" paths live.
export const API_ROOT = new URL(BASE_URL, window.location.origin).href.replace(/\/v1\/?$/, '')

// Image sources from student content (Doc HTML, wiki markdown). Only our own
// API/asset paths and inline data:image/ are allowed, so a document can't
// load remote images (tracking pixels). Returns the URL to use, or null.
export function trustedImageSrc(raw: string): string | null {
  const src = raw.trim()
  if (/^data:image\//i.test(src)) return src
  if (src.startsWith('/api/')) return new URL(src, API_ROOT).href
  if (src.startsWith('/v1/')) return API_ROOT + src
  if (!/^https?:\/\//i.test(src)) return null
  try {
    const url = new URL(src)
    if (url.href.startsWith(`${API_ROOT}/`)) return url.href
    if (url.origin === window.location.origin && /^\/(api|ceitba-media)\//.test(url.pathname)) return url.href
  } catch { /* invalid URL */ }
  return null
}
