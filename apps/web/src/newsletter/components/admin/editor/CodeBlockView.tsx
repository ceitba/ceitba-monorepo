import { useEffect, useState } from 'react'
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import { useTranslation } from 'react-i18next'
import MermaidDiagram from '../../article/MermaidDiagram'

const LANGUAGES = ['', 'mermaid', 'javascript', 'typescript', 'python', 'java', 'c', 'cpp', 'bash', 'json', 'sql', 'html', 'css']

function useDebounced(value, ms) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return debounced
}

// Code block with a language picker; ```mermaid blocks also show the live
// diagram under the source, rendered the same way readers will see it.
export default function CodeBlockView({ node, updateAttributes }) {
  const { t } = useTranslation()
  const language = node.attrs.language ?? ''
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
      <pre><NodeViewContent as="code" /></pre>
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
