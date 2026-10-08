// Transient feedback for actions that finished away from where the user is
// looking (saved, copied, export failed). One stack for the whole site,
// mounted once by the app Layout. Errors stay until dismissed; the rest
// leave on their own.
//   toast.success(t('saved'))   toast.error(t('exportFailed'))

export type ToastTone = 'success' | 'error' | 'info'
// Optional follow-up the user may want right away ("Ver mis guardados",
// "Deshacer"). Clicking it also dismisses the toast.
export interface ToastAction { label: string; onClick: () => void }
export interface ToastItem { id: number; tone: ToastTone; message: string; action?: ToastAction }

let items: ToastItem[] = []
let nextId = 1
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function dismiss(id: number) {
  items = items.filter((i) => i.id !== id)
  emit()
}

function push(tone: ToastTone, message: string, action?: ToastAction) {
  const id = nextId++
  items = [...items.slice(-2), { id, tone, message, action }]
  emit()
  // Toasts with an action stay a little longer so there's time to use it.
  if (tone !== 'error') setTimeout(() => dismiss(id), action ? 8000 : 4500)
  return id
}

export const toast = {
  success: (message: string, action?: ToastAction) => push('success', message, action),
  error: (message: string, action?: ToastAction) => push('error', message, action),
  info: (message: string, action?: ToastAction) => push('info', message, action),
  dismiss,
}

export const subscribeToasts = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const toastSnapshot = () => items
