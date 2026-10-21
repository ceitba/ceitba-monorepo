// java.time-compatible values and Jackson output (docs/SERIALIZATION.md).
//
// Instants are kept as integer MICROseconds since the epoch: Postgres
// timestamps have microsecond precision and Java's Instant.now() does too, and
// 2^53 us is year 2255, so a JS number holds them exactly.

export const ART = 'America/Argentina/Buenos_Aires';

export type Micros = number;

/** Wall-clock now in microseconds (performance.now() is sub-millisecond, like Instant.now()). */
export function systemNowMicros(): Micros {
  return Math.round((performance.timeOrigin + performance.now()) * 1000);
}

export const msToMicros = (ms: number): Micros => Math.round(ms * 1000);
export const microsToMs = (us: Micros): number => Math.floor(us / 1000);
export const microsToDate = (us: Micros): Date => new Date(microsToMs(us));

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

function splitMicros(us: Micros): { secs: number; micros: number } {
  const secs = Math.floor(us / 1_000_000);
  return { secs, micros: us - secs * 1_000_000 };
}

/** Fraction digits with trailing zeros stripped (DateTimeFormatter appendFraction(NANO, 0, 9)). */
function fractionStripped(micros: number): string {
  if (micros === 0) return '';
  return `.${pad(micros, 6).replace(/0+$/, '')}`;
}

/** Fraction in groups of 3 (ISO_INSTANT: zero, three, six or nine digits). */
function fractionGrouped(micros: number): string {
  if (micros === 0) return '';
  if (micros % 1000 === 0) return `.${pad(micros / 1000, 3)}`;
  return `.${pad(micros, 6)}`;
}

function utcFields(secs: number) {
  const d = new Date(secs * 1000);
  return {
    y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(),
    h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(),
  };
}

function yearStr(y: number): string {
  // ISO_LOCAL_DATE: 4 digits, +sign beyond 9999.
  if (y > 9999) return `+${y}`;
  if (y < 0) return `-${pad(-y, 4)}`;
  return pad(y, 4);
}

/** Jackson InstantSerializer (DateTimeFormatter.ISO_INSTANT): `2026-10-20T22:17:50.219Z`. */
export function formatInstant(us: Micros): string {
  const { secs, micros } = splitMicros(us);
  const f = utcFields(secs);
  return `${yearStr(f.y)}-${pad(f.mo)}-${pad(f.d)}T${pad(f.h)}:${pad(f.mi)}:${pad(f.s)}${fractionGrouped(micros)}Z`;
}

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

/** Offset of `zone` at the instant, in minutes east of UTC. */
export function zoneOffsetMinutes(zone: string, us: Micros): number {
  if (zone === 'UTC' || zone === 'Z' || zone === 'Etc/UTC') return 0;
  let fmt = offsetFormatters.get(zone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' });
    offsetFormatters.set(zone, fmt);
  }
  const part = fmt.formatToParts(microsToDate(us)).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(part);
  if (!m) return 0;
  const mins = Number(m[2]) * 60 + Number(m[3] ?? 0);
  return m[1] === '-' ? -mins : mins;
}

function offsetId(mins: number): string {
  if (mins === 0) return 'Z';
  const a = Math.abs(mins);
  return `${mins < 0 ? '-' : '+'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/**
 * Jackson OffsetDateTimeSerializer (ISO_OFFSET_DATE_TIME): seconds always
 * printed, fraction with trailing zeros stripped, `Z` for UTC.
 *
 * - Values READ FROM THE DATABASE (Hibernate TIMESTAMPTZ -> OffsetDateTime) are
 *   normalized to UTC: format them with zone 'UTC' (the default) -> `...Z`.
 * - Values COMPUTED in Java (`OffsetDateTime.now(clock)`, `now().plusDays(..)`)
 *   carry the JVM/clock zone (ART in production): pass `ART` -> `...-03:00`.
 */
export function formatOffsetDateTime(us: Micros, zone = 'UTC'): string {
  const off = zoneOffsetMinutes(zone, us);
  const local = us + off * 60_000_000;
  const { secs, micros } = splitMicros(local);
  const f = utcFields(secs);
  return `${yearStr(f.y)}-${pad(f.mo)}-${pad(f.d)}T${pad(f.h)}:${pad(f.mi)}:${pad(f.s)}${fractionStripped(micros)}${offsetId(off)}`;
}

/** Jackson LocalDateTimeSerializer (ISO_LOCAL_DATE_TIME) of the instant seen in `zone`. */
export function formatLocalDateTime(us: Micros, zone = 'UTC'): string {
  return formatOffsetDateTime(us, zone).replace(/(Z|[+-]\d{2}:\d{2})$/, '');
}

/** LocalDate of the instant in `zone` (`LocalDate.now(clock)`): `YYYY-MM-DD`. */
export function localDateOf(us: Micros, zone = ART): string {
  return formatOffsetDateTime(us, zone).slice(0, 10);
}

/**
 * Jackson LocalTimeSerializer for a Postgres TIME value. Hibernate reads TIME
 * through java.sql.Time, which keeps MILLISECONDS only (truncated), then
 * ISO_LOCAL_TIME prints HH:mm:ss plus the fraction without trailing zeros:
 * `09:00` -> `09:00:00`, `18:30:15.500` -> `18:30:15.5`, `23:59:59.999999` -> `23:59:59.999`.
 */
export function formatPgTime(pg: string | null | undefined): string | null {
  if (pg == null) return null;
  const m = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?/.exec(pg);
  if (!m) throw new Error(`Not a TIME value: ${pg}`);
  const ms = (m[4] ?? '').slice(0, 3).padEnd(3, '0');
  const frac = ms === '000' ? '' : `.${ms.replace(/0+$/, '')}`;
  return `${m[1]}:${m[2]}:${m[3] ?? '00'}${frac}`;
}

/**
 * Parses a Postgres timestamptz/timestamp text value into microseconds.
 * Accepts `2026-01-02 03:04:05.5+00`, `...+05:30`, ISO `T`/`Z` forms. A value
 * without offset (TIMESTAMP WITHOUT TIME ZONE) is read as UTC unless `zone` is given.
 */
export function parsePgTimestamp(pg: string, zone = 'UTC'): Micros {
  const m = /^(\d{4,})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?(Z|[+-]\d{2}(?::?\d{2})?(?::?\d{2})?)?( BC)?$/.exec(pg.trim());
  if (!m) {
    if (pg === 'infinity' || pg === '-infinity') throw new Error(`Unsupported timestamp ${pg}`);
    const t = Date.parse(pg);
    if (Number.isNaN(t)) throw new Error(`Not a timestamp: ${pg}`);
    return msToMicros(t);
  }
  const base = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0));
  const micros = Number((m[7] ?? '').padEnd(6, '0') || 0);
  let us = base * 1000 + micros;
  const off = m[8];
  if (off === undefined) {
    us -= zoneOffsetMinutes(zone, us) * 60_000_000;
  } else if (off !== 'Z') {
    const om = /^([+-])(\d{2}):?(\d{2})?:?(\d{2})?$/.exec(off)!;
    const secs = Number(om[2]) * 3600 + Number(om[3] ?? 0) * 60 + Number(om[4] ?? 0);
    us -= (om[1] === '-' ? -secs : secs) * 1_000_000;
  }
  return us;
}

/** Accepts a Postgres text timestamp, a Date or micros. */
export function toMicros(v: string | Date | Micros): Micros {
  if (typeof v === 'number') return v;
  if (v instanceof Date) return msToMicros(v.getTime());
  return parsePgTimestamp(v);
}

/** For binding: an ISO string Postgres parses losslessly (microseconds, UTC). */
export function toPgTimestamp(us: Micros): string {
  return formatOffsetDateTime(us, 'UTC');
}

/**
 * Parses an ISO-8601 OffsetDateTime/Instant as Jackson accepts it in request
 * bodies (`2026-03-01T00:00:00Z`, `...-03:00`, fractional seconds up to 9 digits).
 */
export function parseIsoInstant(s: string): Micros | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2}(?::\d{2})?|[+-]\d{2}(?:\d{2})?)$/i.exec(s);
  if (!m) return null;
  const base = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0));
  if (Number.isNaN(base)) return null;
  const micros = Number((m[7] ?? '').slice(0, 6).padEnd(6, '0') || 0);
  let us = base * 1000 + micros;
  const off = m[8]!.toUpperCase();
  if (off !== 'Z') {
    const om = /^([+-])(\d{2}):?(\d{2})?:?(\d{2})?$/.exec(off)!;
    const secs = Number(om[2]) * 3600 + Number(om[3] ?? 0) * 60 + Number(om[4] ?? 0);
    us -= (om[1] === '-' ? -secs : secs) * 1_000_000;
  }
  return us;
}

/** java.time.Instant.toString() of an epoch-second value (JWT messages). */
export function instantOfEpochSecond(secs: number): string {
  return formatInstant(secs * 1_000_000);
}

/**
 * OffsetDateTime.toString() of a UTC value (what a ValidationException message
 * shows): unlike Jackson's ISO_OFFSET_DATE_TIME, the seconds are omitted when
 * they and the fraction are zero, and the fraction is in groups of 3 digits.
 */
export function offsetDateTimeToString(us: Micros): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const secs = Math.floor(us / 1_000_000);
  const micros = us - secs * 1_000_000;
  const d = new Date(secs * 1000);
  let out = `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  if (d.getUTCSeconds() > 0 || micros > 0) {
    out += `:${pad(d.getUTCSeconds())}`;
    if (micros > 0) out += micros % 1000 === 0 ? `.${pad(micros / 1000, 3)}` : `.${pad(micros, 6)}`;
  }
  return `${out}Z`;
}
