// Calendar export (.ics file and Google Calendar links) for a generated
// schedule, on top of the shared primitives in @/utils/ics. Pure functions
// only: no Date-in-local-time math, so the result is the same whatever time
// zone the browser is in.
//
// Classes happen in Buenos Aires wall time. Argentina is a fixed UTC-03:00
// with no DST, so events are written with TZID=America/Argentina/Buenos_Aires
// plus a matching VTIMEZONE block, and the UNTIL of the weekly rule (which
// RFC 5545 requires in UTC when DTSTART has a TZID) is shifted by 3 hours.

import type { ScheduleSlot } from "../types/scheduler"
import { commissionLabel } from "../services/scheduler"
import {
  CALENDAR_TIME_ZONE, UTC_OFFSET_HOURS, escapeText, foldLine, formatLocal, formatUtcStamp, pad, parseCalendarDate,
  wrapCalendar, type CalendarDate,
} from "@/utils/ics"

export { escapeText, foldLine, parseCalendarDate }

export const CLASS_TIME_ZONE = CALENDAR_TIME_ZONE

export interface CalendarEvent {
  uid: string
  title: string
  day: string // MONDAY..SUNDAY
  startTime: string // "HH:mm" or "HH:mm:ss", Buenos Aires wall time
  endTime: string
  courseStart: string // "YYYY-MM-DD"
  courseEnd: string // "YYYY-MM-DD"
  location: string
  commission?: string
  description?: string
}

const DAY_INDEX: Record<string, number> = {
  SUNDAY: 0, MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3, THURSDAY: 4, FRIDAY: 5, SATURDAY: 6,
}

const toUtcMidnight = (d: CalendarDate) => Date.UTC(d.year, d.month - 1, d.day)

const fromUtcMs = (ms: number): CalendarDate => {
  const date = new Date(ms)
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }
}

// First date on or after `start` that falls on `dayName`. A class on the
// start date itself counts.
export function firstOccurrence(start: CalendarDate, dayName: string): CalendarDate | null {
  const target = DAY_INDEX[dayName.toUpperCase()]
  if (target === undefined) return null
  const weekday = new Date(toUtcMidnight(start)).getUTCDay()
  const daysUntil = (target - weekday + 7) % 7
  return fromUtcMs(toUtcMidnight(start) + daysUntil * 86_400_000)
}

// End of the course's last day in Buenos Aires, expressed in UTC.
const untilUtc = (end: CalendarDate) => {
  const ms = Date.UTC(end.year, end.month - 1, end.day, 23 - UTC_OFFSET_HOURS, 59, 59)
  const d = new Date(ms)
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}

const sanitizeUidPart = (value: string) => value.replace(/[^A-Za-z0-9.-]/g, "_")

// One event per subject/day/time; rooms of the same class are merged.
// `describe` provides the (translated) event description.
export function eventsFromSlots(
  slots: ScheduleSlot[],
  describe?: (slot: ScheduleSlot) => string,
): CalendarEvent[] {
  const grouped = new Map<string, CalendarEvent>()
  for (const slot of slots) {
    const key = `${slot.subject_id}-${slot.day}-${slot.timeFrom}-${slot.timeTo}`
    const existing = grouped.get(key)
    if (!existing) {
      grouped.set(key, {
        uid: [slot.subject_id, slot.commission, slot.day, slot.timeFrom.slice(0, 5)]
          .map(sanitizeUidPart)
          .join("-") + "@scheduler.ceitba.org.ar",
        title: `${slot.subject_id} - ${slot.subject}`,
        day: slot.day,
        startTime: slot.timeFrom,
        endTime: slot.timeTo,
        courseStart: slot.dateFrom,
        courseEnd: slot.dateTo,
        location: slot.classroom || "",
        commission: commissionLabel(slot),
        description: describe?.(slot),
      })
    } else if (slot.classroom && !existing.location.split(", ").includes(slot.classroom)) {
      existing.location = existing.location ? `${existing.location}, ${slot.classroom}` : slot.classroom
    }
  }
  return Array.from(grouped.values())
}

interface ResolvedEvent {
  first: CalendarDate
  end: CalendarDate | null
}

// Falls back to `today` when the course has no usable start date. Returns
// null when the first class would fall after the course end.
function resolveDates(event: CalendarEvent, today: CalendarDate): ResolvedEvent | null {
  const start = parseCalendarDate(event.courseStart) ?? today
  const end = parseCalendarDate(event.courseEnd)
  const first = firstOccurrence(start, event.day)
  if (!first) return null
  if (end && toUtcMidnight(first) > toUtcMidnight(end)) return null
  return { first, end }
}

const todayFrom = (now: Date): CalendarDate =>
  ({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() })

export function buildIcs(events: CalendarEvent[], now: Date = new Date()): string {
  const stamp = formatUtcStamp(now)
  const today = todayFrom(now)
  const lines: string[] = []
  for (const event of events) {
    const dates = resolveDates(event, today)
    if (!dates) continue
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.uid}`,
      `DTSTAMP:${stamp}`,
      `SUMMARY:${escapeText(event.title)}`,
      `DTSTART;TZID=${CLASS_TIME_ZONE}:${formatLocal(dates.first, event.startTime)}`,
      `DTEND;TZID=${CLASS_TIME_ZONE}:${formatLocal(dates.first, event.endTime)}`,
      dates.end ? `RRULE:FREQ=WEEKLY;UNTIL=${untilUtc(dates.end)}` : "",
      event.location ? `LOCATION:${escapeText(event.location)}` : "",
      event.description ? `DESCRIPTION:${escapeText(event.description)}` : "",
      "END:VEVENT",
    )
  }
  return wrapCalendar("-//CEITBA//Combinador de Horarios//ES", lines)
}

// "Add to Google Calendar" link for one recurring event. Times are passed
// as Buenos Aires wall time with ctz, so the browser's zone doesn't matter.
export function googleCalendarUrl(event: CalendarEvent, now: Date = new Date()): string | null {
  const dates = resolveDates(event, todayFrom(now))
  if (!dates) return null
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${formatLocal(dates.first, event.startTime)}/${formatLocal(dates.first, event.endTime)}`,
    ctz: CLASS_TIME_ZONE,
    location: event.location,
  })
  if (dates.end) params.set("recur", `RRULE:FREQ=WEEKLY;UNTIL=${untilUtc(dates.end)}`)
  if (event.description) params.set("details", event.description)
  return `https://calendar.google.com/calendar/render?${params}`
}
