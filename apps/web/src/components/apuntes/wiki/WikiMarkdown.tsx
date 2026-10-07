import { Children, createContext, isValidElement, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { Element as HastElement, ElementContent } from 'hast'
import { useTranslation } from 'react-i18next'
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { kbPagePath, type KbLink, type KbPage, type KbSource } from '../../../api/kb'
import { trustedImageSrc } from '../../../utils/url'
import { CITE_SCHEME, preprocessWikilinks, sectionByLine, WIKI_SCHEME } from './wikilinks'
import CitationMarker from './CitationMarker'
import { headingId } from './headingId'
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

// Private schemes pass through; data:image/ is allowed for <img> only (the
// img override still decides what is shown).
function urlTransform(url: string, key: string): string {
  if (url.startsWith(WIKI_SCHEME) || url.startsWith(CITE_SCHEME)) return url
  if (key === 'src' && /^data:image\//i.test(url)) return url
  return defaultUrlTransform(url)
}

// Data the module-level renderers below need. The components themselves
// are defined once (not per render) so React never remounts the headings or
// citation markers; a context change only re-renders them.
interface MarkdownData {
  links: Map<string, KbLink>
  sources: Map<string, KbSource>
  sections: (string | null)[]
  subjectId: string
  order: string[]
  idFor: (node: HastElement | undefined, children: ReactNode) => string
}

const MarkdownContext = createContext<MarkdownData | null>(null)

function useMarkdownData(): MarkdownData {
  const data = useContext(MarkdownContext)
  if (!data) throw new Error('WikiMarkdown renderers need MarkdownContext')
  return data
}

// Heading ids keyed by source offset, so a heading keeps its id across
// re-renders; repeated slugs get -2, -3 in document order. One allocator
// per markdown string.
function headingIdAllocator() {
  const idsByOffset = new Map<number, string>()
  const seen = new Map<string, number>()
  return (node: HastElement | undefined, children: ReactNode): string => {
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
}

type HeadingProps = { children?: ReactNode; node?: HastElement }

function Heading({ level, children, node }: HeadingProps & { level: 1 | 2 | 3 | 4 | 5 | 6 }) {
  const { t } = useTranslation()
  const { idFor } = useMarkdownData()
  const Tag = `h${level}` as const
  const id = idFor(node, children)
  return (
    <Tag id={id} className="group scroll-mt-24">
      {children}
      <a href={`#${id}`} className="heading-anchor" aria-label={t('wiki.anchorAria', { title: textOf(children) })}>#</a>
    </Tag>
  )
}

const H1 = (p: HeadingProps) => <Heading level={1} {...p} />
const H2 = (p: HeadingProps) => <Heading level={2} {...p} />
const H3 = (p: HeadingProps) => <Heading level={3} {...p} />
const H4 = (p: HeadingProps) => <Heading level={4} {...p} />
const H5 = (p: HeadingProps) => <Heading level={5} {...p} />
const H6 = (p: HeadingProps) => <Heading level={6} {...p} />

function MarkdownLink({ href, title, children, node }: { href?: string; title?: string; children?: ReactNode; node?: HastElement }) {
  const { t } = useTranslation()
  const location = useLocation()
  const { links, sources, sections, subjectId, order } = useMarkdownData()
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
    const external = link.subjectId !== subjectId
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
}

// Only our own API/asset images and inline data:image/; any other source
// (remote tracking pixels) shows its alt text instead.
function MarkdownImage({ src, alt, title }: { src?: string | Blob; alt?: string; title?: string }) {
  const safe = typeof src === 'string' ? trustedImageSrc(src) : null
  if (!safe) return alt ? <span className="kb-img-alt">{alt}</span> : null
  return <img src={safe} alt={alt ?? ''} title={title} loading="lazy" />
}

function MarkdownTable({ children }: { children?: ReactNode }) {
  return <div className="kb-table"><table>{children}</table></div>
}

const COMPONENTS: Components = {
  h1: H1, h2: H2, h3: H3, h4: H4, h5: H5, h6: H6,
  a: MarkdownLink,
  img: MarkdownImage,
  table: MarkdownTable,
}

const REMARK_PLUGINS = [remarkGfm, remarkMath]
const REHYPE_PLUGINS = [rehypeKatex]

export default function WikiMarkdown({ page }: { page: KbPage }) {
  const { order } = useCitations()
  const markdown = useMemo(
    () => preprocessWikilinks(page.markdown ?? '', page.links ?? [], order),
    [page.markdown, page.links, order],
  )
  const location = useLocation()

  const data = useMemo<MarkdownData>(() => ({
    links: new Map((page.links ?? []).map((l) => [l.raw, l])),
    sources: new Map((page.sources ?? []).map((s) => [s.id, s])),
    sections: sectionByLine(markdown),
    subjectId: page.subjectId,
    order,
    idFor: headingIdAllocator(),
  }), [page.links, page.sources, page.subjectId, markdown, order])

  // Parsed once per markdown: re-renders of this component (hash changes,
  // context updates) don't re-run remark/rehype/KaTeX.
  const body = useMemo(() => (
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={REHYPE_PLUGINS}
      urlTransform={urlTransform}
      components={COMPONENTS}
      skipHtml
    >
      {markdown}
    </ReactMarkdown>
  ), [markdown])

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

  return (
    <MarkdownContext.Provider value={data}>
      <div className="kb-prose">{body}</div>
    </MarkdownContext.Provider>
  )
}
