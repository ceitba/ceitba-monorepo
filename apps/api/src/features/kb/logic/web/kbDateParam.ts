// Port of apps/api/src/main/java/org/ceitba/api/web/kb/admin/KbDateParam.java.
//
// from/to query parameters of the staff kb endpoints (ADMIN doc, "Date
// parameters"): a full ISO offset datetime, or a date-only YYYY-MM-DD in
// America/Argentina/Buenos_Aires where `from` is the start of that day and
// `to` the end of it (inclusive, ...T23:59:59.999999999). Anything else is a
// 400 ValidationError. Nanosecond precision and the given offset are kept.

import { ValidationError } from '../../../../http/errors';
import { jIsBlank } from '../javaString';
import { ART_ZONE, atZone, Odt, parseLocalDate } from '../odt';
import { javaTrim } from '../../../../lib/javaCompat';

export function from(value: string | null): Odt | null {
  return parse('from', value, false);
}

export function to(value: string | null): Odt | null {
  return parse('to', value, true);
}

export function parse(field: string, value: string | null, endOfDay: boolean): Odt | null {
  if (value == null || jIsBlank(value)) return null;
  const v = javaTrim(value);
  let out: Odt | null;
  if (v.length === 10) {
    const day = parseLocalDate(v);
    if (day == null) {
      out = null;
    } else {
      const local = Date.UTC(day.year, day.month - 1, day.day) / 1000;
      // atStartOfDay(zone), or plusDays(1).minusNanos(1) for the end of the day
      out = endOfDay ? atZone(local + 86400 - 1, 999_999_999, ART_ZONE) : atZone(local, 0, ART_ZONE);
    }
  } else {
    out = Odt.tryParse(v);
  }
  if (out == null) {
    throw new ValidationError(field, value, 'must be a date (YYYY-MM-DD) or an ISO datetime with offset (2026-07-11T00:00:00-03:00)');
  }
  return out;
}
