// service/classroom/ClassroomService + ClassroomAvailabilityService.

import type { Deps } from '../../deps';
import { withTx } from '../../db/client';
import { ValidationError } from '../../http/errors';
import { DAY_NAMES, javaEqualsIgnoreCase } from '../../lib/javaCompat';
import { ART, formatLocalDateTime } from '../../lib/time';
import { findActiveTimesOrdered, findAllTimesOrdered, type CommissionTime } from '../commission/repo';
import { availability, type ClassroomAvailabilityResponse } from './logic/availability';
import { pgTimeToString } from './logic/javaTimeText';

const ONLINE = 'Online';

/** ClassroomDto(name, building, day, hourFrom, hourTo) / ClassroomScheduleDto(classroom, building, day, hourFrom, hourTo). LocalTime.toString(). */
export interface ClassroomDto { name: string; building: string; day: string; hourFrom: string; hourTo: string }
export interface ClassroomScheduleDto { classroom: string; building: string; day: string; hourFrom: string; hourTo: string }

const toClassroomDto = (ct: CommissionTime): ClassroomDto =>
  ({ name: ct.classroom, building: ct.building, day: ct.day, hourFrom: pgTimeToString(ct.hourFrom), hourTo: pgTimeToString(ct.hourTo) });
const toScheduleDto = (ct: CommissionTime): ClassroomScheduleDto =>
  ({ classroom: ct.classroom, building: ct.building, day: ct.day, hourFrom: pgTimeToString(ct.hourFrom), hourTo: pgTimeToString(ct.hourTo) });

/** LocalTime of a `HH:mm:ss[.fff]` text in seconds (java.sql.Time: milliseconds). */
function seconds(t: string): number {
  const m = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?/.exec(t)!;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0) + Number(`0.${(m[4] ?? '').slice(0, 9) || '0'}`);
}

/** String.toUpperCase() (JVM default locale en_US). */
const upper = (s: string) => s.toLocaleUpperCase('en-US');

export class ClassroomService {
  constructor(private readonly deps: Deps) {}

  /** status=occupied -> {day: {building: [schedule]}}, else {building: [classroom]} (LinkedHashMaps). */
  getClassroomsWithFilters(status: string | null, currentSemester: boolean): Promise<Map<string, unknown>> {
    return withTx(this.deps.db, async (tx) => {
      if (status === 'occupied') {
        const rows = currentSemester ? await findActiveTimesOrdered(tx, this.deps.clock.today()) : await findAllTimesOrdered(tx);
        const out = new Map<string, Map<string, ClassroomScheduleDto[]>>();
        for (const ct of rows) {
          if (javaEqualsIgnoreCase(ONLINE, ct.building)) continue;
          let byBuilding = out.get(ct.day);
          if (!byBuilding) out.set(ct.day, (byBuilding = new Map()));
          let l = byBuilding.get(ct.building);
          if (!l) byBuilding.set(ct.building, (l = []));
          l.push(toScheduleDto(ct));
        }
        return out;
      }
      const out = new Map<string, ClassroomDto[]>();
      for (const ct of await findAllTimesOrdered(tx)) {
        if (javaEqualsIgnoreCase(ONLINE, ct.building)) continue;
        let l = out.get(ct.building);
        if (!l) out.set(ct.building, (l = []));
        l.push(toClassroomDto(ct));
      }
      return out;
    }, { readOnly: true });
  }

  getClassroomsByBuilding(building: string): Promise<ClassroomDto[]> {
    return withTx(this.deps.db, async (tx) =>
      (await findAllTimesOrdered(tx)).filter((ct) => javaEqualsIgnoreCase(ct.building, building)).map(toClassroomDto), { readOnly: true });
  }

  getClassroomsByDay(day: string): Promise<ClassroomScheduleDto[]> {
    const target = upper(day);
    if (!(DAY_NAMES as readonly string[]).includes(target)) throw new ValidationError('day', day, 'must be one of MONDAY..SUNDAY (case-insensitive)');
    return withTx(this.deps.db, async (tx) =>
      (await findActiveTimesOrdered(tx, this.deps.clock.today())).filter((ct) => ct.day === target).map(toScheduleDto), { readOnly: true });
  }

  findConflicts(classroom: string, building: string, day: string, hourFrom: string, hourTo: string): Promise<ClassroomScheduleDto[]> {
    const target = upper(day);
    if (!(DAY_NAMES as readonly string[]).includes(target)) throw new ValidationError('day', day, 'must be a valid day-of-week name');
    const norm = (s: string) => (s.length === 5 ? `${s}:00` : s);
    const iso = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d{1,9})?)?$/;
    if (!iso.test(norm(hourFrom)) || !iso.test(norm(hourTo))) {
      throw new ValidationError('hourFrom/hourTo', `${hourFrom}/${hourTo}`, 'must be HH:mm or HH:mm:ss');
    }
    const from = seconds(norm(hourFrom));
    const to = seconds(norm(hourTo));
    if (!(from < to)) throw new ValidationError('hourFrom', hourFrom, 'must be before hourTo');
    return withTx(this.deps.db, async (tx) =>
      (await findActiveTimesOrdered(tx, this.deps.clock.today()))
        .filter((ct) => ct.day === target)
        .filter((ct) => javaEqualsIgnoreCase(ct.classroom, classroom) && javaEqualsIgnoreCase(ct.building, building))
        // TimeOverlap: [a1, a2) overlaps [b1, b2) iff a1 < b2 AND b1 < a2.
        .filter((ct) => seconds(ct.hourFrom.slice(0, 12)) < to && from < seconds(ct.hourTo.slice(0, 12)))
        .map(toScheduleDto), { readOnly: true });
  }

  getAvailability(day: string | null, building: string | null, at: string | null, minMinutes: number | null): Promise<ClassroomAvailabilityResponse> {
    const now = this.deps.clock.now();
    const today = this.deps.clock.today();
    const time = formatLocalDateTime(now, this.deps.clock.zone ?? ART).slice(11, 16);
    const nowMinute = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
    return withTx(this.deps.db, async (tx) =>
      availability(await findActiveTimesOrdered(tx, today), today, nowMinute, day, building, at, minMinutes), { readOnly: true });
  }
}
