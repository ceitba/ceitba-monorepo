// Calendar export primitives (.ics per RFC 5545 and Google Calendar links)
// shared by the scheduler's weekly classes and the newsletter's one-off
// events. Pure functions only: no Date-in-local-time math, so the result is
// the same whatever time zone the browser is in.
//
// Everything at ITBA happens in Buenos Aires wall time. Argentina is a fixed
// UTC-03:00 with no DST, so events are written with
// TZID=America/Argentina/Buenos_Aires plus a matching VTIMEZONE block.

export const CALENDAR_TIME_ZONE = 'America/Argentina/Buenos_Aires'
export const UTC_OFFSET_HOURS = -3

export interface CalendarDate {
  year: number
  month: number // 1-12
  day: number
}

export const pad = (n: number, width = 2) => String(n).padStart(width, '0')

// "YYYY-MM-DD" read as a calendar date (never through `new Date(str)`,
// which parses it as UTC midnight and shifts the day west of Greenwich).
export function parseCalendarDate(value: string | null | undefined): CalendarDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '')
  if (!match) return null
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
}

const parseTime = (time: string) => {
  const [h, m] = time.split(':').map(Number)
  return { h: h || 0, m: m || 0 }
}

// Local (floating) date-time: 20260309T080000
export const formatLocal = (d: CalendarDate, time: string) => {
  const { h, m } = parseTime(time)
  return `${d.year}${pad(d.month)}${pad(d.day)}T${pad(h)}${pad(m)}00`
}

export const formatUtcStamp = (date: Date) =>
  date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

// RFC 5545 §3.3.11 TEXT escaping.
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
}

// RFC 5545 §3.1: lines longer than 75 octets are folded with CRLF + space.
// Splits on UTF-8 byte length without cutting a multi-byte character.
export function foldLine(line: string): string {
  const encoder = new TextEncoder()
  const parts: string[] = []
  let current = ''
  let currentBytes = 0
  let limit = 75
  for (const char of line) {
    const bytes = encoder.encode(char).length
    if (currentBytes + bytes > limit) {
      parts.push(current)
      current = ''
      currentBytes = 0
      limit = 74 // continuation lines start with a space
    }
    current += char
    currentBytes += bytes
  }
  parts.push(current)
  return parts.join('\r\n ')
}

export const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  `TZID:${CALENDAR_TIME_ZONE}`,
  'BEGIN:STANDARD',
  'DTSTART:19700101T000000',
  'TZOFFSETFROM:-0300',
  'TZOFFSETTO:-0300',
  'TZNAME:-03',
  'END:STANDARD',
  'END:VTIMEZONE',
]

// The calendar envelope around the VEVENT lines: drops empty lines, folds
// long ones, CRLF line ends.
export function wrapCalendar(prodId: string, eventLines: string[]): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${prodId}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...VTIMEZONE,
    ...eventLines,
    'END:VCALENDAR',
  ]
  return lines.filter(Boolean).map(foldLine).join('\r\n') + '\r\n'
}

// One-off event on a date, Buenos Aires wall time.
export interface SingleEvent {
  uid: string
  title: string
  date: string // "YYYY-MM-DD"
  startTime: string // "HH:mm" or "HH:mm:ss"
  endTime: string
  location?: string
  description?: string
  url?: string
}

export function buildSingleEventIcs(event: SingleEvent, prodId: string, now: Date = new Date()): string | null {
  const date = parseCalendarDate(event.date)
  if (!date) return null
  return wrapCalendar(prodId, [
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${formatUtcStamp(now)}`,
    `SUMMARY:${escapeText(event.title)}`,
    `DTSTART;TZID=${CALENDAR_TIME_ZONE}:${formatLocal(date, event.startTime)}`,
    `DTEND;TZID=${CALENDAR_TIME_ZONE}:${formatLocal(date, event.endTime)}`,
    event.location ? `LOCATION:${escapeText(event.location)}` : '',
    event.description ? `DESCRIPTION:${escapeText(event.description)}` : '',
    event.url ? `URL:${event.url}` : '',
    'END:VEVENT',
  ])
}

// "Add to Google Calendar" link for a one-off event.
export function googleCalendarEventUrl(event: SingleEvent): string | null {
  const date = parseCalendarDate(event.date)
  if (!date) return null
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${formatLocal(date, event.startTime)}/${formatLocal(date, event.endTime)}`,
    ctz: CALENDAR_TIME_ZONE,
  })
  if (event.location) params.set('location', event.location)
  const details = [event.description, event.url].filter(Boolean).join('\n\n')
  if (details) params.set('details', details)
  return `https://calendar.google.com/calendar/render?${params}`
}

// Saves `ics` as a file download.
export function downloadIcs(ics: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
