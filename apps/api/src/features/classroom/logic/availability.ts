// Port of service/classroom/ClassroomAvailabilityService ("Aulas libres"),
// as a pure function of the active commission_time rows and the clock's
// today / time of day (ART). See the Java class for the rules:
//   universe = every in-person (building, classroom) with an active row on any day;
//   30-minute slots, start floored and end ceiled; opening window 08:00-23:00;
//   free runs of >= minMinutes; a run in progress at `at` needs minMinutes left.

import { ValidationError } from '../../../http/errors';
import { DAY_NAMES, dayOfWeek, javaCompareStrings, javaEqualsIgnoreCase, javaIsBlank, javaTrim } from '../../../lib/javaCompat';

export const OPEN_FROM = 8 * 60;
export const OPEN_UNTIL = 23 * 60;
export const SLOT_MINUTES = 30;
export const DEFAULT_MIN_MINUTES = 60;
const OPEN_FROM_SLOT = OPEN_FROM / SLOT_MINUTES;
const OPEN_UNTIL_SLOT = OPEN_UNTIL / SLOT_MINUTES;
export const MAX_MIN_MINUTES = (OPEN_UNTIL_SLOT - OPEN_FROM_SLOT) * SLOT_MINUTES;

export interface BusyRow { day: string; classroom: string; building: string; hourFrom: string; hourTo: string }

export interface FreeClassroom { classroom: string; freeFrom: string; freeUntil: string; freeNow: boolean }
export interface BuildingAvailability { building: string; totalClassrooms: number; freeNowCount: number; classrooms: FreeClassroom[] }
export interface ClassroomAvailabilityResponse {
  day: string;
  at: string;
  minMinutes: number;
  openFrom: string;
  openUntil: string;
  buildings: BuildingAvailability[];
}

const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** Seconds of day (fractional) of a `HH:mm[:ss[.f]]` text. */
function secondOfDay(t: string): number {
  const m = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?/.exec(t)!;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0) + Number(`0.${m[4] ?? '0'}`);
}

/** minuteOfDay: hour*60 + minute, +1 when there are seconds (nanos ignored). */
function minuteOfDay(t: string): number {
  const m = /^(\d{2}):(\d{2})(?::(\d{2}))?/.exec(t)!;
  return Number(m[1]) * 60 + Number(m[2]) + (Number(m[3] ?? 0) > 0 ? 1 : 0);
}

/** "Online", "External", blank and any "Virtual ..." name (accents and case ignored) are not rooms. */
export function isVirtual(name: string | null): boolean {
  if (name === null || javaIsBlank(name)) return true;
  const n = javaTrim(name).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  return n === 'online' || n === 'external' || n.startsWith('virtual');
}

function parseDay(day: string): string {
  const u = javaTrim(day).toUpperCase();
  if (!(DAY_NAMES as readonly string[]).includes(u)) {
    throw new ValidationError('day', day, 'must be one of MONDAY..SUNDAY (case-insensitive)');
  }
  return u;
}

/** LocalTime.parse(at.trim()).truncatedTo(MINUTES), in minutes of day. */
function parseAt(at: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d{1,9})?)?$/.exec(javaTrim(at));
  if (!m) throw new ValidationError('at', at, 'must be HH:mm');
  return Number(m[1]) * 60 + Number(m[2]);
}

function freeRuns(busyTimes: BusyRow[], minSlots: number): [number, number][] {
  const busy = new Array<boolean>((24 * 60) / SLOT_MINUTES).fill(false);
  for (const ct of busyTimes) {
    const start = Math.floor(minuteOfDay(ct.hourFrom) / SLOT_MINUTES);
    // A class ending at midnight may be stored as 00:00: end <= start runs to the end of the day.
    const end = secondOfDay(ct.hourTo) > secondOfDay(ct.hourFrom) ? Math.ceil(minuteOfDay(ct.hourTo) / SLOT_MINUTES) : busy.length;
    for (let i = Math.max(start, 0); i < Math.min(end, busy.length); i++) busy[i] = true;
  }
  const runs: [number, number][] = [];
  let runStart = -1;
  for (let i = OPEN_FROM_SLOT; i <= OPEN_UNTIL_SLOT; i++) {
    const free = i < OPEN_UNTIL_SLOT && !busy[i];
    if (free && runStart < 0) runStart = i;
    else if (!free && runStart >= 0) {
      if (i - runStart >= minSlots) runs.push([runStart, i]);
      runStart = -1;
    }
  }
  return runs;
}

/**
 * availability(day, building, at, minMinutes). `rows` = findActiveOrdered(today);
 * `nowMinute` = LocalTime.now(clock) truncated to minutes.
 */
export function availability(rows: readonly BusyRow[], today: string, nowMinute: number,
  day: string | null, building: string | null, at: string | null, minMinutes: number | null): ClassroomAvailabilityResponse {
  const todayDow = DAY_NAMES[dayOfWeek(today) - 1]!;
  const target = day === null || javaIsBlank(day) ? todayDow : parseDay(day);
  const moment = at === null || javaIsBlank(at) ? (target === todayDow ? nowMinute : OPEN_FROM) : parseAt(at);
  const min = minMinutes === null ? DEFAULT_MIN_MINUTES : minMinutes;
  if (min < 1 || min > MAX_MIN_MINUTES) throw new ValidationError('minMinutes', min, `must be between 1 and ${MAX_MIN_MINUTES}`);

  // building -> classroom -> busy rows on the target day (TreeMaps: String.compareTo order).
  const universe = new Map<string, Map<string, BusyRow[]>>();
  for (const ct of rows) {
    if (isVirtual(ct.building) || isVirtual(ct.classroom)) continue;
    if (building !== null && !javaIsBlank(building) && !javaEqualsIgnoreCase(ct.building, javaTrim(building))) continue;
    let rooms = universe.get(ct.building);
    if (!rooms) universe.set(ct.building, (rooms = new Map()));
    let busy = rooms.get(ct.classroom);
    if (!busy) rooms.set(ct.classroom, (busy = []));
    if (ct.day === target) busy.push(ct);
  }

  const minSlots = Math.floor((min + SLOT_MINUTES - 1) / SLOT_MINUTES);
  const buildings: BuildingAvailability[] = [];
  for (const b of [...universe.keys()].sort(javaCompareStrings)) {
    const rooms = universe.get(b)!;
    const windows: FreeClassroom[] = [];
    for (const room of [...rooms.keys()].sort(javaCompareStrings)) {
      for (const [s, e] of freeRuns(rooms.get(room)!, minSlots)) {
        const from = s * SLOT_MINUTES;
        const until = e * SLOT_MINUTES;
        if (!(until > moment)) continue; // already over
        const freeNow = !(from > moment);
        // In progress: only the time left after `at` counts.
        if (freeNow && until - moment < min) continue;
        windows.push({ classroom: room, freeFrom: hhmm(from), freeUntil: hhmm(until), freeNow });
      }
    }
    windows.sort((x, y) => javaCompareStrings(x.freeFrom, y.freeFrom) || javaCompareStrings(x.freeUntil, y.freeUntil) || javaCompareStrings(x.classroom, y.classroom));
    buildings.push({ building: b, totalClassrooms: rooms.size, freeNowCount: windows.filter((w) => w.freeNow).length, classrooms: windows });
  }
  return { day: target, at: hhmm(moment), minMinutes: min, openFrom: hhmm(OPEN_FROM), openUntil: hhmm(OPEN_UNTIL), buildings };
}
