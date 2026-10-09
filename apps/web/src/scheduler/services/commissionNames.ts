import type { Commission, CommissionSchedule } from '../types/scheduler'

// The scheduler keys a commission by its name within a subject (selections,
// saved workspaces, shares, the class detail lookup), but ITBA's data can
// list two commissions of one subject under the same name:
//   - a year-long cohort that started in March next to the one starting now,
//   - consecutive bimester runs of an elective (14/09–23/10, 26/10–30/11),
//   - two same-term commissions with different timetables, of which SGA may
//     only show one.
// Keeping only the first one (what this used to do) hid the second, and the
// first by start date is the older cohort, which a student can't join.
// Instead every commission is kept and colliding names get a suffix: the
// start date ("A (26/10)") when the starts tell them apart, else an ordinal
// ("M4 (2)"). The suffix doesn't depend on the UI language, so a saved
// selection keeps matching. `sga_name` keeps the name as ITBA sent it.

const slotKey = (slots: CommissionSchedule[]): string =>
  slots
    .map((s) => `${s.day} ${s.time_from.slice(0, 5)}-${s.time_to.slice(0, 5)}`)
    .sort()
    .join('|')

// "YYYY-MM-DD" → "DD/MM" without going through Date (no time zone shift).
const dayMonth = (date: string): string => `${date.slice(8, 10)}/${date.slice(5, 7)}`

// Unknown dates (an older API) count as overlapping: better a needless
// warning than a missing one.
const datesOverlap = (a: Commission, b: Commission): boolean =>
  !a.course_start || !a.course_end || !b.course_start || !b.course_end ||
  (a.course_start <= b.course_end && b.course_start <= a.course_end)

// A saved selection (workspace, share) names commissions; names that no
// longer exist (a commission now carries a suffix, or left the catalog) are
// dropped, and a selection with none left means "any" rather than nothing.
export function knownSelection(commissions: Commission[], selected: string[]): string[] {
  if (selected.includes('any')) return selected
  const names = new Set(commissions.map((c) => c.name))
  const known = selected.filter((name) => names.has(name))
  return known.length > 0 ? known : ['any']
}

export function disambiguateCommissions(commissions: Commission[]): Commission[] {
  // The same row twice (same ITBA id) is a true duplicate.
  const seenIds = new Set<string>()
  const unique = commissions.filter((c) => {
    if (!c.commission_id) return true
    if (seenIds.has(c.commission_id)) return false
    seenIds.add(c.commission_id)
    return true
  })

  const byName = new Map<string, Commission[]>()
  unique.forEach((c) => byName.set(c.name, [...(byName.get(c.name) ?? []), c]))

  const renamed = new Map<Commission, Commission>()
  byName.forEach((group, name) => {
    if (group.length < 2) return
    const starts = group.map((c) => c.course_start)
    const byDate = starts.every(Boolean) && new Set(starts).size === group.length
    group.forEach((c, i) => {
      // Two commissions running at the same time under one name with
      // different timetables: the data can't say which one is real.
      const conflicting = group.some((other) =>
        other !== c && datesOverlap(c, other) && slotKey(other.schedule) !== slotKey(c.schedule))
      renamed.set(c, {
        ...c,
        name: byDate ? `${name} (${dayMonth(c.course_start!)})` : `${name} (${i + 1})`,
        sga_name: name,
        name_conflict: conflicting || undefined,
      })
    })
  })
  return unique.map((c) => renamed.get(c) ?? c)
}
