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

// Anything that can fetch a resource or smuggle one past a naive filter: CSS
// escapes (`u\72l(`) are decoded by the CSSOM parser before this test, and
// a backslash left in a serialised value means something odd survived.
const UNSAFE_CSS_VALUE = /url\s*\(|image-set|\\|@import|expression/i

function safeDeclarations(style: CSSStyleDeclaration): string {
  const out: string[] = []
  for (let i = 0; i < style.length; i++) {
    const name = style.item(i)
    const value = style.getPropertyValue(name)
    if (UNSAFE_CSS_VALUE.test(name) || UNSAFE_CSS_VALUE.test(value)) continue
    out.push(`${name}: ${value}${style.getPropertyPriority(name) ? ' !important' : ''}`)
  }
  return out.join('; ')
}

// docx-preview generates a <style> from the document's style and font names.
// The viewer renders it inside a shadow root so it cannot reach the page, and
// this pass parses it with the CSSOM (so CSS escapes are decoded) and keeps
// only plain style rules, without any declaration that could load a resource.
// @import, @font-face, @media and every other at-rule are dropped.
export function sanitizeGeneratedCss(css: string): string {
  const sheet = new CSSStyleSheet()
  try {
    sheet.replaceSync(css)
  } catch {
    return ''
  }
  const out: string[] = []
  for (const rule of Array.from(sheet.cssRules)) {
    if (!(rule instanceof CSSStyleRule)) continue
    const decls = safeDeclarations(rule.style)
    if (decls) out.push(`${rule.selectorText} { ${decls} }`)
  }
  return out.join('\n')
}

// Applies the same declaration filter to inline style attributes.
export function sanitizeInlineStyles(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('[style]').forEach((el) => {
    const style = el.style
    for (let i = style.length - 1; i >= 0; i--) {
      const name = style.item(i)
      if (UNSAFE_CSS_VALUE.test(style.getPropertyValue(name))) style.removeProperty(name)
    }
    if (!style.length) el.removeAttribute('style')
  })
}
