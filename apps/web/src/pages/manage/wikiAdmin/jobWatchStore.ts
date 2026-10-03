// Tiny store for "tell me when it finishes" (kept dependency-free so
// ManagePage can show the Wiki IA tab badge without loading the admin
// chunk). Jobs (evals / pipeline runs) seen RUNNING are watched; when one
// finishes it becomes "unseen" until the admin opens that sub-view, and a
// toast is queued. Persisted in localStorage (best effort).

export type JobKind = 'eval' | 'run'

export interface WatchedJob {
  kind: JobKind
  id: string
  name: string
  state: 'active' | 'finished'
  // Browser notification opted in from the running job's page.
  notify?: boolean
  finalStatus?: string
  summary?: string
  seen?: boolean
}

export interface Toast {
  key: string
  kind: JobKind
  id: string
  text: string
  failed: boolean
}

const KEY = 'wikiAi.jobs'
let jobs: WatchedJob[] = read()
let toasts: Toast[] = []
let openRequest: { kind: JobKind; id: string } | null = null
const listeners = new Set<() => void>()

function read(): WatchedJob[] {
  try {
    const raw = localStorage.getItem(KEY)
    const list = raw ? (JSON.parse(raw) as WatchedJob[]) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function write() {
  try {
    // Keep it small: active jobs + the last 20 finished ones.
    const finished = jobs.filter((j) => j.state === 'finished').slice(-20)
    jobs = [...jobs.filter((j) => j.state === 'active'), ...finished]
    localStorage.setItem(KEY, JSON.stringify(jobs))
  } catch { /* storage blocked */ }
}

function emit() { listeners.forEach((fn) => fn()) }

export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export const getJobs = () => jobs
export const getToasts = () => toasts
export const getOpenRequest = () => openRequest

const find = (kind: JobKind, id: string) => jobs.find((j) => j.kind === kind && j.id === id)

export function markActive(kind: JobKind, id: string, name: string) {
  const j = find(kind, id)
  if (j && j.state === 'active' && j.name === name) return
  if (j && j.state === 'finished') return
  jobs = j ? jobs.map((x) => (x === j ? { ...x, name, state: 'active' } : x)) : [...jobs, { kind, id, name, state: 'active' }]
  write(); emit()
}

export function setNotify(kind: JobKind, id: string, notify: boolean) {
  jobs = jobs.map((j) => (j.kind === kind && j.id === id ? { ...j, notify } : j))
  write(); emit()
}

export function finish(kind: JobKind, id: string, finalStatus: string, summary: string, text: string, failed: boolean) {
  const j = find(kind, id)
  if (!j || j.state === 'finished') return
  jobs = jobs.map((x) => (x === j ? { ...x, state: 'finished', finalStatus, summary, seen: false } : x))
  toasts = [...toasts, { key: `${kind}:${id}`, kind, id, text, failed }]
  write(); emit()
  if (j.notify && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try { new Notification('CEITBA · Wiki IA', { body: text, tag: `${kind}:${id}` }) } catch { /* ignore */ }
  }
}

export function dismissToast(key: string) {
  toasts = toasts.filter((t) => t.key !== key)
  emit()
}

export function markSeen(kind: JobKind, id?: string) {
  let changed = false
  jobs = jobs.map((j) => {
    if (j.kind === kind && j.state === 'finished' && !j.seen && (!id || j.id === id)) { changed = true; return { ...j, seen: true } }
    return j
  })
  if (changed) { write(); emit() }
}

export const unseenCount = (kind?: JobKind) =>
  jobs.filter((j) => j.state === 'finished' && !j.seen && (!kind || j.kind === kind)).length

export const activeJobs = () => jobs.filter((j) => j.state === 'active')

// "ver resultados" from a toast: ManagePage / the section consume it.
export function requestOpen(kind: JobKind, id: string) {
  openRequest = { kind, id }
  markSeen(kind, id)
  emit()
}

export function consumeOpenRequest(): { kind: JobKind; id: string } | null {
  const r = openRequest
  openRequest = null
  return r
}
