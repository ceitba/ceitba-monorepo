// Ports apps/api/src/test/java/org/ceitba/api/service/classroom/ClassroomAvailabilityServiceTest.java
// against the pure availability() (the Mockito repository becomes the row list;
// the fixed Clock becomes today + minute of day in ART).
import { beforeEach, describe, expect, test } from 'bun:test';
import { availability, type BuildingAvailability, type BusyRow, type ClassroomAvailabilityResponse } from '../../src/features/classroom/logic/availability';
import { ValidationError } from '../../src/http/errors';
import { formatLocalDateTime, ART } from '../../src/lib/time';

let rows: BusyRow[];
const busy = (building: string, classroom: string, day: string, from: string, to: string) =>
  rows.push({ building, classroom, day, hourFrom: `${from}:00`, hourTo: `${to}:00` });

/** service(now).availability(...): today and LocalTime.now(clock) in ART. */
function service(nowIso: string) {
  const local = formatLocalDateTime(Date.parse(nowIso) * 1000, ART);
  const today = local.slice(0, 10);
  const minute = Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16));
  return {
    today,
    availability: (day: string | null, building: string | null, at: string | null, min: number | null) => availability(rows, today, minute, day, building, at, min),
  };
}
const MONDAY_1030 = '2026-09-21T13:30:00Z';
const building = (r: ClassroomAvailabilityResponse, name: string) => r.buildings.find((b) => b.building === name)!;
const windows = (b: BuildingAvailability, room: string) =>
  b.classrooms.filter((c) => c.classroom === room).map((c) => `${c.freeFrom}-${c.freeUntil}${c.freeNow ? '*' : ''}`);

describe('ClassroomAvailabilityServiceTest', () => {
  beforeEach(() => { rows = []; });

  test('defaultsToTodayAndNowInArt', () => {
    const svc = service('2026-09-22T02:00:00Z');
    const r = svc.availability(null, null, null, null);
    expect(r.day).toBe('MONDAY');
    expect(r.at).toBe('23:00');
    expect(r.minMinutes).toBe(60);
    expect(r.openFrom).toBe('08:00');
    expect(r.openUntil).toBe('23:00');
    expect(svc.today).toBe('2026-09-21');
  });

  test('freeWindowsBetweenClassesWithTouchingBoundaries', () => {
    busy('SDF', '101', 'MONDAY', '08:00', '10:00');
    busy('SDF', '101', 'MONDAY', '12:00', '14:00');
    busy('SDF', '101', 'MONDAY', '18:00', '23:00');
    const svc = service(MONDAY_1030);
    const early = building(svc.availability('MONDAY', null, '07:00', null), 'SDF');
    expect(windows(early, '101')).toEqual(['10:00-12:00', '14:00-18:00']);
    expect(early.freeNowCount).toBe(0);
    const atTen = building(svc.availability('MONDAY', null, '10:00', null), 'SDF');
    expect(windows(atTen, '101')).toEqual(['10:00-12:00*', '14:00-18:00']);
    expect(atTen.freeNowCount).toBe(1);
    const atNoon = building(svc.availability('MONDAY', null, '12:00', null), 'SDF');
    expect(windows(atNoon, '101')).toEqual(['14:00-18:00']);
    expect(atNoon.freeNowCount).toBe(0);
    expect(windows(building(svc.availability(null, null, null, null), 'SDF'), '101')).toEqual(['10:00-12:00*', '14:00-18:00']);
  });

  test('windowInProgressNeedsMinMinutesLeftAfterAt', () => {
    busy('SDF', '101', 'MONDAY', '08:00', '10:00');
    busy('SDF', '101', 'MONDAY', '12:00', '14:00');
    busy('SDF', '101', 'MONDAY', '15:00', '23:00');
    const svc = service(MONDAY_1030);
    const at11 = building(svc.availability('MONDAY', null, '11:00', null), 'SDF');
    expect(windows(at11, '101')).toEqual(['10:00-12:00*', '14:00-15:00']);
    expect(at11.freeNowCount).toBe(1);
    const at1130 = building(svc.availability('MONDAY', null, '11:30', null), 'SDF');
    expect(windows(at1130, '101')).toEqual(['14:00-15:00']);
    expect(at1130.freeNowCount).toBe(0);
    expect(windows(building(svc.availability('MONDAY', null, '11:59', null), 'SDF'), '101')).toEqual(['14:00-15:00']);
    expect(windows(building(svc.availability('MONDAY', null, '11:30', 30), 'SDF'), '101')).toEqual(['10:00-12:00*', '14:00-15:00']);
  });

  test('windowsAreClampedToOpeningHours', () => {
    busy('SDT', 'A', 'MONDAY', '10:00', '11:00');
    busy('SDT', 'B', 'MONDAY', '07:00', '08:30');
    busy('SDT', 'B', 'MONDAY', '22:30', '23:59');
    const b = building(service(MONDAY_1030).availability('MONDAY', null, '07:00', null), 'SDT');
    expect(windows(b, 'A')).toEqual(['08:00-10:00', '11:00-23:00']);
    expect(windows(b, 'B')).toEqual(['08:30-22:30']);
  });

  test('shortGapsNeedMinMinutesAndOddTimesRoundOutward', () => {
    busy('SDR', '5', 'MONDAY', '08:00', '10:00');
    busy('SDR', '5', 'MONDAY', '10:30', '12:15');
    busy('SDR', '5', 'MONDAY', '13:45', '23:00');
    const svc = service(MONDAY_1030);
    expect(windows(building(svc.availability('MONDAY', null, '08:00', null), 'SDR'), '5')).toEqual(['12:30-13:30']);
    expect(windows(building(svc.availability('MONDAY', null, '08:00', 30), 'SDR'), '5')).toEqual(['10:00-10:30', '12:30-13:30']);
    expect(windows(building(svc.availability('MONDAY', null, '08:00', 90), 'SDR'), '5')).toEqual([]);
  });

  test('onlineExternalAndVirtualRowsAreExcluded', () => {
    busy('Online', 'Virtual Asincrónico', 'MONDAY', '08:00', '10:00');
    busy('External', 'Zoom', 'MONDAY', '08:00', '10:00');
    busy('SDF', 'Virtual Asincronico', 'MONDAY', '08:00', '10:00');
    busy('SDF', 'VIRTUAL SINCRÓNICO', 'TUESDAY', '08:00', '10:00');
    busy('SDF', '201', 'MONDAY', '08:00', '10:00');
    const r = service(MONDAY_1030).availability('MONDAY', null, '08:00', null);
    expect(r.buildings.map((b) => b.building)).toEqual(['SDF']);
    const sdf = building(r, 'SDF');
    expect(sdf.totalClassrooms).toBe(1);
    expect(new Set(sdf.classrooms.map((c) => c.classroom))).toEqual(new Set(['201']));
  });

  test('classroomBusyOnlyOnAnotherDayIsFreeAllDay', () => {
    busy('SDF', '301', 'TUESDAY', '09:00', '12:00');
    busy('SDF', '302', 'MONDAY', '08:00', '23:00');
    const sdf = building(service(MONDAY_1030).availability('MONDAY', null, '10:30', null), 'SDF');
    expect(sdf.totalClassrooms).toBe(2);
    expect(windows(sdf, '301')).toEqual(['08:00-23:00*']);
    expect(windows(sdf, '302')).toEqual([]);
    expect(sdf.freeNowCount).toBe(1);
  });

  test('anotherDayDefaultsAtToOpeningTime', () => {
    busy('SDF', '301', 'TUESDAY', '09:00', '12:00');
    const r = service(MONDAY_1030).availability('tuesday', null, null, null);
    expect(r.day).toBe('TUESDAY');
    expect(r.at).toBe('08:00');
    expect(windows(building(r, 'SDF'), '301')).toEqual(['08:00-09:00*', '12:00-23:00']);
  });

  test('sundayWithNoClassesListsEveryRoomFree', () => {
    busy('SDF', '101', 'MONDAY', '08:00', '10:00');
    busy('SDT', '7', 'FRIDAY', '08:00', '10:00');
    const r = service('2026-09-27T18:00:00Z').availability(null, null, null, null);
    expect(r.day).toBe('SUNDAY');
    expect(r.buildings.map((b) => b.building)).toEqual(['SDF', 'SDT']);
    for (const b of r.buildings) expect(b.freeNowCount).toBe(1);
    expect(windows(building(r, 'SDT'), '7')).toEqual(['08:00-23:00*']);
  });

  test('emptyScheduleReturnsNoBuildings', () => {
    expect(service(MONDAY_1030).availability(null, null, null, null).buildings).toEqual([]);
  });

  test('afterClosingNothingIsListed', () => {
    busy('SDF', '101', 'MONDAY', '08:00', '10:00');
    const sdf = building(service(MONDAY_1030).availability('MONDAY', null, '23:30', null), 'SDF');
    expect(sdf.classrooms).toEqual([]);
    expect(sdf.totalClassrooms).toBe(1);
  });

  test('buildingFilterIsCaseInsensitive', () => {
    busy('SDF', '101', 'MONDAY', '08:00', '10:00');
    busy('SDT', '7', 'MONDAY', '08:00', '10:00');
    expect(service(MONDAY_1030).availability('MONDAY', 'sdt', null, null).buildings.map((b) => b.building)).toEqual(['SDT']);
  });

  test('invalidParametersAreRejected', () => {
    const svc = service(MONDAY_1030);
    expect(() => svc.availability('funday', null, null, null)).toThrow(ValidationError);
    expect(() => svc.availability(null, null, '25:99', null)).toThrow(ValidationError);
    expect(() => svc.availability(null, null, null, 0)).toThrow(ValidationError);
    expect(() => svc.availability(null, null, null, 901)).toThrow(ValidationError);
  });
});
