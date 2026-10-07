// Calendar-date helpers.
//
// The API sends article/event dates as plain calendar dates ("YYYY-MM-DD",
// Java LocalDate). `new Date('YYYY-MM-DD')` parses those as UTC midnight,
// which in Argentina (UTC-3) is the previous day, and `toISOString()` gives
// the UTC date, which after 21:00 local is already tomorrow. Always go
// through these helpers instead.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

// "YYYY-MM-DD" → Date at local midnight. Full timestamps fall back to the
// native parser. Returns null for empty/invalid input.
export function parseLocalDate(value: string | Date | null | undefined): Date | null {
  if (value == null || value === '') return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const m = ISO_DATE.exec(String(value))
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

// Date → "YYYY-MM-DD" in local time.
export function toISODate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// Today's local date as "YYYY-MM-DD".
export function todayISO(): string {
  return toISODate(new Date())
}

// "YYYY-MM-DD" shifted by n days (local calendar arithmetic).
export function addDaysISO(iso: string, n: number): string {
  // Non-null: like before, an unparseable `iso` throws on the next line.
  const d = parseLocalDate(iso)!
  d.setDate(d.getDate() + n)
  return toISODate(d)
}

// First day of a month (month is 0-based, like Date#getMonth).
export function monthStartISO(year: number, month: number): string {
  return toISODate(new Date(year, month, 1))
}

// i18n language → BCP 47 locale used for formatting.
export function localeFor(lang: string | null | undefined): string {
  return String(lang ?? '').startsWith('en') ? 'en-US' : 'es-AR'
}

const DEFAULT_FORMAT: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' }

// Locale-aware formatting of a calendar date (or timestamp) in the given
// i18n language. Returns the raw value if it can't be parsed.
export function formatDate(
  value: string | null | undefined,
  lang: string | null | undefined,
  options: Intl.DateTimeFormatOptions = DEFAULT_FORMAT,
): string {
  const d = parseLocalDate(value)
  if (!d) return value ?? ''
  return d.toLocaleDateString(localeFor(lang), options)
}

// Weekday names starting on Sunday (matches Date#getDay), e.g. ['dom', …].
export function weekdayNames(
  lang: string | null | undefined,
  width: Intl.DateTimeFormatOptions['weekday'] = 'short',
): string[] {
  const fmt = new Intl.DateTimeFormat(localeFor(lang), { weekday: width })
  // 2023-01-01 was a Sunday.
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2023, 0, 1 + i)))
}
