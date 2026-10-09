import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { sanitizeHtml } from '../../../utils/sanitize'
import { ViewerLoading } from './DocxViewer'
import { Tabs } from '../../ui'

// Rendering huge sheets as HTML would freeze the tab: cap what we show.
const MAX_ROWS = 2000
const MAX_COLS = 60

interface Sheet {
  name: string
  html: string
  truncated: boolean
}

// .xlsx/.xls/.ods/.csv via SheetJS (lazy chunk): one tab per sheet, each a
// horizontally scrollable table. SheetJS output is sanitised with DOMPurify.
export default function SheetViewer({ blob, isCsv, onError }: { blob: Blob; isCsv: boolean; onError: (e: unknown) => void }) {
  const { t } = useTranslation()
  const [sheets, setSheets] = useState<Sheet[] | null>(null)
  const [active, setActive] = useState(0)
  const tabsId = useId()
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const XLSX = await import('xlsx')
        const wb = isCsv
          ? XLSX.read(await blob.text(), { type: 'string', raw: false, dense: true })
          : XLSX.read(await blob.arrayBuffer(), { type: 'array', dense: true, cellStyles: false, cellHTML: false })
        const out: Sheet[] = wb.SheetNames.map((name) => {
          const ws = wb.Sheets[name]
          let truncated = false
          const ref = ws['!ref']
          if (ref) {
            const range = XLSX.utils.decode_range(ref)
            if (range.e.r - range.s.r + 1 > MAX_ROWS) { range.e.r = range.s.r + MAX_ROWS - 1; truncated = true }
            if (range.e.c - range.s.c + 1 > MAX_COLS) { range.e.c = range.s.c + MAX_COLS - 1; truncated = true }
            ws['!ref'] = XLSX.utils.encode_range(range)
          }
          const raw = ref ? XLSX.utils.sheet_to_html(ws, { header: '', footer: '', editable: false }) : ''
          return { name, html: sanitizeHtml(raw), truncated }
        })
        if (!cancelled) { setSheets(out); setActive(0) }
      } catch (e) {
        if (!cancelled) onErrorRef.current(e)
      }
    })()
    return () => { cancelled = true }
  }, [blob, isCsv])

  if (!sheets) return <ViewerLoading label={t('apuntes.viewer.rendering')} />

  const sheet = sheets[active]
  return (
    <div className="w-full rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface overflow-hidden">
      {sheets.length > 1 && (
        <Tabs
          className="bg-page-bg dark:bg-night-bg"
          items={sheets.map((s, i) => ({ id: String(i), label: s.name }))}
          active={String(active)}
          onChange={(id) => setActive(Number(id))}
          label={t('apuntes.viewer.sheetsAria')}
          idPrefix={tabsId}
        />
      )}
      {sheet && sheet.truncated && (
        <p className="px-4 py-2 font-body text-body-sm text-amber-700 dark:text-amber-300 border-b border-border dark:border-night-border">
          {t('apuntes.viewer.sheetTruncated', { rows: MAX_ROWS, cols: MAX_COLS })}
        </p>
      )}
      <div
        className="apunte-sheet max-h-[75vh] overflow-auto"
        role={sheets.length > 1 ? 'tabpanel' : undefined}
        id={sheets.length > 1 ? `${tabsId}-panel-${active}` : undefined}
        aria-labelledby={sheets.length > 1 ? `${tabsId}-tab-${active}` : undefined}
      >
        {sheet && sheet.html ? (
          <div dangerouslySetInnerHTML={{ __html: sheet.html }} />
        ) : (
          <p className="px-4 py-8 text-center font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('apuntes.viewer.emptySheet')}</p>
        )}
      </div>
    </div>
  )
}
