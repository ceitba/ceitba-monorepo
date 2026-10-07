// Transient feedback for actions that finished away from where the user is
// looking (saved, copied, export failed). One stack for the whole site,
// mounted once by the app Layout. Errors stay until dismissed; the rest
// leave on their own.
//   toast.success(t('saved'))   toast.error(t('exportFailed'))

export type ToastTone = 'success' | 'error' | 'info'
export interface ToastItem { id: number; tone: ToastTone; message: string }

let items: ToastItem[] = []
let nextId = 1
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function dismiss(id: number) {
  items = items.filter((i) => i.id !== id)
  emit()
}

function push(tone: ToastTone, message: string) {
  const id = nextId++
  items = [...items.slice(-2), { id, tone, message }]
  emit()
  if (tone !== 'error') setTimeout(() => dismiss(id), 4500)
  return id
}

export const toast = {
  success: (message: string) => push('success', message),
  error: (message: string) => push('error', message),
  info: (message: string) => push('info', message),
  dismiss,
}

export const subscribeToasts = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const toastSnapshot = () => items
