import { Children, isValidElement, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
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

export function headingId(text: string): string {
  return text
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'seccion'
}

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

  function heading(level: 2 | 3 | 4) {
    const Tag = `h${level}` as const
    return function Heading({ children }: { children?: ReactNode }) {
      const id = headingId(textOf(children))
      return (
        <Tag id={id} className="group scroll-mt-24">
          {children}
          <a href={`#${id}`} className="heading-anchor" aria-label={t('wiki.anchorAria', { title: textOf(children) })}>#</a>
        </Tag>
      )
    }
  }

  const components: Components = {
    h2: heading(2),
    h3: heading(3),
    h4: heading(4),
    a({ href, title, children, node }) {
      const url = href ?? ''
      if (url.startsWith(WIKI_SCHEME)) {
        const raw = decodeURIComponent(url.slice(WIKI_SCHEME.length))
        const link = links.get(raw)
        if (!link?.resolved) {
          return <span className="kb-unresolved" title={t('wiki.unresolved')}>{children}</span>
        }
        const external = link.subjectId !== page.subjectId
        return (
          <Link to={kbPagePath(link.subjectId, link.slug)} className="kb-link">
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
