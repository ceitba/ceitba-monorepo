// Port of apps/api/src/main/java/org/ceitba/api/service/digest/DigestWeek.java.
//
// The covered week of an issue (Monday..Sunday) and the following week, whose
// events the issue announces. Events created during the covered week are
// announced too, whatever their date.

import {
  dayOfMonth, dayOfWeek, ES_DAYS_FULL, ES_MONTHS_FULL, isAfter, monthOf, plusDays, type LocalDate,
} from '../../../lib/javaCompat';
import { ART, zoneOffsetMinutes, type Micros } from '../../../lib/time';
import { DigestException } from './digestException';

export class DigestWeek {
  constructor(readonly weekStart: LocalDate) {
    if (weekStart == null || dayOfWeek(weekStart) !== 1) {
      throw new DigestException('INVALID_WEEK_START', `weekStart must be a Monday (YYYY-MM-DD), got ${weekStart ?? 'null'}`);
    }
  }

  static isMonday(d: LocalDate | null | undefined): boolean {
    return d != null && dayOfWeek(d) === 1;
  }

  /** The Monday of the week before the one `today` falls in. */
  static previousWeek(today: LocalDate): DigestWeek {
    const monday = plusDays(today, -(dayOfWeek(today) - 1));
    return new DigestWeek(plusDays(monday, -7));
  }

  weekEnd(): LocalDate { return plusDays(this.weekStart, 6); }
  eventsFrom(): LocalDate { return plusDays(this.weekStart, 7); }
  eventsTo(): LocalDate { return plusDays(this.weekStart, 13); }

  /**
   * [Monday 00:00, next Monday 00:00) ART: consecutive issues split created_at
   * with no gap or overlap. Micros of `weekStart.atStartOfDay(ART)`; Java's
   * OffsetDateTime carries -03:00 (format with formatOffsetDateTime(us, ART)).
   */
  announcedFrom(): Micros { return startOfDayArt(this.weekStart); }
  announcedTo(): Micros { return startOfDayArt(this.eventsFrom()); }

  /** An event after the next week, in the issue because it was announced in the covered one. */
  isLaterEvent(eventDate: LocalDate): boolean { return isAfter(eventDate, this.eventsTo()); }

  /** "5 al 11 de octubre", "29 de septiembre al 5 de octubre". */
  rangeLabel(): string { return range(this.weekStart, this.weekEnd()); }

  defaultSubject(): string { return `La semana en ITBA · ${this.rangeLabel()}`; }
}

/** LocalDate.atStartOfDay(ClockConfig.ZONE) as epoch micros. */
export function startOfDayArt(d: LocalDate): Micros {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  const utcMidnight = Date.UTC(y, m - 1, day) * 1000;
  // ART is UTC-3 (it had DST in 2007-2009): read the offset at about local midnight.
  const off = zoneOffsetMinutes(ART, utcMidnight + 3 * 3_600_000_000);
  return utcMidnight - off * 60_000_000;
}

export function range(from: LocalDate, to: LocalDate): string {
  if (monthOf(from) === monthOf(to)) return `${dayOfMonth(from)} al ${dayOfMonth(to)} de ${month(to)}`;
  return `${dayOfMonth(from)} de ${month(from)} al ${dayOfMonth(to)} de ${month(to)}`;
}

/** Month display name, FULL, es-AR, lower case. */
export function month(d: LocalDate): string {
  return ES_MONTHS_FULL[monthOf(d) - 1]!;
}

/** "lunes 13 de octubre" */
export function longDate(d: LocalDate): string {
  return `${ES_DAYS_FULL[dayOfWeek(d) - 1]} ${dayOfMonth(d)} de ${month(d)}`;
}
