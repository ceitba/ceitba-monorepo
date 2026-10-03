import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { sanitizeElement, sanitizeGeneratedCss } from '../../../utils/sanitize'

// .docx rendered client-side with docx-preview (lazy chunk). Output goes
// into a scoped container (class `apunte-docx`, which docx-preview prefixes
// all its generated CSS with) and is sanitised in place before showing.
export default function DocxViewer({ blob, onError }: { blob: Blob; onError: (e: unknown) => void }) {
  const { t } = useTranslation()
  const bodyRef = useRef<HTMLDivElement>(null)
  const styleRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  useEffect(() => {
    let cancelled = false
    const body = bodyRef.current
    const styles = styleRef.current
    if (!body || !styles) return
    // Render off-screen first so nothing unsanitised is ever visible.
    const stageBody = document.createElement('div')
    const stageStyles = document.createElement('div')
    ;(async () => {
      try {
        const { renderAsync } = await import('docx-preview')
        await renderAsync(blob, stageBody, stageStyles, {
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
        sanitizeElement(stageBody)
        const css = Array.from(stageStyles.querySelectorAll('style')).map((s) => s.textContent ?? '').join('\n')
        const style = document.createElement('style')
        style.textContent = sanitizeGeneratedCss(css)
        styles.replaceChildren(style)
        body.replaceChildren(...Array.from(stageBody.childNodes))
        setReady(true)
      } catch (e) {
        if (!cancelled) onErrorRef.current(e)
      }
    })()
    return () => {
      cancelled = true
      body.replaceChildren()
      styles.replaceChildren()
    }
  }, [blob])

  return (
    <div className="apunte-docx-host w-full overflow-x-auto rounded-card border border-border dark:border-night-border bg-[#f3f3f1] dark:bg-night-raised">
      <div ref={styleRef} hidden />
      {!ready && <ViewerLoading label={t('apuntes.viewer.rendering')} />}
      <div ref={bodyRef} />
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
