// Helpers for the weekly digest admin ("La semana en ITBA").
import { addDaysISO, formatDate, localeFor, parseLocalDate } from './dates'

export const ART_TIME_ZONE = 'America/Argentina/Buenos_Aires'

// Argentina has had a fixed UTC-3 offset with no DST since 2009, so the
// datetime-local <-> instant conversion can use a constant offset instead of
// a timezone library. Display still goes through Intl with the real zone.
const ART_OFFSET_MS = -3 * 60 * 60 * 1000

// ISO instant → "YYYY-MM-DDTHH:mm" wall-clock time in Buenos Aires, for
// <input type="datetime-local">. Empty string for null/invalid input.
export function instantToArtInput(instant) {
  if (!instant) return ''
  const ms = Date.parse(instant)
  if (Number.isNaN(ms)) return ''
  return new Date(ms + ART_OFFSET_MS).toISOString().slice(0, 16)
}

// "YYYY-MM-DDTHH:mm" (Buenos Aires wall clock) → ISO instant (UTC).
export function artInputToInstant(value) {
  if (!value) return null
  const ms = Date.parse(`${value}:00-03:00`)
  return Number.isNaN(ms) ? null : new Date(ms).toISOString()
}

// ISO instant → "lun 6 oct, 12:00" in Buenos Aires time.
export function formatArtDateTime(instant, lang) {
  if (!instant) return ''
  const d = new Date(instant)
  if (Number.isNaN(d.getTime())) return instant
  return d.toLocaleString(localeFor(lang), {
    timeZone: ART_TIME_ZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

// "29 sept – 5 oct 2026".
export function formatWeekRange(weekStart, weekEnd, lang) {
  const start = formatDate(weekStart, lang, { day: 'numeric', month: 'short' })
  const end = formatDate(weekEnd, lang, { day: 'numeric', month: 'short', year: 'numeric' })
  return `${start} – ${end}`
}

// Monday of the week containing `iso` ("YYYY-MM-DD").
export function mondayOf(iso) {
  const d = parseLocalDate(iso)
  if (!d) return null
  return addDaysISO(iso, -((d.getDay() + 6) % 7))
}

// Default auto-send slot for a week's issue: the following Monday 12:00 ART
// (weekStart + 7 days), matching what the API schedules for auto drafts.
export function defaultAutoSendInput(weekStart) {
  return weekStart ? `${addDaysISO(weekStart, 7)}T12:00` : ''
}

// "HH:mm:ss" → "HH:mm".
export function shortTime(value) {
  return value ? String(value).slice(0, 5) : ''
}

const KNOWN_ERRORS = new Set([
  'DIGEST_EXISTS', 'INVALID_WEEK_START', 'DIGEST_NOT_EDITABLE', 'EMAIL_NOT_ALLOWED', 'NETWORK_ERROR',
])

// ApiError → translated message for the digest admin.
export function digestErrorMessage(err, t, fallbackKey = 'admin.digests.errors.generic') {
  const code = err?.code
  if (KNOWN_ERRORS.has(code)) return t(`admin.digests.errors.${code}`)
  return t(fallbackKey)
}

// How often the admin re-fetches while an issue is being sent.
export const SENDING_POLL_MS = 5000
