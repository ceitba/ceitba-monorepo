import { useEffect, useRef } from 'react'

// Focuses `ref` when a dialog opens and gives focus back to whatever had it
// when it closes; Escape calls the latest onEscape without re-running this.
export function useDialogFocus(ref, onEscape) {
  const onEscapeRef = useRef(onEscape)
  onEscapeRef.current = onEscape
  useEffect(() => {
    const previous = document.activeElement
    const onKey = (e) => { if (e.key === 'Escape') onEscapeRef.current() }
    document.addEventListener('keydown', onKey)
    ref.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [ref])
}
