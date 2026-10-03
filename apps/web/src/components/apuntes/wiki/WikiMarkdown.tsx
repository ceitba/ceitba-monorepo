import { Children, isValidElement, useEffect, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { Element as HastElement, ElementContent } from 'hast'
import { useTranslation } from 'react-i18next'
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { kbPagePath, type KbPage } from '../../../api/kb'
import { CITE_SCHEME, preprocessWikilinks, sectionByLine, WIKI_SCHEME } from './wikilinks'
import CitationMarker from './CitationMarker'
import { useCitations } from './citationContext'

// Markdown body of a wiki page (lazy chunk: react-markdown, remark/rehype,
// KaTeX). Raw HTML is never rendered (no rehype-raw); wikilinks were turned
// into wiki:/cite: links by preprocessWikilinks and resolve here through
// page.links / page.sources.

function textOf(node: ReactNode): string {
  return Children.toArray(node)
    .map((c) => (typeof c === 'string' || typeof c === 'number' ? String(c) : isValidElement(c) ? textOf((c.props as { children?: ReactNode }).children) : ''))
    .join('')
}

// Must match the API's anchor algorithm exactly: NFD without combining
// marks, lowercase, runs of non-[a-z0-9] → "-", trimmed ("Cómo se
// calcula" → "como-se-calcula"). Duplicates get -2, -3 (see below).
export function headingId(text: string): string {
  return text
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

// Plain text of a heading from its hast node, leaving out citation markers
// (their text is just the number).
function hastText(nodes: ElementContent[] | undefined): string {
  return (nodes ?? []).map((n) => {
    if (n.type === 'text') return n.value
    if (n.type !== 'element') return ''
    const href = typeof n.properties?.href === 'string' ? n.properties.href : ''
    if (n.tagName === 'a' && href.startsWith(CITE_SCHEME)) return ''
    return hastText(n.children)
  }).join('')
}

// Splits "81.07/slug#anchor" | "slug#anchor" | "#anchor" into its anchor
// (fallback while page.links[].anchor isn't sent yet).
function anchorOf(raw: string): string | null {
  const i = raw.indexOf('#')
  return i >= 0 ? raw.slice(i + 1).trim() || null : null
}

const FLASH_CLASS = 'kb-heading-flash'

function urlTransform(url: string): string {
  if (url.startsWith(WIKI_SCHEME) || url.startsWith(CITE_SCHEME)) return url
  return defaultUrlTransform(url)
}

export default function WikiMarkdown({ page }: { page: KbPage }) {
  const { t } = useTranslation()
  const links = new Map(page.links.map((l) => [l.raw, l]))
  const sources = new Map(page.sources.map((s) => [s.id, s]))
  const { order } = useCitations()
  const markdown = preprocessWikilinks(page.markdown ?? '', page.links ?? [], order)
  const sections = sectionByLine(markdown)
  const location = useLocation()

  // Heading ids for this render, keyed by source offset so a heading keeps
  // its id; repeated slugs get -2, -3 in document order.
  const idsByOffset = new Map<number, string>()
  const seen = new Map<string, number>()
  function idFor(node: HastElement | undefined, children: ReactNode): string {
    const offset = node?.position?.start.offset ?? -1
    const cached = idsByOffset.get(offset)
    if (cached) return cached
    const base = headingId(node ? hastText(node.children) : textOf(children)) || 'seccion'
    const count = (seen.get(base) ?? 0) + 1
    seen.set(base, count)
    const id = count === 1 ? base : `${base}-${count}`
    if (offset >= 0) idsByOffset.set(offset, id)
    return id
  }

  // After the body renders (and on every hash change, including same-page
  // [[#anchor]] links), scroll to the heading and flash it. The headings
  // carry scroll-margin for the sticky navbar.
  useEffect(() => {
    const id = decodeURIComponent(location.hash.replace(/^#/, ''))
    if (!id) return
    const el = document.getElementById(id)
    if (!el) return
    el.scrollIntoView({ block: 'start' })
    el.classList.remove(FLASH_CLASS)
    void el.offsetWidth // restart the animation
    el.classList.add(FLASH_CLASS)
    const timer = window.setTimeout(() => el.classList.remove(FLASH_CLASS), 1800)
    return () => window.clearTimeout(timer)
  }, [location.hash, location.key, markdown])

  function heading(level: 1 | 2 | 3 | 4 | 5 | 6) {
    const Tag = `h${level}` as const
    return function Heading({ children, node }: { children?: ReactNode; node?: HastElement }) {
      const id = idFor(node, children)
      return (
        <Tag id={id} className="group scroll-mt-24">
          {children}
          <a href={`#${id}`} className="heading-anchor" aria-label={t('wiki.anchorAria', { title: textOf(children) })}>#</a>
        </Tag>
      )
    }
  }

  const components: Components = {
    h1: heading(1),
    h2: heading(2),
    h3: heading(3),
    h4: heading(4),
    h5: heading(5),
    h6: heading(6),
    a({ href, title, children, node }) {
      const url = href ?? ''
      if (url.startsWith(WIKI_SCHEME)) {
        const raw = decodeURIComponent(url.slice(WIKI_SCHEME.length))
        // Same-page section: [[#anchor|text]].
        if (raw.startsWith('#')) {
          const anchor = links.get(raw)?.anchor ?? anchorOf(raw)
          if (!anchor) return <>{children}</>
          return (
            <Link to={{ pathname: location.pathname, search: location.search, hash: `#${anchor}` }} className="kb-link">
              {children}
            </Link>
          )
        }
        const link = links.get(raw) ?? links.get(raw.split('#')[0])
        if (!link?.resolved) {
          return <span className="kb-unresolved" title={t('wiki.unresolved')}>{children}</span>
        }
        const anchor = link.anchor ?? anchorOf(raw)
        const external = link.subjectId !== page.subjectId
        return (
          <Link to={`${kbPagePath(link.subjectId, link.slug)}${anchor ? `#${encodeURIComponent(anchor)}` : ''}`} className="kb-link">
            {children}
            {external && <span className="kb-link-subject">{link.subjectId}</span>}
          </Link>
        )
      }
      if (url.startsWith(CITE_SCHEME)) {
        const id = decodeURIComponent(url.slice(CITE_SCHEME.length))
        const line = node?.position?.start.line ?? 0
        return (
          <CitationMarker
            fileId={id}
            n={order.indexOf(id) + 1}
            label={title ?? null}
            section={sections[line] ?? null}
            source={sources.get(id)}
          />
        )
      }
      if (url.startsWith('#')) return <a href={url}>{children}</a>
      if (!url) return <>{children}</>
      return <a href={url} target="_blank" rel="noopener noreferrer">{children}</a>
    },
    table({ children }) {
      return <div className="kb-table"><table>{children}</table></div>
    },
  }

  return (
    <div className="kb-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        urlTransform={urlTransform}
        components={components}
        skipHtml
      >
        {markdown}
      </ReactMarkdown>
    </div>
  )
}
