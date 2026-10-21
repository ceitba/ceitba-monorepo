// Ports apps/api/src/test/java/org/ceitba/api/web/commission/CommissionsIT.java.
// The IT pins the clock at 2026-09-21 ART; dates here are relative to the real
// ART today (same offsets: minusMonths/plusMonths computed on today). The
// @MockBean ItbaApiClient + verifyNoInteractions becomes a mock gateway that
// must see no request.
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import type { Sql } from 'postgres';
import { startMockItba, todayArt } from '../../test/itba/mockItba';
import { useServer } from '../support';

const itba = startMockItba();
const api = useServer({ env: itba.env });
afterAll(() => itba.stop());

/** LocalDate.plusMonths / plusDays on `YYYY-MM-DD` (end-of-month clamped like java.time). */
function plusMonths(d: string, n: number): string {
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7)) - 1 + n;
  const year = y + Math.floor(m / 12);
  const month = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(Number(d.slice(8, 10)), last);
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
const plusDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function commission(db: Sql, id: string, code: string, name: string, start: string, end: string, enrolled: number, quota: number, type: string) {
  await db`INSERT INTO public.commission (id, subject_code, commission_name, course_start, course_end, enrolled_students, quota, subject_type)
           VALUES (${id}, ${code}, ${name}, ${start}, ${end}, ${enrolled}, ${quota}, ${type}::subject_type)`;
}
async function time(db: Sql, id: string, day: string, from: string, classroom: string, building: string, to: string) {
  await db`INSERT INTO public.commission_time (course_id, day, hour_from, classroom, building, hour_to)
           VALUES (${id}, ${day}::day_of_week, ${from}::time, ${classroom}, ${building}, ${to}::time)`;
}

let TODAY: string;

describe('CommissionsIT', () => {
  beforeEach(async () => {
    TODAY = todayArt();
    itba.reset();
    await api.db`DELETE FROM public.commission`;
    await api.db`DELETE FROM public.plan_subject`;
    await api.db`DELETE FROM public.subject`;
    await api.db`INSERT INTO public.subject (id, name, credits, updated_at) VALUES ('93.12', 'Análisis Matemático I', 6, now()), ('72.07', 'Protocolos de Comunicación', 6, now())`;
    await api.db`INSERT INTO public.plan_subject (subject_id, plan_id, section, year, semester, credits_required, dependencies) VALUES
      ('93.12', 'S10-Rev23', 'Ciclo Básico', 1, 1, 0, '{}'), ('72.07', 'S10-Rev23', 'Ciclo Profesional', 3, 2, 0, '{}'), ('99.99', 'OTHER', 'Ciclo Básico', 1, 1, 0, '{}')`;
    await commission(api.db, 'C-93-A', '93.12', 'A', plusMonths(TODAY, -1), plusMonths(TODAY, 2), 25, 40, 'SEMESTRAL');
    await time(api.db, 'C-93-A', 'WEDNESDAY', '09:00', '101', 'SDF', '11:00');
    await time(api.db, 'C-93-A', 'MONDAY', '14:00', '102', 'SDF', '16:00');
    // Ends today: still current.
    await commission(api.db, 'C-72-S', '72.07', 'S', plusMonths(TODAY, -4), TODAY, 10, 20, 'ANNUAL');
    // Ended yesterday: excluded.
    await commission(api.db, 'C-93-OLD', '93.12', 'Z', plusMonths(TODAY, -6), plusDays(TODAY, -1), 5, 30, 'SEMESTRAL');
    // Other plan's subject: excluded.
    await commission(api.db, 'C-99', '99.99', 'A', plusMonths(TODAY, -1), plusMonths(TODAY, 1), 5, 30, 'SEMESTRAL');
  });

  test('anonymousListsCurrentCommissionsOfThePlanFromTheDb', async () => {
    const r = await api.get('/v1/commissions', { query: { plan: 'S10-Rev23' } });
    expect(r.status).toBe(200);
    expect(r.json.map((c: { id: string }) => c.id)).toEqual(['C-72-S', 'C-93-A']);
    expect(r.json[0].subjectCode).toBe('72.07');
    expect(r.json[0].subjectName).toBe('Protocolos de Comunicación');
    expect(r.json[0].subjectType).toBe('ANNUAL');
    expect(r.json[0].courseEnd).toBe(TODAY);
    expect(r.json[0].times.length).toBe(0);
    expect(r.json[1].commissionName).toBe('A');
    expect(r.json[1].quota).toBe(40);
    expect(r.json[1].enrolledStudents).toBe(25);
    expect(r.json[1].courseStart).toBe(plusMonths(TODAY, -1));
    expect(r.json[1].times[0].day).toBe('MONDAY');
    expect(r.json[1].times[0].hourFrom).toBe('14:00');
    expect(r.json[1].times[0].hourTo).toBe('16:00');
    expect(r.json[1].times[0].building).toBe('SDF');
    expect(r.json[1].times[0].classroom).toBe('102');
    expect(r.json[1].times[1].day).toBe('WEDNESDAY');
    expect(r.text).toBe(`[{"id":"C-72-S","subjectCode":"72.07","subjectName":"Protocolos de Comunicación","subjectType":"ANNUAL","commissionName":"S","quota":20,"enrolledStudents":10,"courseStart":"${plusMonths(TODAY, -4)}","courseEnd":"${TODAY}","times":[]},`
      + `{"id":"C-93-A","subjectCode":"93.12","subjectName":"Análisis Matemático I","subjectType":"SEMESTRAL","commissionName":"A","quota":40,"enrolledStudents":25,"courseStart":"${plusMonths(TODAY, -1)}","courseEnd":"${plusMonths(TODAY, 2)}",`
      + '"times":[{"day":"MONDAY","hourFrom":"14:00","hourTo":"16:00","building":"SDF","classroom":"102"},{"day":"WEDNESDAY","hourFrom":"09:00","hourTo":"11:00","building":"SDF","classroom":"101"}]}]');
    expect(itba.requests).toEqual([]);
  });

  test('nextTermSyncedEarlyReplacesTheRunningTerm', async () => {
    await commission(api.db, 'C-93-NEXT', '93.12', 'A', plusMonths(TODAY, 5), plusMonths(TODAY, 9), 0, 40, 'SEMESTRAL');
    const r = await api.get('/v1/commissions', { query: { plan: 'S10-Rev23' } });
    expect(r.status).toBe(200);
    expect(r.json.map((c: { id: string }) => c.id)).toEqual(['C-72-S', 'C-93-NEXT']);
  });

  test('unknownPlanReturns404', async () => {
    const r = await api.get('/v1/commissions', { query: { plan: 'NOPE' } });
    expect(r.status).toBe(404);
    expect(r.json.message).toBe("Plan with identifier 'NOPE' not found");
  });

  test('missingPlanParamReturns400', async () => {
    const r = await api.get('/v1/commissions');
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('BadRequest');
  });

  // Not in the IT: an applied schedule correction replaces the SGA times (rooms borrowed by position).
  test('appliedCorrectionReplacesTheTimes', async () => {
    await api.db`INSERT INTO public.schedule_correction (commission_id, proposed_slots, sga_snapshot, slots_key, status)
      VALUES ('C-93-A', ${api.db.json([{ day: 'TUESDAY', from: '10:00', to: '12:00' }, { day: 'FRIDAY', from: '08:00', to: '09:30' }, { day: 'SATURDAY', from: '09:00', to: '10:00' }])},
              '[]'::jsonb, 'k', 'APPLIED')`;
    const r = await api.get('/v1/commissions', { query: { plan: 'S10-Rev23' } });
    expect(JSON.stringify(r.json[1].times)).toBe('[{"day":"TUESDAY","hourFrom":"10:00","hourTo":"12:00","building":"SDF","classroom":"102"},{"day":"FRIDAY","hourFrom":"08:00","hourTo":"09:30","building":"SDF","classroom":"101"},{"day":"SATURDAY","hourFrom":"09:00","hourTo":"10:00","building":"","classroom":""}]');
  });
});
