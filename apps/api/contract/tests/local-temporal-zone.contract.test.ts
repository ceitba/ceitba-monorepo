// Black-box half of apps/api/src/test/java/org/ceitba/api/LocalTemporalZoneIT.java
// (endpointsServeSqlWrittenTimesUnshifted): TIME and DATE values written with SQL
// are served unshifted by a server running in ART. The plan comes from the
// database (ITBA_API_FAKE_FROM_DB) instead of the IT's stubbed fake. The
// repository-level tests are in-process: test/db/local-temporal-zone.test.ts.
import { describe, expect, test } from 'bun:test';
import { useServer } from '../support';

const api = useServer({ env: { ITBA_API_FAKE_FROM_DB: 'true', TZ: 'America/Argentina/Buenos_Aires' } });

describe('LocalTemporalZoneIT', () => {
  test('endpointsServeSqlWrittenTimesUnshifted', async () => {
    await api.db`INSERT INTO public.careers (id, name, updated_at) VALUES ('S', 'Sistemas', now()) ON CONFLICT DO NOTHING`;
    await api.db`INSERT INTO public.plan (id, career_id, updated_at) VALUES ('S10-Rev23', 'S', now()) ON CONFLICT DO NOTHING`;
    await api.db`INSERT INTO public.subject (id, name, credits, updated_at) VALUES ('93.12', 'Análisis', 6, now())`;
    await api.db`INSERT INTO public.commission (id, subject_code, commission_name, course_start, course_end, enrolled_students, quota, subject_type)
                 VALUES ('C-1', '93.12', 'A', '2026-03-09', '2099-07-04', 10, 30, 'SEMESTRAL')`;
    await api.db`INSERT INTO public.commission_time (course_id, day, classroom, building, hour_from, hour_to)
                 VALUES ('C-1', 'MONDAY', '101F', 'SDF', '08:00:00', '11:00:00')`;
    await api.db`INSERT INTO public.plan_subject (subject_id, plan_id, section, year, semester, credits_required)
                 VALUES ('93.12', 'S10-Rev23', 'Ciclo Básico', 1, 1, 0)`;
    const c = await api.get('/v1/commissions?plan=S10-Rev23');
    expect(c.status).toBe(200);
    expect([c.json[0].courseStart, c.json[0].times[0].hourFrom, c.json[0].times[0].hourTo]).toEqual(['2026-03-09', '08:00', '11:00']);
    const s = await api.get('/v1/subjects?plan=S10-Rev23');
    expect(s.status).toBe(200);
    const slot = s.json['Ciclo Básico']['1']['1'][0].commissions[0].schedule[0];
    expect([slot.time_from, slot.time_to]).toEqual(['08:00:00', '11:00:00']);
  });
});
