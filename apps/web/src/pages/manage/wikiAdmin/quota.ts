import type { QuotaMeter } from '../../../api/kbAdmin'

// Helpers for the DigitalOcean quota card.

export const QUOTA_POLL_MS = 60_000

// Red when nothing is left or under 10%.
export function meterLow(m: QuotaMeter | null | undefined): boolean {
  if (!m || !(m.limit > 0)) return false
  return m.remaining <= 0 || m.remaining / m.limit < 0.1
}

export function meterPercent(m: QuotaMeter | null | undefined): number | null {
  if (!m || !(m.limit > 0)) return null
  return Math.max(0, Math.min(100, (m.remaining / m.limit) * 100))
}

// Exact count ("59,999").
export function count(n: number | null | undefined): string {
  return n == null ? '—' : n.toLocaleString('en-US')
}

// Run/eval progress lines that mention the quota ("cupo").
export function mentionsQuota(s: string | null | undefined): boolean {
  return !!s && /cupo|quota/i.test(s)
}
