import { useEffect, useState } from 'react'
import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { useTranslation } from 'react-i18next'
import MermaidDiagram from '../../article/MermaidDiagram'
import PollBlock from '../../engagement/PollBlock'
import { POLL_FENCE_LANGUAGE } from '../../../api/engagement'
import { useEditorArticleId } from '../../engagement/editorArticle'

const LANGUAGES = ['', 'mermaid', 'javascript', 'typescript', 'python', 'java', 'c', 'cpp', 'bash', 'json', 'sql', 'html', 'css']

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return debounced
}

// Code block with a language picker; ```mermaid blocks also show the live
// diagram under the source, rendered the same way readers will see it.
// ```poll blocks (inserted from the Polls card) show the poll instead.
export default function CodeBlockView(props: ReactNodeViewProps) {
  if ((props.node.attrs.language ?? '') === POLL_FENCE_LANGUAGE) return <PollNodeView {...props} />
  return <CodeNodeView {...props} />
}

function PollNodeView({ node, deleteNode }: ReactNodeViewProps) {
  const { t } = useTranslation()
  const articleId = useEditorArticleId()
  // Debounced like the Mermaid preview: editing the id doesn't refetch on every keystroke.
  const pollId = useDebounced(node.textContent.trim(), 400)
  return (
    <NodeViewWrapper className="code-block-node">
      <div className="code-block-node__bar" contentEditable={false}>
        <span>{t('engagement.editor.pollBlock')}</span>
        <button type="button" onClick={() => deleteNode()}>{t('engagement.editor.removeBlock')}</button>
      </div>
      {/* The poll id: what the Markdown stores. Visible so the caret never edits it unseen. */}
      <pre className="code-block-node__poll-id" aria-label={t('engagement.editor.pollId')}><NodeViewContent<'code'> as="code" /></pre>
      <div className="code-block-node__preview" contentEditable={false}>
        {articleId && pollId ? <PollBlock articleId={articleId} pollId={pollId} preview /> : <p>{t('engagement.poll.unavailable')}</p>}
      </div>
    </NodeViewWrapper>
  )
}

function CodeNodeView({ node, updateAttributes }: ReactNodeViewProps) {
  const { t } = useTranslation()
  const language: string = node.attrs.language ?? ''
  const isMermaid = language === 'mermaid'
  const source = useDebounced(isMermaid ? node.textContent : '', 400)

  return (
    <NodeViewWrapper className="code-block-node">
      <div className="code-block-node__bar" contentEditable={false}>
        <span>{isMermaid ? t('editor.mermaid') : t('editor.codeBlock')}</span>
        <select
          value={LANGUAGES.includes(language) ? language : ''}
          onChange={(e) => updateAttributes({ language: e.target.value || null })}
          aria-label={t('editor.language')}
        >
          {LANGUAGES.map((l) => (
            <option key={l} value={l}>{l || t('editor.plainText')}</option>
          ))}
        </select>
      </div>
      <pre><NodeViewContent<'code'> as="code" /></pre>
      {isMermaid && (
        <div className="code-block-node__preview" contentEditable={false}>
          {source.trim()
            ? <MermaidDiagram code={source} />
            : <p>{t('editor.mermaidEmpty')}</p>}
        </div>
      )}
    </NodeViewWrapper>
  )
}
