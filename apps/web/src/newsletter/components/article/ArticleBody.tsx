import { useMemo, type ReactNode } from 'react'
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import MermaidDiagram from './MermaidDiagram'
import PollBlock from '../engagement/PollBlock'
import { POLL_FENCE_LANGUAGE } from '../../api/engagement'
import { bodyToMarkdown } from '../../utils/articleBody'

// Raw HTML in the Markdown is not rendered (react-markdown's default), and
// its URL transform drops javascript: links — article bodies can't inject
// markup. remark-breaks keeps single newlines, which old plain-text bodies
// used as line breaks inside a paragraph.

// react-markdown passes its hast `node` to every component; keep it off the DOM.
function domProps<P extends ExtraProps>(props: P): Omit<P, 'node'> {
  const rest = { ...props }
  delete rest.node
  return rest
}

function isExternal(href: string | undefined): boolean {
  try {
    // String(): what the URL constructor does with undefined anyway.
    return new URL(String(href), window.location.href).origin !== window.location.origin
  } catch {
    return false
  }
}

function components(poll: ((pollId: string) => ReactNode) | null): Components {
  return {
    // Only links leaving the site open in a new tab; anchors (footnotes) and
    // same-site links stay in place.
    a: (props) => (
      isExternal(props.href)
        ? <a {...domProps(props)} target="_blank" rel="noopener noreferrer" />
        : <a {...domProps(props)} />
    ),
    img: (props) => <img {...domProps(props)} alt={props.alt ?? ''} loading="lazy" />,
    pre: ({ node, children, ...props }) => {
      const first = node?.children?.[0]
      const code = first?.type === 'element' ? first : undefined
      const className = code?.properties?.className
      const lang = Array.isArray(className) ? className.find((c) => String(c).startsWith('language-')) : undefined
      const source = code?.children?.map((c) => ('value' in c ? c.value : '')).join('') ?? ''
      if (code && lang === 'language-mermaid') return <MermaidDiagram code={source} />
      // ```poll fences hold a poll id (apps/api/docs/NEWSLETTER-ENGAGEMENT.md).
      if (code && lang === `language-${POLL_FENCE_LANGUAGE}` && poll) return poll(source.trim())
      return <pre {...props}>{children}</pre>
    },
    table: (props) => (
      <div className="article-prose__table"><table {...domProps(props)} /></div>
    ),
  }
}

interface ArticleBodyProps {
  // Markdown blocks (Article.body); see bodyToMarkdown.
  body: unknown
  className?: string
  // Renders ```poll blocks as that article's polls; without it they stay code.
  articleId?: string | null
  // Editor preview: polls show without voting.
  previewPolls?: boolean
}

// Shared by the public article page, the editor preview and (by class) the
// editor itself, so what the author sees is what readers get.
export default function ArticleBody({ body, className = '', articleId = null, previewPolls = false }: ArticleBodyProps) {
  const markdown = bodyToMarkdown(body)
  // Stable component identities: a new `pre` every render would remount (and refetch) the polls.
  const rendered = useMemo(
    () => components(articleId ? (pollId) => <PollBlock articleId={articleId} pollId={pollId} preview={previewPolls} /> : null),
    [articleId, previewPolls],
  )
  return (
    <div className={['article-prose', className].join(' ')}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={rendered}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  )
}
