// The scheduler keys a commission by its name within a subject (selections,
// saved workspaces, shares, the class detail lookup), but ITBA's data can
// list two commissions of one subject under the same name:
//   - a year-long cohort that started in March next to the one starting now,
//   - consecutive bimester runs of an elective (14/09–23/10, 26/10–30/11),
//   - two same-term commissions with different timetables, of which SGA may
//     only show one.
// Keeping only the first one hid the second, and the first by start date is
// the older cohort, which a student can't join. Instead every commission is
// kept and colliding names get a suffix: the start date ("A (26/10)") when the
// starts tell them apart, else an ordinal ("M4 (2)"). The suffix doesn't
// depend on the UI language, so a saved selection keeps matching. `sga_name`
// keeps the name as ITBA sent it.
//
// Shared by the web scheduler and apps/mcp, so a saved workspace means the
// same commissions in both.

interface NamedSlot {
  day: string;
  time_from: string;
  time_to: string;
}

// What these helpers read of a commission (the web and MCP types both fit).
export interface NamedCommission {
  name: string;
  commission_id?: string;
  course_start?: string;
  course_end?: string;
  schedule: NamedSlot[];
  // Original SGA slots, present only while a correction is applied.
  sga_schedule?: NamedSlot[];
  sga_name?: string;
  name_conflict?: boolean;
}

const slotKey = (slots: NamedSlot[]): string =>
  slots
    .map(s => `${s.day} ${s.time_from.slice(0, 5)}-${s.time_to.slice(0, 5)}`)
    .sort()
    .join("|");

const sgaSlots = (c: NamedCommission): NamedSlot[] => c.sga_schedule ?? c.schedule;

// "YYYY-MM-DD" → "DD/MM" / "DD/MM/YYYY" without going through Date (no
// time zone shift).
const dayMonth = (date: string): string => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
export const formatDay = (date: string): string => `${dayMonth(date)}/${date.slice(0, 4)}`;

// Unknown dates (an older API) count as overlapping: better a needless
// warning than a missing one.
const datesOverlap = (a: NamedCommission, b: NamedCommission): boolean =>
  !a.course_start || !a.course_end || !b.course_start || !b.course_end ||
  (a.course_start <= b.course_end && b.course_start <= a.course_end);

// The SGA name a selected name stands for: the name without the suffix
// disambiguateCommissions may have added ("A (26/10)" / "M4 (2)" → "A" / "M4").
const sgaNameOf = (name: string): string => name.replace(/ \((\d{2}\/\d{2}|\d+)\)$/, "");

// A saved selection (workspace, share) names commissions. A name that no
// longer exists is matched by its SGA name: a bare "A" saved before its twin
// appeared stands for every commission now shown as "A (…)", and a suffixed
// "A (26/10)" whose twin has since left the term stands for the plain "A".
// Names with no match are dropped, and a selection with none left means
// "any" rather than nothing.
export function knownSelection(commissions: NamedCommission[], selected: string[]): string[] {
  if (selected.includes("any")) return selected;
  const names = new Set(commissions.map(c => c.name));
  const known = new Set<string>();
  selected.forEach(name => {
    if (names.has(name)) {
      known.add(name);
      return;
    }
    const sga = sgaNameOf(name);
    commissions.filter(c => (c.sga_name ?? c.name) === sga).forEach(c => known.add(c.name));
  });
  return known.size > 0 ? Array.from(known) : ["any"];
}

type Disambiguated<C> = C & Pick<NamedCommission, "sga_name" | "name_conflict">;

export function disambiguateCommissions<C extends NamedCommission>(commissions: C[]): Disambiguated<C>[] {
  // The same row twice (same ITBA id) is a true duplicate.
  const seenIds = new Set<string>();
  const unique = commissions.filter(c => {
    if (!c.commission_id) return true;
    if (seenIds.has(c.commission_id)) return false;
    seenIds.add(c.commission_id);
    return true;
  });

  const byName = new Map<string, C[]>();
  unique.forEach(c => {
    const group = byName.get(c.name);
    if (group) group.push(c);
    else byName.set(c.name, [c]);
  });

  const renamed = new Map<C, Disambiguated<C>>();
  byName.forEach((group, name) => {
    if (group.length < 2) return;
    // Compare the labels, not the dates: two cohorts starting on the same
    // day of different years would otherwise get the same "A (10/03)".
    const starts = group.map(c => c.course_start);
    const byDate = starts.every(Boolean) && new Set(starts.map(s => dayMonth(s!))).size === group.length;
    group.forEach((c, i) => {
      // Two commissions running at the same time under one name with
      // different SGA timetables: the data can't say which one is real.
      // Compared on the SGA slots, not the effective ones: an applied
      // student correction is not a second timetable.
      const conflicting = group.some(other =>
        other !== c && datesOverlap(c, other) && slotKey(sgaSlots(other)) !== slotKey(sgaSlots(c)));
      renamed.set(c, {
        ...c,
        name: byDate ? `${name} (${dayMonth(c.course_start!)})` : `${name} (${i + 1})`,
        sga_name: name,
        name_conflict: conflicting || undefined
      });
    });
  });
  return unique.map((c): Disambiguated<C> => renamed.get(c) ?? c);
}
