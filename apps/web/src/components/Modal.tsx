import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

const WIDTHS = {
  md: 'max-w-md',
  lg: 'max-w-lg',
  '2xl': 'max-w-2xl',
} as const

export interface ModalProps {
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  // Called on Escape / backdrop click. Ignored while `busy`, so an in-flight
  // save or delete can't be dismissed half-way.
  onClose: () => void
  busy?: boolean
  size?: keyof typeof WIDTHS
  // Element to focus when the dialog opens; defaults to the first focusable.
  initialFocusRef?: RefObject<HTMLElement>
}

// Accessible modal shell shared by the /manage editors and ConfirmDialog:
// role=dialog + aria-modal + aria-labelledby, Escape and backdrop dismiss,
// initial focus, a Tab focus trap, focus restore on close and scroll lock.
export default function Modal({ title, children, footer, onClose, busy = false, size = 'md', initialFocusRef }: ModalProps) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const busyRef = useRef(busy)
  busyRef.current = busy
  // Only treat a click as a backdrop click if the press also started there,
  // so selecting text in an input and releasing outside doesn't close it.
  const pressedBackdrop = useRef(false)
  const centerRef = useRef<HTMLDivElement>(null)
  const isBackdrop = (target: EventTarget, overlay: EventTarget) => target === overlay || target === centerRef.current

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    const dialog = dialogRef.current
    const target = initialFocusRef?.current ?? dialog?.querySelector<HTMLElement>(FOCUSABLE) ?? dialog
    target?.focus()

    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (!busyRef.current) {
          e.preventDefault()
          onCloseRef.current()
        }
        return
      }
      if (e.key !== 'Tab' || !dialog) return
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (items.length === 0) {
        e.preventDefault()
        dialog.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (!dialog.contains(active)) {
        e.preventDefault()
        first.focus()
      } else if (e.shiftKey && (active === first || active === dialog)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = prevOverflow
      previouslyFocused?.focus?.()
    }
    // Mount-only: focus/trap setup must not re-run on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 overflow-y-auto"
      onMouseDown={(e) => { pressedBackdrop.current = isBackdrop(e.target, e.currentTarget) }}
      onClick={(e) => {
        if (pressedBackdrop.current && isBackdrop(e.target, e.currentTarget) && !busy) onClose()
        pressedBackdrop.current = false
      }}
    >
      <div ref={centerRef} className="min-h-full flex items-center justify-center p-4">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className={`w-full ${WIDTHS[size]} my-8 bg-white dark:bg-night-surface rounded-card border border-border dark:border-night-border p-6 flex flex-col gap-4 outline-none`}
        >
          <h3 id={titleId} className="font-display font-bold text-h4 text-ink-primary dark:text-night-text">
            {title}
          </h3>
          {children}
          {footer && <div className="flex justify-end gap-2 pt-2">{footer}</div>}
        </div>
      </div>
    </div>
  )
}
