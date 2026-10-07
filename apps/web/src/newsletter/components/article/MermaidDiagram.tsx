import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

// mermaid is ~1 MB: load it only when an article actually has a diagram.
// A failed import (e.g. a chunk removed by a deploy) isn't cached, so the
// next diagram retries.
let mermaidPromise = null
function loadMermaid() {
  mermaidPromise ??= import('mermaid')
    .then((m) => m.default)
    .catch((err) => { mermaidPromise = null; throw err })
  return mermaidPromise
}

let renderCount = 0

function isDark() {
  return document.documentElement.classList.contains('dark')
}

// Re-render diagrams when the theme toggles (`dark` class on <html>).
function useIsDark() {
  const [dark, setDark] = useState(isDark)
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(isDark()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  return dark
}

// Renders a ```mermaid fence. securityLevel 'strict' sanitizes the SVG and
// disables click handlers, so diagram source from an article can't inject
// script. On a syntax error the source is shown instead, so the editor sees
// what to fix and readers still get the content.
export default function MermaidDiagram({ code }) {
  const { t } = useTranslation()
  const baseId = `mmd-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`
  const dark = useIsDark()
  const [svg, setSvg] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    const source = code.trim()
    if (!source) { setSvg(''); setFailed(false); return }
    // mermaid.render removes any element with the id it is given — that
    // would be the SVG on screen — so every render gets a fresh id.
    const id = `${baseId}-${++renderCount}`
    loadMermaid()
      .then(async (mermaid) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: dark ? 'dark' : 'neutral',
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
  }, [code, baseId, dark])

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
