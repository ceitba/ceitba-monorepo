import { Children, isValidElement, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { kbPagePath, type KbPage } from '../../../api/kb'
import { CITE_SCHEME, preprocessWikilinks, WIKI_SCHEME } from './wikilinks'

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
  const sources = new Map(page.sources.map((s, i) => [s.id, { ...s, n: i + 1 }]))
  const markdown = preprocessWikilinks(page.markdown ?? '', page.links ?? [], page.sources ?? [])

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
    a({ href, children }) {
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
        const source = sources.get(id)
        const author = source?.author?.anonymous || !source?.author?.name ? t('apuntes.anonymousAuthor') : source.author.name
        const tip = source ? `${source.name} · ${author}` : t('wiki.unknownSource')
        return (
          <Link to={`/apuntes/archivo/${encodeURIComponent(id)}`} className="kb-cite" title={tip} aria-label={t('wiki.citeAria', { name: tip })}>
            {children}
          </Link>
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
