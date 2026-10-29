// In-process part of apps/api/src/test/java/org/ceitba/api/web/correction/ScheduleCorrectionIT.java:
// the tests that need the stubbed ITBA client (sync expiry) or the fake push
// gateway (push payload). The clock is fixed at 2026-10-02T15:00Z (ART), like
// the IT's FixedClock. The rest of the IT is black-box:
// contract/tests/correction-schedule.contract.test.ts.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { copyPlanSubjectsToEntries, mintJwt } from '../../contract/support/identity';
import type { FakeItbaApiClient, TimeSlot } from '../../src/external/itba';
import { FakePushGateway } from '../../src/infra/push';
import { MutableClock } from '../../src/infra/clock';
import { pendingPushes } from '../../src/features/news/pushTriggers';
import { DataSyncService } from '../../src/features/sync/dataSync';
import { testApp, type TestApp } from '../support/app';

const PLAN = 'S10-Rev23';
const SUBJECT = '31.08';
const SUBJECT_NAME = 'Sistemas de Representación';
const COMMISSION = '45112';
const SUGGESTER = 'sugeridor@itba.edu.ar';

let t: TestApp;
let gateway: FakePushGateway;
let itba: FakeItbaApiClient;

beforeAll(async () => {
  gateway = new FakePushGateway();
  t = await testApp({ overrides: { clock: new MutableClock('2026-10-02T15:00:00Z'), push: gateway } });
  itba = t.deps.itba as FakeItbaApiClient;
}, 60_000);
afterAll(() => t?.close());

const tokens = new Map<string, string>();
async function auth(email: string) {
  if (!tokens.has(email)) tokens.set(email, await mintJwt({ email, name: email === SUGGESTER ? 'Sugeridor Secreto' : email }));
  return { Authorization: `Bearer ${tokens.get(email)}` };
}
const student = (n: number) => `alumno${n}@itba.edu.ar`;

function slots(...specs: string[]): string {
  return `{"schedule":[${specs.map((s) => {
    const [day, times] = s.split(' ') as [string, string];
    const [from, to] = times.split('-') as [string, string];
    return `{"day":"${day}","time_from":"${from}","time_to":"${to}"}`;
  }).join(',')}]}`;
}
const P1 = slots('TUESDAY 09:00-12:00', 'WEDNESDAY 08:00-10:00');
const P2 = slots('TUESDAY 10:00-13:00', 'WEDNESDAY 08:00-10:00');

async function suggestOk(email: string, body: string): Promise<string> {
  const r = await t.request('POST', `/v1/commissions/${COMMISSION}/schedule-corrections`, { headers: await auth(email), body });
  expect(r.status).toBe(201);
  return r.json.correction.id;
}
async function vote(email: string, id: string, type: string) {
  const r = await t.request('PUT', `/v1/schedule-corrections/${id}/vote`, { headers: await auth(email), body: { type } });
  expect(r.status).toBe(200);
  return r.json;
}
const statusOf = async (id: string) => ((await t.sql`SELECT status FROM public.schedule_correction WHERE id = ${id}`)[0]!.status as string);

beforeEach(async () => {
  await t.sql`TRUNCATE public.schedule_correction, public."user", public.commission_time, public.commission, public.plan_subject, public.plan_entry, public.subject, public.plan, public.careers CASCADE`;
  itba.reset();
  gateway.calls.length = 0;
  await t.sql`INSERT INTO public.careers (id, name, updated_at) VALUES ('S', 'Sistemas', now())`;
  await t.sql`INSERT INTO public.plan (id, career_id, name, updated_at) VALUES (${PLAN}, 'S', 'Plan 2023', now())`;
  await t.sql`INSERT INTO public.subject (id, name, credits, updated_at) VALUES (${SUBJECT}, ${SUBJECT_NAME}, 3, now())`;
  await t.sql`INSERT INTO public.plan_subject (dependencies, section, subject_id, plan_id, year, semester, credits_required) VALUES ('{}', 'Ciclo', ${SUBJECT}, ${PLAN}, 1, 1, 0)`;
  await copyPlanSubjectsToEntries(t.sql);
  itba.stubPlan(PLAN, [{ subjectId: SUBJECT, planId: PLAN, section: 'Ciclo', year: 1, semester: 1, dependencies: [], creditsRequired: null, subjectName: SUBJECT_NAME, subjectCredits: 3 }]);
  for (const [id, name] of [[COMMISSION, 'G'], ['45113', 'B']] as const) {
    await t.sql`INSERT INTO public.commission (id, subject_code, commission_name, course_start, course_end, enrolled_students, quota, subject_type)
                VALUES (${id}, ${SUBJECT}, ${name}, '2026-08-15', '2026-12-15', 10, 30, 'SEMESTRAL')`;
    await t.sql`INSERT INTO public.commission_time (course_id, day, hour_from, classroom, building, hour_to) VALUES (${id}, 'MONDAY', '08:00', '102T', 'SDT', '11:00')`;
    await t.sql`INSERT INTO public.commission_time (course_id, day, hour_from, classroom, building, hour_to) VALUES (${id}, 'WEDNESDAY', '08:00', '201F', 'SDF', '10:00')`;
  }
});

const slot = (day: TimeSlot['day'], from: number, to: number, room: string): TimeSlot =>
  ({ day, classroom: room, building: 'SDT', hourFrom: `${String(from).padStart(2, '0')}:00:00`, hourTo: `${String(to).padStart(2, '0')}:00:00` });

async function syncCommissionSlots(...times: TimeSlot[]) {
  itba.stubCommissions([{ id: COMMISSION, subjectCode: SUBJECT, subjectName: SUBJECT_NAME, commissionName: 'G', courseStart: '2026-08-15',
    courseEnd: '2026-12-15', enrolledStudents: 10, quota: 30, subjectType: 'SEMESTRAL', times }]);
  await new DataSyncService(t.deps).syncCommissionsOnly({});
}

describe('ScheduleCorrectionIT (in-process)', () => {
  test('syncLeavesCorrectionsAloneWhileSgaSlotsAreUnchanged', async () => {
    const id = await suggestOk(SUGGESTER, P1);
    await syncCommissionSlots(slot('WEDNESDAY', 8, 10, '999'), slot('MONDAY', 8, 11, '102T'));
    expect(await statusOf(id)).toBe('PENDING');
  });

  test('syncResolvesCorrectionsSgaNowAgreesWithAndSupersedesTheRest', async () => {
    const agreed = await suggestOk(SUGGESTER, P1);
    await vote(student(2), agreed, 'CONFIRM');
    await vote(student(3), agreed, 'CONFIRM');
    const other = await suggestOk(student(4), P2);
    const closed = await suggestOk(student(5), slots('FRIDAY 18:00-21:00'));
    // ScheduleCorrectionService.staffReject(closed, null)
    const { ScheduleCorrectionService } = await import('../../src/features/correction/service');
    await new ScheduleCorrectionService(t.deps).staffReject(closed, null);

    await syncCommissionSlots(slot('TUESDAY', 9, 12, '102T'), slot('WEDNESDAY', 8, 10, '201F'));
    expect(await statusOf(agreed)).toBe('RESOLVED');
    expect(await statusOf(other)).toBe('SUPERSEDED');
    expect(await statusOf(closed)).toBe('REJECTED');

    const subjects = await t.request('GET', `/v1/subjects?plan=${PLAN}`);
    expect(subjects.status).toBe(200);
    const c = (subjects.json.Ciclo['1']['1'][0].commissions as { commission_id: string }[]).find((x) => x.commission_id === COMMISSION) as any;
    expect(c.schedule[0].day).toBe('TUESDAY');
    expect('sga_schedule' in c).toBe(false);
    expect(c.corrections).toHaveLength(0);

    const again = await t.request('POST', `/v1/commissions/${COMMISSION}/schedule-corrections`, { headers: await auth(student(6)), body: P1 });
    expect(again.status).toBe(400);
    expect(again.json.error).toBe('SameAsSga');
  });

  test('applyingPushesOnceToTheSuggesterWithTheContractPayload', async () => {
    await t.request('GET', '/v1/me/schedule-corrections', { headers: await auth(SUGGESTER) }); // JIT-provisions the suggester
    await t.sql`INSERT INTO public.user_devices (token, user_id, platform) SELECT 'sug-phone', id, 'ios' FROM public."user" WHERE email = ${SUGGESTER}`;
    const id = await suggestOk(SUGGESTER, P1);
    await vote(student(2), id, 'CONFIRM');
    await vote(student(3), id, 'CONFIRM');
    await pendingPushes();
    expect(gateway.calls).toHaveLength(1);
    const call = gateway.calls[0]!;
    expect(call.tokens).toEqual(['sug-phone']);
    expect(call.message.title).toBe('Tu corrección fue aplicada');
    expect(call.message.body).toBe(`${SUBJECT_NAME} · Comisión G: el horario corregido ya se usa en el Combinador.`);
    expect(call.message.data).toMatchObject({ type: 'schedule_correction_applied', correctionId: id, subjectId: SUBJECT, commissionId: COMMISSION });

    await vote(student(4), id, 'CONFIRM');
    await pendingPushes();
    expect(gateway.calls).toHaveLength(1);
  });

  test('aRolledBackApplySendsNothing', async () => {
    // Not in the IT: the push is collected in the transaction and fired after commit.
    const id = await suggestOk(SUGGESTER, P1);
    await vote(student(2), id, 'CONFIRM');
    await t.sql`ALTER TABLE public.schedule_correction ADD CONSTRAINT tmp_no_apply CHECK (status <> 'APPLIED') NOT VALID`;
    try {
      const r = await t.request('PUT', `/v1/schedule-corrections/${id}/vote`, { headers: await auth(student(3)), body: { type: 'CONFIRM' } });
      expect(r.status).toBe(409);
    } finally {
      await t.sql`ALTER TABLE public.schedule_correction DROP CONSTRAINT tmp_no_apply`;
    }
    await pendingPushes();
    expect(gateway.calls).toHaveLength(0);
    expect(await statusOf(id)).toBe('PENDING');
  });
});
