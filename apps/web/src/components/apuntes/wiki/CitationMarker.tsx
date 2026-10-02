import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import type { KbSource } from '../../../api/kb'
import KindIcon from '../KindIcon'
import { useCitations } from './citationContext'

const POPOVER_WIDTH = 288 // 18rem
const MARGIN = 8

interface Props {
  fileId: string
  n: number
  label: string | null
  section: string | null
  source: KbSource | undefined
}

// Inline citation "[n]": muted, superscript-ish, keyboard focusable. Hover
// or focus (click/tap on touch) opens a small popover with the source and
// two actions. Escape closes it and returns focus to the marker; the
// popover is portalled and clamped to the viewport.
export default function CitationMarker({ fileId, n, label, section, source }: Props) {
  const { t } = useTranslation()
  const { highlighted, reportPart } = useCitations()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<number | null>(null)
  const popId = useId()

  const author = source?.author?.anonymous || !source?.author?.name ? t('apuntes.anonymousAuthor') : source.author.name
  const name = label || source?.name || t('wiki.unknownSource')

  const cancelClose = () => {
    if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null }
  }
  const scheduleClose = () => {
    cancelClose()
    closeTimer.current = window.setTimeout(() => setOpen(false), 180)
  }

  const place = useCallback(() => {
    const btn = buttonRef.current
    if (!btn) return
    const r = btn.getBoundingClientRect()
    const vw = document.documentElement.clientWidth
    const width = Math.min(POPOVER_WIDTH, vw - MARGIN * 2)
    const left = Math.min(Math.max(MARGIN, r.left + r.width / 2 - width / 2), vw - width - MARGIN)
    const popH = popRef.current?.offsetHeight ?? 140
    const below = r.bottom + 6
    const top = below + popH > window.innerHeight - MARGIN && r.top - popH - 6 > MARGIN ? r.top - popH - 6 : below
    setPos({ top, left })
  }, [])

  useLayoutEffect(() => { if (open) place() }, [open, place])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (!popRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, place])

  useEffect(() => cancelClose, [])

  // Close when focus leaves both the marker and the popover.
  const onBlur = (e: React.FocusEvent) => {
    const next = e.relatedTarget as Node | null
    if (next && (popRef.current?.contains(next) || buttonRef.current?.contains(next))) return
    setOpen(false)
  }

  function report() {
    const context = [
      section ? t('wiki.cite.reportSection', { section }) : null,
      t('wiki.cite.reportSource', { n, name }),
    ].filter(Boolean).join('\n')
    setOpen(false)
    reportPart(`${context}\n\n`)
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`kb-cite${highlighted === fileId ? ' is-highlighted' : ''}`}
        aria-label={t('wiki.cite.aria', { n, name })}
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        aria-haspopup="dialog"
        onClick={() => { cancelClose(); setOpen((v) => !v) }}
        // Hover opens for mouse only; touch taps go through onClick.
        onPointerEnter={(e) => { if (e.pointerType === 'mouse') { cancelClose(); setOpen(true) } }}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') scheduleClose() }}
        // Keyboard focus opens it; focus from a tap must not (the click
        // that follows would toggle it shut again).
        onFocus={(e) => { if (e.currentTarget.matches(':focus-visible')) setOpen(true) }}
        onBlur={onBlur}
      >
        [{n}]
      </button>
      {open && createPortal(
        <div
          ref={popRef}
          id={popId}
          role="dialog"
          aria-label={t('wiki.cite.popoverAria', { n })}
          onPointerEnter={cancelClose}
          onPointerLeave={(e) => { if (e.pointerType === 'mouse') scheduleClose() }}
          onBlur={onBlur}
          style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: `min(${POPOVER_WIDTH}px, calc(100vw - ${MARGIN * 2}px))` }}
          className="fixed z-50 rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface shadow-card-hover p-3 flex flex-col gap-2 animate-fade-in"
        >
          <div className="flex items-start gap-2">
            <span className="font-mono text-label text-ink-secondary dark:text-night-muted mt-0.5">[{n}]</span>
            {source && <KindIcon kind={source.kind} size={16} className="mt-0.5" />}
            <div className="min-w-0">
              <p className="font-body text-body-sm font-semibold text-ink-primary dark:text-night-text break-words">{name}</p>
              {label && source?.name && label !== source.name && (
                <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted break-words">{source.name}</p>
              )}
              <p className="font-mono text-label text-ink-secondary dark:text-night-muted">{author}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-2 border-t border-border dark:border-night-border">
            <Link
              to={`/apuntes/archivo/${encodeURIComponent(fileId)}`}
              className="font-mono text-label uppercase tracking-widest text-primary hover:underline"
            >
              {t('wiki.cite.open')}
            </Link>
            <button
              type="button"
              onClick={report}
              className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted hover:text-red-600 dark:hover:text-red-400"
            >
              {t('wiki.cite.report')}
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
