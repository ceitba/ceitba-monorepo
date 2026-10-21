// In-process port of ClassroomAvailabilityIT.anonymousGetsFreeRoomsForNowInArt
// (apps/api/src/test/java/org/ceitba/api/web/classroom/ClassroomAvailabilityIT.java):
// the defaults for `day` and `at` come from the ART clock, pinned here with a
// MutableClock at Monday 2026-09-21 10:30 ART. The explicit-parameter variant
// is black-box: contract/tests/classroom-endpoints.contract.test.ts.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { MutableClock } from '../../src/infra/clock';
import { testApp, type TestApp } from '../support/app';

let t: TestApp;
beforeAll(async () => {
  t = await testApp({ overrides: { clock: new MutableClock('2026-09-21T13:30:00Z') } });
  const seed = async (id: string, start: string, end: string, times: [string, string, string, string, string][]) => {
    await t.sql`INSERT INTO public.commission (id, subject_code, commission_name, course_start, course_end, enrolled_students, quota, subject_type)
                VALUES (${id}, '93.12', 'A', ${start}, ${end}, 0, 30, 'SEMESTRAL')`;
    for (const [day, from, room, b, to] of times) {
      await t.sql`INSERT INTO public.commission_time (course_id, day, hour_from, classroom, building, hour_to) VALUES (${id}, ${day}::day_of_week, ${from}::time, ${room}, ${b}, ${to}::time)`;
    }
  };
  await seed('C-A', '2026-08-21', '2026-10-21', [['MONDAY', '09:00', '101', 'SDF', '11:00'], ['MONDAY', '14:00', '101', 'SDF', '23:00'],
    ['WEDNESDAY', '09:00', '102', 'SDF', '11:00'], ['THURSDAY', '08:00', '7', 'SDT', '10:00']]);
  await seed('C-OL', '2026-08-21', '2026-10-21', [['MONDAY', '14:00', 'Virtual Asincrónico', 'Online', '17:00']]);
  await seed('C-OLD', '2026-04-21', '2026-08-21', [['MONDAY', '08:00', '999', 'SDR', '23:00']]);
}, 60_000);
afterAll(async () => { await t?.close(); });

test('anonymousGetsFreeRoomsForNowInArt', async () => {
  const r = await t.request('GET', '/v1/classrooms/availability');
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
});
