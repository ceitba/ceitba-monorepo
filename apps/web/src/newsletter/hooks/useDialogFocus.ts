import { useEffect, useRef, type RefObject } from 'react'

// Focuses `ref` when a dialog opens and gives focus back to whatever had it
// when it closes; Escape calls the latest onEscape without re-running this.
export function useDialogFocus(ref: RefObject<HTMLElement | null>, onEscape: () => void): void {
  const onEscapeRef = useRef(onEscape)
  onEscapeRef.current = onEscape
  useEffect(() => {
    const previous = document.activeElement
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onEscapeRef.current() }
    document.addEventListener('keydown', onKey)
    ref.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [ref])
}
