import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ViewerLoading } from './DocxViewer'

// Showing megabytes of text in one <pre> is slow; cap it.
const MAX_CHARS = 1_000_000

interface NbCell {
  cell_type?: string
  source?: string | string[]
  outputs?: { output_type?: string; text?: string | string[]; data?: Record<string, string | string[]> }[]
}

function joinSource(src: string | string[] | undefined): string {
  return Array.isArray(src) ? src.join('') : (src ?? '')
}

// Plain text / code in a <pre>; Jupyter notebooks as markdown cells (plain
// text) and code cells with their text outputs. Rendered as React text
// nodes, never as HTML.
export default function TextViewer({ blob, notebook, onError }: { blob: Blob; notebook: boolean; onError: (e: unknown) => void }) {
  const { t } = useTranslation()
  const [text, setText] = useState<string | null>(null)
  const [cells, setCells] = useState<NbCell[] | null>(null)
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  useEffect(() => {
    let cancelled = false
    blob.text().then((value) => {
      if (cancelled) return
      if (notebook) {
        try {
          const nb = JSON.parse(value) as { cells?: NbCell[]; worksheets?: { cells?: NbCell[] }[] }
          const list = nb.cells ?? nb.worksheets?.[0]?.cells
          if (Array.isArray(list)) { setCells(list); return }
        } catch { /* fall through to raw text */ }
      }
      setText(value)
    }).catch((e) => { if (!cancelled) onErrorRef.current(e) })
    return () => { cancelled = true }
  }, [blob, notebook])

  if (cells) {
    return (
      <div className="w-full flex flex-col gap-4 rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface p-4 sm:p-6">
        {cells.map((c, i) => {
          const src = joinSource(c.source)
          if (c.cell_type === 'code') {
            const outputs = (c.outputs ?? [])
              .map((o) => joinSource(o.text ?? o.data?.['text/plain']))
              .filter(Boolean)
            return (
              <div key={i} className="flex flex-col gap-1">
                <pre className="overflow-x-auto p-3 rounded-sm bg-page-bg dark:bg-night-bg border border-border dark:border-night-border font-mono text-body-sm text-ink-primary dark:text-night-text whitespace-pre">{src}</pre>
                {outputs.map((out, j) => (
                  <pre key={j} className="overflow-x-auto px-3 py-2 font-mono text-label text-ink-secondary dark:text-night-muted whitespace-pre-wrap border-l-2 border-accent">{out}</pre>
                ))}
              </div>
            )
          }
          return (
            <div key={i} className="font-body text-body text-ink-primary dark:text-night-text whitespace-pre-wrap break-words">{src}</div>
          )
        })}
      </div>
    )
  }

  if (text == null) return <ViewerLoading label={t('apuntes.viewer.rendering')} />

  const truncated = text.length > MAX_CHARS
  return (
    <div className="w-full rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface overflow-hidden">
      {truncated && (
        <p className="px-4 py-2 font-body text-body-sm text-amber-700 dark:text-amber-300 border-b border-border dark:border-night-border">
          {t('apuntes.viewer.textTruncated')}
        </p>
      )}
      <pre className="max-h-[80vh] overflow-auto p-4 font-mono text-body-sm text-ink-primary dark:text-night-text whitespace-pre">
        {truncated ? text.slice(0, MAX_CHARS) : text}
      </pre>
    </div>
  )
}
