// java.time toString() forms (not Jackson's ISO formatters): LocalTime.toString()
// omits zero seconds ("09:00") and prints the fraction in groups of 3 digits;
// OffsetDateTime.toString() is LocalDateTime.toString() + offset ("Z").

import { formatOffsetDateTime, type Micros } from '../../../lib/time';

/** LocalTime.toString() of a `HH:mm[:ss[.fraction]]` text (as Postgres or a parser gives it). */
export function localTimeToString(text: string): string {
  const m = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/.exec(text);
  if (!m) throw new Error(`Not a LocalTime: ${text}`);
  const secs = m[3] ?? '00';
  const frac = (m[4] ?? '').replace(/0+$/, '');
  if (secs === '00' && frac === '') return `${m[1]}:${m[2]}`;
  if (frac === '') return `${m[1]}:${m[2]}:${secs}`;
  const groups = frac.length <= 3 ? 3 : frac.length <= 6 ? 6 : 9;
  return `${m[1]}:${m[2]}:${secs}.${frac.padEnd(groups, '0')}`;
}

/** Hibernate reads TIME through java.sql.Time: milliseconds only (truncated). Then LocalTime.toString(). */
export function pgTimeToString(pg: string): string {
  const m = /^(\d{2}:\d{2}(?::\d{2})?)(?:\.(\d+))?/.exec(pg);
  if (!m) throw new Error(`Not a TIME value: ${pg}`);
  return localTimeToString(m[2] ? `${m[1]}.${m[2].slice(0, 3)}` : m[1]!);
}

/** OffsetDateTime.toString() of an instant seen in `zone` (UTC prints `Z`). */
export function offsetDateTimeToString(us: Micros, zone = 'UTC'): string {
  const iso = formatOffsetDateTime(us, zone);
  const m = /^(\d{4,}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-]\d{2}:\d{2})$/.exec(iso)!;
  return `${m[1]}T${localTimeToString(m[2]!)}${m[3]}`;
}
