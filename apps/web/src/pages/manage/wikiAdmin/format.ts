// Formatting helpers for the "Wiki IA" admin views.

export function usd(n: number | null | undefined, digits?: number): string {
  if (n == null || Number.isNaN(n)) return '—'
  // Sub-cent amounts (probes, small runs) keep 4 decimals so they don't
  // all read "0.01" / "0.00".
  let d = digits ?? (Math.abs(n) < 1 ? 4 : 2)
  if (n !== 0 && Math.abs(n) < 0.01) d = Math.max(d, 4)
  return `US$ ${n.toLocaleString('en-US', { minimumFractionDigits: Math.min(d, 2), maximumFractionDigits: d })}`
}

export function tokens(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k`
  return String(n)
}

export function pct(r: number | null | undefined, digits = 0): string {
  if (r == null || Number.isNaN(r)) return '—'
  return `${(r * 100).toFixed(digits)}%`
}

export function duration(start?: string | null, end?: string | null): string {
  if (!start) return '—'
  const ms = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime()
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return h < 48 ? `${h} h ${m % 60} min` : `${Math.round(h / 24)} d`
}

export function secs(n: number | null | undefined): string {
  if (n == null) return '—'
  return n < 60 ? `${Math.round(n)}s` : n < 3600 ? `${Math.round(n / 60)} min` : `${(n / 3600).toFixed(1)} h`
}

export function range(low: number | null | undefined, high: number | null | undefined): string {
  if (low == null || high == null) return '—'
  return `${usd(low, 2)} – ${usd(high, 2)}`
}

// "según las últimas N ejecuciones" / "estimado por el volumen de apuntes".
export function basisText(basis: string | null | undefined, runs: number | null | undefined, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (basis === 'history') return t('manage.wikiAi.forecast.basis.history', { count: runs ?? 0 })
  if (basis === 'corpus') return t('manage.wikiAi.forecast.basis.corpus')
  if (basis === 'blend') return t('manage.wikiAi.forecast.basis.blend', { count: runs ?? 0 })
  return ''
}

export function ago(iso: string | null | undefined, now: number, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (!iso) return '—'
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 60) return t('manage.wikiAi.progress.agoSec', { n: s })
  if (s < 3600) return t('manage.wikiAi.progress.agoMin', { n: Math.round(s / 60) })
  return t('manage.wikiAi.progress.agoH', { n: Math.round(s / 3600) })
}

export function elapsed(iso: string | null | undefined, now: number): string {
  if (!iso) return '—'
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  return h ? `${h} h ${m} min` : m ? `${m} min ${sec}s` : `${sec}s`
}

// "configKey" (plan@effort|write@effort) → "plan (effort) → write".
export function prettyConfig(key: string, plan?: string, write?: string): string {
  if (plan && write) return `${plan} → ${write}`
  const [p, w] = key.split('|')
  const fmt = (s?: string) => (s ? s.replace(/@(\w+)$/, ' ($1)') : '?')
  return w ? `${fmt(p)} → ${fmt(w)}` : key
}

export function ms(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  return n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${Math.round(n)} ms`
}

export function rate(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  return n.toFixed(n < 10 ? 1 : 0)
}
