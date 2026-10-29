import type { Difficulty, Period, Review } from '../../../api/reviews'

// Pure helpers for the Opiniones tab: no fetches, no React.

export interface Term { year: number; period: Period }

export const termKey = (t: Term) => `${t.year}-${t.period}`

export function parseTermKey(key: string): Term {
  const [y, p] = key.split('-')
  return { year: Number(y), period: (Number(p) === 2 ? 2 : 1) as Period }
}

// Newest first.
export const compareTerms = (a: Term, b: Term) => b.year - a.year || b.period - a.period

// The term running today in Argentina: January–July is the first, August–
// December the second (summer courses count as the first).
export function currentTerm(now = new Date()): Term {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(now)
  const year = Number(parts.find((p) => p.type === 'year')?.value)
  const month = Number(parts.find((p) => p.type === 'month')?.value)
  return { year, period: month <= 7 ? 1 : 2 }
}

// The current term and the `count - 1` before it, newest first.
export function recentTerms(count = 4, now = new Date()): Term[] {
  const out: Term[] = []
  let t = currentTerm(now)
  for (let i = 0; i < count; i++) {
    out.push(t)
    t = t.period === 2 ? { year: t.year, period: 1 } : { year: t.year - 1, period: 2 }
  }
  return out
}

export const sameTerm = (a: Term, b: Term) => a.year === b.year && a.period === b.period

export const normCommission = (c: string) => c.trim().toUpperCase()

// Counts, never percentages, and a difficulty word from the rounded average.
export interface Stats { n: number; recommends: number; difficulty: Difficulty | null }

export function stats(list: Review[]): Stats {
  const n = list.length
  if (n === 0) return { n, recommends: 0, difficulty: null }
  const avg = list.reduce((s, x) => s + x.difficulty, 0) / n
  return {
    n,
    recommends: list.filter((x) => x.recommend).length,
    difficulty: avg >= 2.5 ? 3 : avg >= 1.5 ? 2 : 1,
  }
}

// Names joined the way the language does it: "García y Benítez",
// "García, Benítez y Quiroga" / "García and Benítez".
export function joinNames(names: string[], lang: string): string {
  if (names.length <= 1) return names[0] ?? ''
  return new ListFormat(lang === 'en' ? 'en-US' : 'es-AR', { type: 'conjunction' }).format(names)
}

// Intl.ListFormat is ES2021; the app's TS lib predates it (every supported
// browser has it).
const ListFormat = (Intl as unknown as {
  ListFormat: new (locale: string, opts: { type: 'conjunction' }) => { format: (list: string[]) => string }
}).ListFormat

// The professors other students reported for a commission in a term, most
// reported first. A team (theory + practice) shows up as several entries.
export function reportedTeam(reviews: Review[], commission: string, term: Term): { id: string; reports: number }[] {
  const c = normCommission(commission)
  if (!c) return []
  const counts = new Map<string, number>()
  for (const x of reviews) {
    if (x.mine || normCommission(x.commission) !== c || !sameTerm(x, term)) continue
    for (const id of x.professorIds) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return [...counts.entries()].map(([id, reports]) => ({ id, reports })).sort((a, b) => b.reports - a.reports)
}

// What to pre-select: the professors more than one other student named (a
// one-off mention is more likely a stand-in or a mistake), or the only one
// reported.
export function suggestedProfessors(reviews: Review[], commission: string, term: Term): string[] {
  const team = reportedTeam(reviews, commission, term)
  return team.filter((p) => p.reports > 1 || team.length === 1).map((p) => p.id)
}

// Distinct values, in a stable order (commissions compared as "A" = " a").
export function uniqueCommissions(reviews: Review[]): string[] {
  return [...new Set(reviews.map((x) => normCommission(x.commission)))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
}

export function uniqueTerms(reviews: Review[]): Term[] {
  const seen = new Map<string, Term>()
  for (const x of reviews) seen.set(termKey(x), { year: x.year, period: x.period })
  return [...seen.values()].sort(compareTerms)
}
