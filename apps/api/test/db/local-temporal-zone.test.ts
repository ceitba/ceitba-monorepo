// Port of LocalTemporalZoneIT: TIME and DATE columns are read and written as
// wall-clock values whatever the process zone (production runs in ART), and
// TIMESTAMPTZ keeps its instant. In TS the db client returns TIME/DATE as
// Postgres text and opens sessions in the configured zone (src/db/client.ts),
// the equivalent of never setting hibernate.jdbc.time_zone.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { sql as dsql } from 'drizzle-orm';
import { FakeItbaApiClient } from '../../src/external/itba';
import * as commissions from '../../src/features/commission/repo';
import * as highlights from '../../src/features/highlight/repo';
import * as news from '../../src/features/news/repo';
import { formatOffsetDateTime, parsePgTimestamp } from '../../src/lib/time';
import { testApp, type TestApp } from '../support/app';

let t: TestApp;
const fake = new FakeItbaApiClient(null);

beforeAll(async () => { t = await testApp({ env: { TZ: 'America/Argentina/Buenos_Aires' }, overrides: { itba: fake } }); }, 60_000);
afterAll(() => t?.close());
beforeEach(async () => {
  await t.sql`DELETE FROM public.commission_time`;
  await t.sql`DELETE FROM public.commission`;
  await t.sql`DELETE FROM public.plan_subject`;
  await t.sql`DELETE FROM public.subject`;
  await t.sql`DELETE FROM public.news_events`;
  await t.sql`DELETE FROM public.home_highlights`;
});

async function insertCommissionWithSql() {
  await t.sql`INSERT INTO public.subject (id, name, credits, updated_at) VALUES ('93.12', 'Análisis', 6, now())`;
  await t.sql`INSERT INTO public.commission (id, subject_code, commission_name, course_start, course_end, enrolled_students, quota, subject_type)
              VALUES ('C-1', '93.12', 'A', '2026-03-09', '2099-07-04', 10, 30, 'SEMESTRAL')`;
  await t.sql`INSERT INTO public.commission_time (course_id, day, classroom, building, hour_from, hour_to)
              VALUES ('C-1', 'MONDAY', '101F', 'SDF', '08:00:00', '11:00:00')`;
}

describe('LocalTemporalZoneIT', () => {
  // (a) literal DB values are read unchanged.
  test('sqlWrittenCommissionTimeAndDatesReadBackAsWallClock', async () => {
    await insertCommissionWithSql();
    const [c] = await commissions.findBySubjectCodeInWithTimes(t.deps.db, ['93.12']);
    expect([c!.courseStart, c!.courseEnd]).toEqual(['2026-03-09', '2099-07-04']);
    const times = await commissions.findAllTimesOrdered(t.deps.db);
    expect(times.map((x) => [x.hourFrom, x.hourTo])).toEqual([['08:00:00', '11:00:00']]);
  });

  // (b) values the app writes are stored literally.
  test('jpaWrittenCommissionTimeAndDatesAreStoredAsWallClock', async () => {
    await t.sql`INSERT INTO public.subject (id, name, credits, updated_at) VALUES ('93.12', 'Análisis', 6, now())`;
    await commissions.insertCommission(t.deps.db, {
      id: 'C-2', subjectCode: '93.12', commissionName: 'A', courseStart: '2026-03-09', courseEnd: '2099-07-04',
      enrolledStudents: 10, quota: 30, subjectType: 'SEMESTRAL', termYear: null, termPeriod: null, times: [],
    } as never);
    await commissions.insertTime(t.deps.db, { courseId: 'C-2', day: 'MONDAY', hourFrom: '08:00', classroom: '101F', building: 'SDF', hourTo: '11:00' } as never);
    expect((await t.sql`SELECT course_start::text || '/' || course_end::text AS v FROM public.commission WHERE id = 'C-2'`)[0]!.v).toBe('2026-03-09/2099-07-04');
    expect((await t.sql`SELECT hour_from::text || '-' || hour_to::text AS v FROM public.commission_time WHERE course_id = 'C-2'`)[0]!.v).toBe('08:00:00-11:00:00');
    // The composite key (course_id, day, hour_from) resolves too.
    expect(await t.sql`SELECT 1 FROM public.commission_time WHERE course_id = 'C-2' AND day = 'MONDAY' AND hour_from = '08:00'`).toHaveLength(1);
  });

  // The public endpoints serialize the literal DB values.
  test('endpointsServeSqlWrittenTimesUnshifted', async () => {
    await insertCommissionWithSql();
    await t.sql`INSERT INTO public.plan_subject (subject_id, plan_id, section, year, semester, credits_required)
                VALUES ('93.12', 'S10-Rev23', 'Ciclo Básico', 1, 1, 0)`;
    fake.stubPlan('S10-Rev23', [{ subjectId: '93.12', planId: 'S10-Rev23', section: 'Ciclo Básico', year: 1, semester: 1, dependencies: [], creditsRequired: null, subjectName: 'Análisis', subjectCredits: 6 }]);
    const c = await t.request('GET', '/v1/commissions?plan=S10-Rev23');
    expect(c.status).toBe(200);
    expect([c.json[0].courseStart, c.json[0].times[0].hourFrom, c.json[0].times[0].hourTo]).toEqual(['2026-03-09', '08:00', '11:00']);
    const s = await t.request('GET', '/v1/subjects?plan=S10-Rev23');
    expect(s.status).toBe(200);
    const slot = s.json['Ciclo Básico']['1']['1'][0].commissions[0].schedule[0];
    expect([slot.time_from, slot.time_to]).toEqual(['08:00:00', '11:00:00']);
  });

  test('newsEventTimeAndDateRoundTripAsWallClock', async () => {
    await t.sql`INSERT INTO public.news_events (id, title, event_date, start_time, end_time, location, category, created_at)
                VALUES ('sql', 'SQL', '2026-03-09', '19:30:00', '21:00:00', 'SDF', 'talk', '2026-03-09 22:30:00+00')`;
    const fromSql = (await news.findEvent(t.deps.db, 'sql'))!;
    expect(fromSql.eventDate).toBe('2026-03-09');
    // timestamptz keeps its instant.
    expect(formatOffsetDateTime(parsePgTimestamp(fromSql.createdAt!))).toBe('2026-03-09T22:30:00Z');
    expect([fromSql.startTime, fromSql.endTime]).toEqual(['19:30:00', '21:00:00']);
    await news.insertEvent(t.deps.db, { ...fromSql, id: 'jpa', title: 'JPA', startTime: '19:30', endTime: '21:00' });
    expect((await t.sql`SELECT event_date::text || ' ' || start_time::text || '-' || end_time::text AS v FROM public.news_events WHERE id = 'jpa'`)[0]!.v)
      .toBe('2026-03-09 19:30:00-21:00:00');
  });

  test('timestamptzRoundTripsByInstant', async () => {
    const startsAt = Date.parse('2026-03-09T08:00:00-03:00') * 1000;
    const id = crypto.randomUUID();
    await highlights.insert(t.deps.db, id, {
      title: 'h', description: null, imageUrl: 'https://example.com/i.png', linkUrl: null, position: 0,
      startsAt, endsAt: startsAt + 86_400_000_000, active: true,
    }, startsAt);
    // Stored as the same instant (11:00Z)...
    expect((await t.sql`SELECT starts_at = TIMESTAMPTZ '2026-03-09 11:00:00+00' AS ok FROM public.home_highlights WHERE id = ${id}`)[0]!.ok).toBe(true);
    // ...and read back as the same instant.
    const read = (await highlights.findById(t.deps.db, id))!;
    expect(parsePgTimestamp(read.startsAt!)).toBe(startsAt);
    expect(parsePgTimestamp(read.endsAt!)).toBe(startsAt + 86_400_000_000);
  });

  // Java guards the yml against hibernate.jdbc.time_zone. The TS equivalent: sessions run in the
  // configured zone and TIME/DATE come back as text, never through a Date.
  test('noConfigReintroducesJdbcTimeZone', async () => {
    const [z] = (await t.deps.db.execute(dsql`SHOW TimeZone`)) as unknown as { TimeZone: string }[];
    expect(z!.TimeZone).toBe(t.deps.config.server.timeZone);
    const [r] = (await t.deps.db.execute(dsql`SELECT TIME '08:00' AS t, DATE '2026-03-09' AS d`)) as unknown as { t: unknown; d: unknown }[];
    expect([r!.t, r!.d]).toEqual(['08:00:00', '2026-03-09']);
  });
});
