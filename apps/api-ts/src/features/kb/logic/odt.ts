// java.time.OffsetDateTime with nanosecond precision: an instant (epoch second
// + nano) and the offset it was written with. equals() is Java's (same local
// date-time and offset); compareTo() is Java's (instant, then local date-time).
// toString() is OffsetDateTime.toString(): 2026-10-03T07:30Z, ...T10:30:00.5-03:00.

export const ART_ZONE = 'America/Argentina/Buenos_Aires';

const NANOS = 1_000_000_000;
const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export class Odt {
  private constructor(readonly epochSecond: number, readonly nano: number, readonly offsetSeconds: number) {}

  static ofEpoch(epochSecond: number, nano: number, offsetSeconds = 0): Odt {
    const carry = Math.floor(nano / NANOS);
    return new Odt(epochSecond + carry, nano - carry * NANOS, offsetSeconds);
  }

  /** Instant.ofEpochMilli at offset (UTC by default). */
  static ofEpochMilli(ms: number, offsetSeconds = 0): Odt {
    const sec = Math.floor(ms / 1000);
    return Odt.ofEpoch(sec, (ms - sec * 1000) * 1_000_000, offsetSeconds);
  }

  /** OffsetDateTime.parse(s) (ISO_OFFSET_DATE_TIME, strict dates). Throws DateTimeParseError. */
  static parse(s: string): Odt {
    const r = parseOffsetDateTime(s);
    if (r == null) throw new DateTimeParseError(s);
    return r;
  }

  static tryParse(s: string): Odt | null {
    return parseOffsetDateTime(s);
  }

  /** epoch milliseconds (truncated), like Instant.toEpochMilli(). */
  toEpochMilli(): number {
    return this.epochSecond * 1000 + Math.floor(this.nano / 1_000_000);
  }

  plusNanos(n: number): Odt {
    return Odt.ofEpoch(this.epochSecond, this.nano + n, this.offsetSeconds);
  }

  plusSeconds(s: number): Odt {
    return new Odt(this.epochSecond + s, this.nano, this.offsetSeconds);
  }

  plusMinutes(m: number): Odt {
    return this.plusSeconds(m * 60);
  }

  plusHours(h: number): Odt {
    return this.plusSeconds(h * 3600);
  }

  /** withOffsetSameInstant. */
  withOffset(offsetSeconds: number): Odt {
    return new Odt(this.epochSecond, this.nano, offsetSeconds);
  }

  isBefore(o: Odt): boolean {
    return this.compareInstant(o) < 0;
  }

  isAfter(o: Odt): boolean {
    return this.compareInstant(o) > 0;
  }

  /** isEqual(): same instant. */
  isEqual(o: Odt): boolean {
    return this.compareInstant(o) === 0;
  }

  compareInstant(o: Odt): number {
    if (this.epochSecond !== o.epochSecond) return this.epochSecond < o.epochSecond ? -1 : 1;
    return this.nano === o.nano ? 0 : this.nano < o.nano ? -1 : 1;
  }

  /** compareTo(): instant first, then local date-time (so different offsets are ordered). */
  compareTo(o: Odt): number {
    const c = this.compareInstant(o);
    if (c !== 0) return c;
    const l = this.epochSecond + this.offsetSeconds - (o.epochSecond + o.offsetSeconds);
    return l === 0 ? 0 : l < 0 ? -1 : 1;
  }

  /** equals(): same local date-time and same offset. */
  equals(o: Odt | null | undefined): boolean {
    return o != null && this.epochSecond === o.epochSecond && this.nano === o.nano && this.offsetSeconds === o.offsetSeconds;
  }

  /** Whole seconds from this to o (Duration.between(this, o).getSeconds(), floor). */
  secondsUntil(o: Odt): number {
    const d = (o.epochSecond - this.epochSecond) * NANOS + (o.nano - this.nano);
    return Math.floor(d / NANOS);
  }

  /** Duration.between(this, o).toMillis(). */
  millisUntil(o: Odt): number {
    const nanos = (o.epochSecond - this.epochSecond) * NANOS + (o.nano - this.nano);
    return Math.floor(nanos / 1_000_000);
  }

  /** Local fields at this offset. */
  local(): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
    const d = new Date((this.epochSecond + this.offsetSeconds) * 1000);
    return {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      second: d.getUTCSeconds(),
    };
  }

  toString(): string {
    const l = this.local();
    const y = l.year < 0 ? `-${pad(-l.year, 4)}` : l.year > 9999 ? `+${l.year}` : pad(l.year, 4);
    let s = `${y}-${pad(l.month)}-${pad(l.day)}T${pad(l.hour)}:${pad(l.minute)}`;
    if (l.second > 0 || this.nano > 0) {
      s += `:${pad(l.second)}`;
      if (this.nano > 0) {
        if (this.nano % 1_000_000 === 0) s += `.${pad(this.nano / 1_000_000, 3)}`;
        else if (this.nano % 1000 === 0) s += `.${pad(this.nano / 1000, 6)}`;
        else s += `.${pad(this.nano, 9)}`;
      }
    }
    return s + offsetId(this.offsetSeconds);
  }

  toJSON(): string {
    return this.toString();
  }
}

export class DateTimeParseError extends Error {
  constructor(readonly text: string) {
    super(`Text '${text}' could not be parsed`);
    this.name = 'DateTimeParseException';
  }
}

/** ZoneOffset.getId(): Z, +03:00, -03:00, +05:30:15. */
export function offsetId(total: number): string {
  if (total === 0) return 'Z';
  const sign = total < 0 ? '-' : '+';
  const a = Math.abs(total);
  const h = Math.floor(a / 3600);
  const m = Math.floor((a % 3600) / 60);
  const s = a % 60;
  return `${sign}${pad(h)}:${pad(m)}${s ? `:${pad(s)}` : ''}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** LocalDate.parse (ISO_LOCAL_DATE, STRICT): epoch day, or null. */
export function parseLocalDate(s: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

// ISO_OFFSET_DATE_TIME: date 'T' HH:mm[:ss[.f{1,9}]] offset (lenient: Z, +HH, +HHMM, +HH:MM, +HH:MM:SS).
function parseOffsetDateTime(s: string): Odt | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}(?::?\d{2}(?::?\d{2})?)?)$/.exec(s);
  if (!m) return null;
  const date = parseLocalDate(m[1]!);
  if (!date) return null;
  const hour = Number(m[2]);
  const minute = Number(m[3]);
  const second = m[4] ? Number(m[4]) : 0;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const nano = m[5] ? Number(m[5].padEnd(9, '0')) : 0;
  const off = parseOffset(m[6]!);
  if (off == null) return null;
  const local = Date.UTC(date.year, date.month - 1, date.day, hour, minute, second) / 1000;
  return Odt.ofEpoch(local - off, nano, off);
}

function parseOffset(s: string): number | null {
  if (s === 'Z') return 0;
  const sign = s[0] === '-' ? -1 : 1;
  const digits = s.slice(1).replace(/:/g, '');
  const h = Number(digits.slice(0, 2));
  const mi = digits.length >= 4 ? Number(digits.slice(2, 4)) : 0;
  const se = digits.length >= 6 ? Number(digits.slice(4, 6)) : 0;
  if (h > 18 || mi > 59 || se > 59) return null;
  const total = h * 3600 + mi * 60 + se;
  if (total > 18 * 3600) return null;
  return sign * total;
}

/** The zone's UTC offset (seconds) at an instant, from the platform's tz database. */
export function zoneOffsetAt(epochSecond: number, zone: string): number {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p = Object.fromEntries(f.formatToParts(new Date(epochSecond * 1000)).map((x) => [x.type, x.value]));
  const local = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) / 1000;
  return local - epochSecond;
}

/** A local date-time (as epoch seconds of the same wall clock in UTC) in a zone: ZonedDateTime.of(...).toOffsetDateTime(). */
export function atZone(localEpochSecond: number, nano: number, zone: string): Odt {
  let off = zoneOffsetAt(localEpochSecond, zone);
  off = zoneOffsetAt(localEpochSecond - off, zone);
  return Odt.ofEpoch(localEpochSecond - off, nano, off);
}

/** HH:mm of an instant in a zone (DateTimeFormatter.ofPattern("HH:mm") on atZoneSameInstant). */
export function formatHHmm(t: Odt, zone: string): string {
  const off = zoneOffsetAt(t.epochSecond, zone);
  const l = t.withOffset(off).local();
  return `${pad(l.hour)}:${pad(l.minute)}`;
}

/**
 * OffsetDateTime.now(clock) from the foundation clock's microseconds (src/infra/clock.ts):
 * at the zone's offset, like Java's ClockConfig clock (America/Argentina/Buenos_Aires).
 */
export function odtFromMicros(us: number, zone: string = ART_ZONE): Odt {
  const sec = Math.floor(us / 1_000_000);
  const nano = (us - sec * 1_000_000) * 1000;
  return Odt.ofEpoch(sec, nano, zoneOffsetAt(sec, zone));
}

/** A `now()` source: what the kb logic takes instead of java.time.Clock. */
export type Now = () => Odt;
