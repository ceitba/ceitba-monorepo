import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import MermaidDiagram from './MermaidDiagram'
import { bodyToMarkdown } from '../../utils/articleBody'

// Raw HTML in the Markdown is not rendered (react-markdown's default), and
// its URL transform drops javascript: links — article bodies can't inject
// markup. remark-breaks keeps single newlines, which old plain-text bodies
// used as line breaks inside a paragraph.

// react-markdown passes its hast `node` to every component; keep it off the DOM.
function domProps(props) {
  const rest = { ...props }
  delete rest.node
  return rest
}

function isExternal(href) {
  try {
    return new URL(href, window.location.href).origin !== window.location.origin
  } catch {
    return false
  }
}

const COMPONENTS = {
  // Only links leaving the site open in a new tab; anchors (footnotes) and
  // same-site links stay in place.
  a: (props) => (
    isExternal(props.href)
      ? <a {...domProps(props)} target="_blank" rel="noopener noreferrer" />
      : <a {...domProps(props)} />
  ),
  img: (props) => <img {...domProps(props)} alt={props.alt ?? ''} loading="lazy" />,
  pre: ({ node, children, ...props }) => {
    const code = node?.children?.[0]
    const lang = code?.properties?.className?.find?.((c) => String(c).startsWith('language-'))
    if (lang === 'language-mermaid') {
      const source = code.children?.map((c) => c.value ?? '').join('') ?? ''
      return <MermaidDiagram code={source} />
    }
    return <pre {...props}>{children}</pre>
  },
  table: (props) => (
    <div className="article-prose__table"><table {...domProps(props)} /></div>
  ),
}

// Shared by the public article page, the editor preview and (by class) the
// editor itself, so what the author sees is what readers get.
export default function ArticleBody({ body, className = '' }) {
  const markdown = bodyToMarkdown(body)
  return (
    <div className={['article-prose', className].join(' ')}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={COMPONENTS}>
        {markdown}
      </ReactMarkdown>
    </div>
  )
}
