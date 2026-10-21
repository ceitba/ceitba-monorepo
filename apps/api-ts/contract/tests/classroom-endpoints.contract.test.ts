// Ports apps/api/src/test/java/org/ceitba/api/web/classroom/ClassroomEndpointsIT.java
// and ClassroomAvailabilityIT.java. ClassroomAvailabilityIT pins the clock at
// Monday 2026-09-21 10:30 ART; here commission dates are relative to the real
// ART today and the "now" case passes day=MONDAY&at=10:30 explicitly. The
// defaults-from-the-clock version is in-process: test/classroom/availability-clock.test.ts.
import { beforeEach, describe, expect, test } from 'bun:test';
import type { Sql } from 'postgres';
import { todayArt } from '../../test/itba/mockItba';
import { useServer } from '../support';

const api = useServer();

function plusMonths(d: string, n: number): string {
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7)) - 1 + n;
  const year = y + Math.floor(m / 12);
  const month = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(Math.min(Number(d.slice(8, 10)), last)).padStart(2, '0')}`;
}

async function commission(db: Sql, id: string, code: string, name: string, start: string, end: string,
  times: [string, string, string, string, string][]) {
  await db`INSERT INTO public.commission (id, subject_code, commission_name, course_start, course_end, enrolled_students, quota, subject_type)
           VALUES (${id}, ${code}, ${name}, ${start}, ${end}, 10, 30, 'SEMESTRAL')`;
  for (const [day, from, classroom, building, to] of times) {
    await db`INSERT INTO public.commission_time (course_id, day, hour_from, classroom, building, hour_to)
             VALUES (${id}, ${day}::day_of_week, ${from}::time, ${classroom}, ${building}, ${to}::time)`;
  }
}

describe('ClassroomEndpointsIT', () => {
  beforeEach(async () => {
    await api.db`DELETE FROM public.commission`;
    const today = todayArt();
    await commission(api.db, 'C-A', '93.12', 'A', plusMonths(today, -1), plusMonths(today, 1), [
      ['MONDAY', '14:00', '102T', 'SDT', '17:00'], ['WEDNESDAY', '09:00', '102T', 'SDT', '11:00'],
    ]);
    await commission(api.db, 'C-OL', '93.12', 'OL', plusMonths(today, -1), plusMonths(today, 1), [
      ['TUESDAY', '14:00', 'Virtual Asincrónico', 'Online', '17:00'],
    ]);
  });

  test('noFiltersGroupsByBuildingAndSkipsOnline', async () => {
    const r = await api.get('/v1/classrooms');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.json.SDT)).toBe(true);
    expect(r.json.Online).toBeUndefined();
    expect(r.text).toBe('{"SDT":[{"name":"102T","building":"SDT","day":"MONDAY","hourFrom":"14:00","hourTo":"17:00"},{"name":"102T","building":"SDT","day":"WEDNESDAY","hourFrom":"09:00","hourTo":"11:00"}]}');
  });

  test('statusOccupiedGroupsByDayAndBuilding', async () => {
    const r = await api.get('/v1/classrooms?status=occupied');
    expect(r.status).toBe(200);
    expect(r.json.MONDAY.SDT[0].classroom).toBe('102T');
    expect(r.json.WEDNESDAY.SDT[0].classroom).toBe('102T');
    expect(r.json.TUESDAY).toBeUndefined();
    expect(r.text).toBe('{"MONDAY":{"SDT":[{"classroom":"102T","building":"SDT","day":"MONDAY","hourFrom":"14:00","hourTo":"17:00"}]},"WEDNESDAY":{"SDT":[{"classroom":"102T","building":"SDT","day":"WEDNESDAY","hourFrom":"09:00","hourTo":"11:00"}]}}');
  });

  // Not in the IT: current_semester=false lists ended commissions too; a bad boolean is a 400.
  test('occupiedAllSemestersAndBadBoolean', async () => {
    await commission(api.db, 'C-OLD', '93.13', 'X', '2020-03-01', '2020-07-01', [['FRIDAY', '08:00:15.5', '7', 'SDF', '10:00']]);
    const all = await api.get('/v1/classrooms?status=occupied&current_semester=false');
    expect(all.json.FRIDAY.SDF[0].hourFrom).toBe('08:00:15.500');
    expect((await api.get('/v1/classrooms?status=occupied')).json.FRIDAY).toBeUndefined();
    expect((await api.get('/v1/classrooms?current_semester=maybe')).status).toBe(400);
  });

  test('byBuildingReturnsClassroomList', async () => {
    const r = await api.get('/v1/classrooms/building/SDT');
    expect(r.status).toBe(200);
    expect(r.json.length).toBe(2);
    expect((await api.get('/v1/classrooms/building/sdt')).json.length).toBe(2);
  });

  test('byDayReturnsActiveSchedulesOnly', async () => {
    const r = await api.get('/v1/classrooms/day/MONDAY');
    expect(r.status).toBe(200);
    expect(r.json.length).toBe(1);
    expect(r.json[0].day).toBe('MONDAY');
    expect(r.json[0].classroom).toBe('102T');
    expect(r.text).toBe('[{"classroom":"102T","building":"SDT","day":"MONDAY","hourFrom":"14:00","hourTo":"17:00"}]');
  });

  test('invalidDayReturns400', async () => {
    const r = await api.get('/v1/classrooms/day/funday');
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('ValidationError');
    expect(r.json.message).toBe("Validation failed for field 'day' with value 'funday': must be one of MONDAY..SUNDAY (case-insensitive)");
  });

  test('overlappingConflictDetected', async () => {
    const r = await api.post('/v1/classrooms/conflicts', { body: { classroom: '102T', building: 'SDT', day: 'MONDAY', hourFrom: '15:00', hourTo: '16:00' } });
    expect(r.status).toBe(200);
    expect(r.json.length).toBe(1);
  });

  test('touchingBoundariesDoNotConflict', async () => {
    const r = await api.post('/v1/classrooms/conflicts', { body: { classroom: '102T', building: 'SDT', day: 'MONDAY', hourFrom: '17:00', hourTo: '18:00' } });
    expect(r.status).toBe(200);
    expect(r.json.length).toBe(0);
  });

  test('invalidTimeOrderingReturns400', async () => {
    const r = await api.post('/v1/classrooms/conflicts', { body: { classroom: '102T', building: 'SDT', day: 'MONDAY', hourFrom: '18:00', hourTo: '17:00' } });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('ValidationError');
    expect(r.json.message).toBe("Validation failed for field 'hourFrom' with value '18:00': must be before hourTo");
  });

  // Not in the IT: the other conflict validations.
  test('conflictValidationMessages', async () => {
    const base = { classroom: 'x', building: 'SDT', day: 'monday', hourFrom: '9:00', hourTo: '10:00' };
    const time = await api.post('/v1/classrooms/conflicts', { body: base });
    expect(time.json.message).toBe("Validation failed for field 'hourFrom/hourTo' with value '9:00/10:00': must be HH:mm or HH:mm:ss");
    const day = await api.post('/v1/classrooms/conflicts', { body: { ...base, day: 'lunes', hourFrom: '09:00' } });
    expect(day.json.message).toBe("Validation failed for field 'day' with value 'lunes': must be a valid day-of-week name");
    const blank = await api.post('/v1/classrooms/conflicts', { body: { ...base, classroom: ' ' } });
    expect(blank.json.message).toBe('classroom: must not be blank');
    const ok = await api.post('/v1/classrooms/conflicts', { body: { ...base, classroom: '102t', building: 'sdt', hourFrom: '16:59:59', hourTo: '18:00' } });
    expect(ok.json.length).toBe(1);
  });
});

describe('ClassroomAvailabilityIT', () => {
  beforeEach(async () => {
    await api.db`DELETE FROM public.commission`;
    const today = todayArt();
    await commission(api.db, 'C-A', '93.12', 'A', plusMonths(today, -1), plusMonths(today, 1), [
      ['MONDAY', '09:00', '101', 'SDF', '11:00'],
      ['MONDAY', '14:00', '101', 'SDF', '23:00'],
      // Only busy on Wednesday: still a Monday candidate.
      ['WEDNESDAY', '09:00', '102', 'SDF', '11:00'],
      ['THURSDAY', '08:00', '7', 'SDT', '10:00'],
    ]);
    await commission(api.db, 'C-OL', '93.12', 'OL', plusMonths(today, -1), plusMonths(today, 1), [
      ['MONDAY', '14:00', 'Virtual Asincrónico', 'Online', '17:00'],
    ]);
    // Ended last month: neither part of the universe nor busy.
    await commission(api.db, 'C-OLD', '93.13', 'X', plusMonths(today, -5), plusMonths(today, -1), [
      ['MONDAY', '08:00', '999', 'SDR', '23:00'],
    ]);
  });

  test('anonymousGetsFreeRoomsForNowInArt', async () => {
    const r = await api.get('/v1/classrooms/availability?day=MONDAY&at=10:30');
    expect(r.status).toBe(200);
    expect(r.json.day).toBe('MONDAY');
    expect(r.json.at).toBe('10:30');
    expect(r.json.minMinutes).toBe(60);
    expect(r.json.buildings.map((b: { building: string }) => b.building)).toEqual(['SDF', 'SDT']);
    const sdf = r.json.buildings[0];
    expect(sdf.totalClassrooms).toBe(2);
    expect(sdf.freeNowCount).toBe(1);
    expect(sdf.classrooms[0]).toEqual({ classroom: '102', freeFrom: '08:00', freeUntil: '23:00', freeNow: true });
    expect(sdf.classrooms[1]).toEqual({ classroom: '101', freeFrom: '11:00', freeUntil: '14:00', freeNow: false });
    expect(r.json.buildings[1].freeNowCount).toBe(1);
    expect(r.text).toBe('{"day":"MONDAY","at":"10:30","minMinutes":60,"openFrom":"08:00","openUntil":"23:00","buildings":[{"building":"SDF","totalClassrooms":2,"freeNowCount":1,"classrooms":[{"classroom":"102","freeFrom":"08:00","freeUntil":"23:00","freeNow":true},{"classroom":"101","freeFrom":"11:00","freeUntil":"14:00","freeNow":false}]},{"building":"SDT","totalClassrooms":1,"freeNowCount":1,"classrooms":[{"classroom":"7","freeFrom":"08:00","freeUntil":"23:00","freeNow":true}]}]}');
  });

  test('explicitDayBuildingAndTime', async () => {
    const r = await api.get('/v1/classrooms/availability', { query: { day: 'wednesday', building: 'SDF', at: '10:00' } });
    expect(r.status).toBe(200);
    expect(r.json.day).toBe('WEDNESDAY');
    expect(r.json.buildings.length).toBe(1);
    expect(r.json.buildings[0].freeNowCount).toBe(1);
    expect(r.json.buildings[0].classrooms.map((c: { classroom: string }) => c.classroom)).toEqual(['101', '102']);
    expect(r.json.buildings[0].classrooms[1].freeFrom).toBe('11:00');
  });

  test('invalidDayReturns400', async () => {
    const r = await api.get('/v1/classrooms/availability', { query: { day: 'funday' } });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('ValidationError');
  });

  test('nonNumericMinMinutesReturns400', async () => {
    const r = await api.get('/v1/classrooms/availability', { query: { minMinutes: 'lots' } });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('BadRequest');
  });

  // Not in the IT: the other parameter errors and the default `at` of another day.
  test('parameterErrorsAndAnotherDayDefaults', async () => {
    const at = await api.get('/v1/classrooms/availability', { query: { at: '25:99' } });
    expect(at.json.message).toBe("Validation failed for field 'at' with value '25:99': must be HH:mm");
    const min = await api.get('/v1/classrooms/availability', { query: { minMinutes: 901 } });
    expect(min.json.message).toBe("Validation failed for field 'minMinutes' with value '901': must be between 1 and 900");
    const other = await api.get('/v1/classrooms/availability', { query: { day: 'SUNDAY' } });
    const sundayIsToday = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Argentina/Buenos_Aires', weekday: 'long' }).format(new Date()) === 'Sunday';
    if (!sundayIsToday) expect(other.json.at).toBe('08:00');
    expect(other.json.day).toBe('SUNDAY');
  });
});
