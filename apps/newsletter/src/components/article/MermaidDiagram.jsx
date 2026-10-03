import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

// mermaid is ~1 MB: load it only when an article actually has a diagram.
let mermaidPromise = null
function loadMermaid() {
  mermaidPromise ??= import('mermaid').then((m) => m.default)
  return mermaidPromise
}

function isDark() {
  return document.documentElement.classList.contains('dark')
}

// Renders a ```mermaid fence. securityLevel 'strict' sanitizes the SVG and
// disables click handlers, so diagram source from an article can't inject
// script. On a syntax error the source is shown instead, so the editor sees
// what to fix and readers still get the content.
export default function MermaidDiagram({ code }) {
  const { t } = useTranslation()
  const id = `mmd-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`
  const [svg, setSvg] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    const source = code.trim()
    if (!source) { setSvg(''); setFailed(false); return }
    loadMermaid()
      .then(async (mermaid) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: isDark() ? 'dark' : 'neutral',
          fontFamily: '"Source Sans 3", system-ui, sans-serif',
        })
        const { svg: out } = await mermaid.render(id, source)
        if (!cancelled) { setSvg(out); setFailed(false) }
      })
      .catch(() => {
        // mermaid leaves its error graphic in <body> when render fails.
        document.getElementById(`d${id}`)?.remove()
        if (!cancelled) { setSvg(''); setFailed(true) }
      })
    return () => { cancelled = true }
  }, [code, id])

  if (failed) {
    return (
      <figure className="mermaid-diagram mermaid-diagram--error">
        <figcaption>{t('articleBody.mermaidError')}</figcaption>
        <pre><code>{code}</code></pre>
      </figure>
    )
  }
  if (!svg) {
    return <div className="mermaid-diagram mermaid-diagram--loading" aria-busy="true" />
  }
  return (
    <figure
      className="mermaid-diagram"
      role="img"
      aria-label={t('articleBody.diagram')}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
