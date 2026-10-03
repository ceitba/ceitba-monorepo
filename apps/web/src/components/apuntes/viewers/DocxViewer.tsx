import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { sanitizeElement, sanitizeGeneratedCss, sanitizeInlineStyles } from '../../../utils/sanitize'

// Page chrome for docx-preview's output. It lives inside the shadow root
// (global CSS can't reach it): pages keep their paper look (white, the
// document's own colours) in both themes; the grey host is the "desk".
const HOST_CSS = `
:host { display: block; }
.apunte-docx-wrapper { background: transparent !important; padding: 16px !important; }
.apunte-docx-wrapper > section.apunte-docx {
  box-shadow: 0 1px 3px rgba(26,60,110,0.08), 0 4px 16px rgba(26,60,110,0.06) !important;
  margin-bottom: 16px !important;
}
@media (max-width: 640px) { .apunte-docx-wrapper { padding: 8px !important; } }
`

// .docx rendered client-side with docx-preview (lazy chunk). The output goes
// into a shadow root, so the <style> docx-preview builds from the document's
// style and font names stays scoped to the viewer and can't restyle the page.
// It renders off-document first, then the body is sanitised and the generated
// CSS is filtered through the CSSOM before anything is shown.
export default function DocxViewer({ blob, onError }: { blob: Blob; onError: (e: unknown) => void }) {
  const { t } = useTranslation()
  const hostRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  useEffect(() => {
    let cancelled = false
    const host = hostRef.current
    if (!host) return
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
    // Render into a detached shadow root first: nothing unsanitised is ever
    // in the document, and a stale render can't overwrite a newer one.
    const stage = document.createElement('div').attachShadow({ mode: 'open' })
    ;(async () => {
      try {
        const { renderAsync } = await import('docx-preview')
        // renderAsync only appends to and clears its containers, which a
        // ShadowRoot supports; its typings ask for an HTMLElement.
        const container = stage as unknown as HTMLElement
        await renderAsync(blob, container, container, {
          className: 'apunte-docx',
          inWrapper: true,
          ignoreLastRenderedPageBreak: true,
          breakPages: true,
          useBase64URL: true,
          renderAltChunks: false,
          renderComments: false,
          renderChanges: false,
          experimental: false,
        })
        if (cancelled) return
        const styles = Array.from(stage.querySelectorAll('style'))
        const css = styles.map((s) => s.textContent ?? '').join('\n')
        styles.forEach((s) => s.remove())
        const body = document.createElement('div')
        body.append(...Array.from(stage.childNodes))
        sanitizeElement(body)
        sanitizeInlineStyles(body)
        const base = document.createElement('style')
        base.textContent = HOST_CSS
        const generated = document.createElement('style')
        generated.textContent = sanitizeGeneratedCss(css)
        shadow.replaceChildren(base, generated, body)
        setReady(true)
      } catch (e) {
        if (!cancelled) onErrorRef.current(e)
      }
    })()
    return () => {
      cancelled = true
      shadow.replaceChildren()
    }
  }, [blob])

  return (
    <div className="w-full overflow-x-auto rounded-card border border-border dark:border-night-border bg-[#f3f3f1] dark:bg-night-raised">
      {!ready && <ViewerLoading label={t('apuntes.viewer.rendering')} />}
      <div ref={hostRef} hidden={!ready} />
    </div>
  )
}

export function ViewerLoading({ label }: { label: string }) {
  return (
    <div aria-busy="true" className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="w-full max-w-2xl h-[50vh] rounded-card skeleton" aria-hidden="true" />
      <p className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">{label}</p>
    </div>
  )
}
