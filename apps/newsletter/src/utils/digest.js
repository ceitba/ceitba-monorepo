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

// Default auto-send slot for a week's issue: the later of the following
// Monday 12:00 ART (weekStart + 7 days, what the API schedules for auto
// drafts) and the next full hour from now, so it is never in the past.
export function defaultAutoSendInput(weekStart) {
  if (!weekStart) return ''
  const monday = `${addDaysISO(weekStart, 7)}T12:00`
  const nextHour = instantToArtInput(new Date(Math.floor(Date.now() / 3600000) * 3600000 + 3600000).toISOString())
  // Both are "YYYY-MM-DDTHH:mm" strings, so lexical order is chronological.
  return monday > nextHour ? monday : nextHour
}

// "YYYY-MM-DDTHH:mm" for the datetime-local `min` attribute (now, in ART).
export function nowArtInput() {
  return instantToArtInput(new Date().toISOString())
}

// True when an ISO instant is at or before now.
export function isPastInstant(instant) {
  const ms = Date.parse(instant)
  return !Number.isNaN(ms) && ms <= Date.now()
}

// "HH:mm:ss" → "HH:mm".
export function shortTime(value) {
  return value ? String(value).slice(0, 5) : ''
}

const KNOWN_ERRORS = new Set([
  'DIGEST_EXISTS', 'INVALID_WEEK_START', 'DIGEST_NOT_EDITABLE', 'DIGEST_EMPTY', 'EMAIL_NOT_ALLOWED', 'NETWORK_ERROR',
  'AUTO_SEND_IN_PAST', 'MAIL_DISABLED', 'MAIL_SENDER_NOT_CONNECTED',
])

// ApiError → translated message for the digest admin. `lang` formats the
// resume time of 429 MAIL_QUOTA_EXHAUSTED.
export function digestErrorMessage(err, t, fallbackKey = 'admin.digests.errors.generic', lang) {
  const code = err?.code
  if (code === 'MAIL_QUOTA_EXHAUSTED') {
    const when = err?.data?.resumeAt
    return when
      ? t('admin.digests.errors.MAIL_QUOTA_EXHAUSTED', { when: formatArtDateTime(when, lang) })
      : t('admin.digests.errors.MAIL_QUOTA_EXHAUSTED_noWhen')
  }
  if (KNOWN_ERRORS.has(code)) return t(`admin.digests.errors.${code}`)
  return t(fallbackKey)
}

// 0..1 → "42 %" (null → "—").
export function formatRate(rate, lang) {
  if (rate == null || Number.isNaN(rate)) return '—'
  return new Intl.NumberFormat(localeFor(lang), { style: 'percent', maximumFractionDigits: 1 }).format(rate)
}

// [{ hour: ISO, count }] (only hours with opens) → a continuous hourly
// series from the first to the last bucket, at most `maxHours` long. Opens
// after that window are folded into the last bar (flagged `folded`) rather
// than dropped.
export function hourlySeries(opensByHour, maxHours = 168) {
  if (!opensByHour?.length) return []
  const HOUR = 60 * 60 * 1000
  const byMs = new Map(opensByHour.map((h) => [Date.parse(h.hour), h.count]))
  const start = Math.min(...byMs.keys())
  const last = Math.max(...byMs.keys())
  const end = Math.min(last, start + (maxHours - 1) * HOUR)
  const out = []
  for (let ms = start; ms <= end; ms += HOUR) out.push({ hour: new Date(ms).toISOString(), count: byMs.get(ms) ?? 0 })
  if (last > end) {
    let tail = 0
    for (const [ms, count] of byMs) if (ms > end) tail += count
    const lastBar = out[out.length - 1]
    lastBar.count += tail
    lastBar.folded = true
  }
  return out
}

// How often the admin re-fetches while an issue is being sent.
export const SENDING_POLL_MS = 5000
