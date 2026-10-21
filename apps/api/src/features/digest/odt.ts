// java.time.OffsetDateTime as the digest needs it: values parsed from a
// request keep their offset and nanoseconds until Hibernate writes them
// (Jackson prints the in-memory value), values read from the database are UTC
// with microseconds (docs/SERIALIZATION.md).

import { formatOffsetDateTime, zoneOffsetMinutes, type Micros } from '../../lib/time';

export interface Odt { epochSec: number; nanos: number; offsetMin: number }

export const odtFromMicros = (us: Micros, offsetMin = 0): Odt => {
  const epochSec = Math.floor(us / 1_000_000);
  return { epochSec, nanos: (us - epochSec * 1_000_000) * 1000, offsetMin };
};

/** The instant at `zone`'s offset (Instant.atZone(zone).toOffsetDateTime()). */
export const odtInZone = (us: Micros, zone: string): Odt => odtFromMicros(us, zoneOffsetMinutes(zone, us));

export const odtMicros = (o: Odt): Micros => o.epochSec * 1_000_000 + Math.floor(o.nanos / 1000);

/** ISO_OFFSET_DATE_TIME: seconds always, fraction (up to 9 digits) without trailing zeros. */
export function formatOdt(o: Odt): string {
  const base = formatOffsetDateTime((o.epochSec + o.offsetMin * 60) * 1_000_000, 'UTC').slice(0, 19);
  const frac = o.nanos === 0 ? '' : `.${String(o.nanos).padStart(9, '0').replace(/0+$/, '')}`;
  const a = Math.abs(o.offsetMin);
  const off = o.offsetMin === 0 ? 'Z' : `${o.offsetMin < 0 ? '-' : '+'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
  return base + frac + off;
}

/** What Hibernate binds: the full-precision text (Postgres rounds to microseconds). */
export const odtToPg = (o: Odt): string => formatOdt(o);

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** OffsetDateTime.parse (ISO_OFFSET_DATE_TIME, case-insensitive, lenient offset). null = DateTimeParseException. */
export function parseOdt(s: string): Odt | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}(?::?\d{2}(?::?\d{2})?)?)$/i.exec(s);
  if (!m) return null;
  const [y, mo, d, h, mi, se] = [1, 2, 3, 4, 5, 6].map((i) => Number(m[i] ?? 0)) as [number, number, number, number, number, number];
  if (mo < 1 || mo > 12 || h > 23 || mi > 59 || se > 59) return null;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  if (d < 1 || d > (mo === 2 && leap ? 29 : DAYS_IN_MONTH[mo - 1]!)) return null;
  let offsetSec = 0;
  const off = m[8]!.toUpperCase();
  if (off !== 'Z') {
    const om = /^([+-])(\d{2}):?(\d{2})?:?(\d{2})?$/.exec(off)!;
    const hh = Number(om[2]);
    const mm = Number(om[3] ?? 0);
    const ss = Number(om[4] ?? 0);
    if (hh > 18 || mm > 59 || ss > 59) return null;
    offsetSec = (om[1] === '-' ? -1 : 1) * (hh * 3600 + mm * 60 + ss);
    if (Math.abs(offsetSec) > 18 * 3600) return null;
  }
  const local = Date.UTC(y, mo - 1, d, h, mi, se) / 1000;
  return { epochSec: local - offsetSec, nanos: Number((m[7] ?? '').padEnd(9, '0') || 0), offsetMin: Math.trunc(offsetSec / 60) };
}

export const odtEqualsInstant = (a: Odt | null, b: Odt | null): boolean =>
  a == null || b == null ? a === b : a.epochSec === b.epochSec && a.nanos === b.nanos;
