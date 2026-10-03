import DOMPurify, { type Config } from 'dompurify'

// Sanitising for HTML rendered from untrusted student files (Doc exports,
// docx-preview output, SheetJS tables). DOMPurify strips scripts, event
// handlers and javascript: URLs; the post-pass below also drops data: links
// (data: is only allowed as an <img> source), forces links to open in a new
// tab and lets the caller rewrite or reject image sources.

const PURIFY_CONFIG: Config = {
  FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'option', 'iframe', 'frame', 'object', 'embed', 'link', 'meta', 'base'],
  ADD_ATTR: ['target'],
  ALLOW_UNKNOWN_PROTOCOLS: false,
}

export interface SanitizeOptions {
  // Return the URL to use for an <img src>, or null to drop the image.
  // Default: keep http(s), data:image/ and blob: sources.
  rewriteImg?: (src: string) => string | null
}

function defaultImg(src: string): string | null {
  return /^(https?:|data:image\/|blob:)/i.test(src) ? src : null
}

function postProcess(root: ParentNode, opts: SanitizeOptions) {
  const rewrite = opts.rewriteImg ?? defaultImg
  root.querySelectorAll('img').forEach((img) => {
    const src = (img.getAttribute('src') ?? '').trim()
    const next = src ? rewrite(src) : null
    if (!next) { img.remove(); return }
    img.setAttribute('src', next)
    img.setAttribute('loading', 'lazy')
    img.removeAttribute('srcset')
  })
  root.querySelectorAll('a').forEach((a) => {
    const href = (a.getAttribute('href') ?? '').trim()
    if (href.startsWith('#')) return
    if (!/^(https?:|mailto:)/i.test(href)) {
      a.removeAttribute('href')
      a.removeAttribute('target')
      return
    }
    a.setAttribute('target', '_blank')
    a.setAttribute('rel', 'noopener noreferrer')
  })
}

// Sanitises an HTML string and returns safe HTML.
export function sanitizeHtml(html: string, opts: SanitizeOptions = {}): string {
  const fragment = DOMPurify.sanitize(html, { ...PURIFY_CONFIG, RETURN_DOM_FRAGMENT: true }) as DocumentFragment
  postProcess(fragment, opts)
  const holder = document.createElement('div')
  holder.appendChild(fragment)
  return holder.innerHTML
}

// Sanitises an already-rendered subtree in place (docx-preview output).
export function sanitizeElement(root: HTMLElement, opts: SanitizeOptions = {}): void {
  DOMPurify.sanitize(root, { ...PURIFY_CONFIG, IN_PLACE: true })
  postProcess(root, opts)
}

// docx-preview generates a <style> from the document's styles. Its selectors
// are scoped to our className, but a crafted document could still reference
// remote resources (tracking) or break out with odd selectors: keep only
// data: URLs and drop @import.
export function sanitizeGeneratedCss(css: string): string {
  return css
    .replace(/@import[^;]*;/gi, '')
    .replace(/url\(\s*(['"]?)(?!data:)[^)]*\)/gi, 'none')
    .replace(/expression\s*\(/gi, '(')
    .replace(/<\/?style/gi, '')
}
