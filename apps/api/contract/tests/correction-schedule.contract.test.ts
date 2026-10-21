// Ports apps/api/src/test/java/org/ceitba/api/web/correction/ScheduleCorrectionIT.java
// (black-box part). Translations, all checked against the jar:
//   - FixedClock(2026-10-02 ART): the jar runs on the real clock, so every
//     course date is relative to today's ART date (running = today + 74 days,
//     ended = today - 69, "2026-09-30" = today - 2, "2026-10-01" = yesterday,
//     "2026-10-02" = today; the next term starts today + 157).
//   - jwt().authorities(STAFF) -> a real ceitba_staff row (seedStaff).
//   - service.staffApply/staffReject(id, null) -> the staff HTTP endpoints.
//   - service.vote(...) from 16 threads -> 16 concurrent HTTP PUTs.
//   - ApplicationEvents PushToUsers count -> push_log rows of kind
//     'schedule_correction_applied' (PushTriggerListener writes one per event
//     after commit, also with the no-op push service), polled until stable.
//   - itba.stubPlan(...) -> ITBA_API_FAKE_FROM_DB=true + the plan_subject row.
// In-process (test/correction/): the sync expiry tests (stubbed ITBA client),
// the push payload test (FakePushGateway) and the account-deletion re-evaluation.
import { beforeEach, describe, expect, test } from 'bun:test';
import { bearer, mintJwt, seedStaff, supports, useServer, type As } from '../support';

const api = useServer({ env: { ITBA_API_FAKE_FROM_DB: 'true' } });
const hasSubjects = await supports('GET /v1/subjects');
const hasCommissions = await supports('GET /v1/commissions');
const hasAccountDeletion = await supports('DELETE /v1/me');

const PLAN = 'S10-Rev23';
const SUBJECT = '31.08';
const SUBJECT_NAME = 'Sistemas de Representación';
const COMMISSION = '45112';
const OTHER_COMMISSION = '45113';
const ENDED_COMMISSION = '40001';
const SUGGESTER = 'sugeridor@itba.edu.ar';
const SUGGESTER_NAME = 'Sugeridor Secreto';
const STAFF = 'staff@itba.edu.ar';

/** Today's date in ART plus `days`. */
function artDate(days = 0): string {
  const t = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);
}
const minusMonths = (d: string, m: number) => {
  const [y, mo, da] = d.split('-').map(Number) as [number, number, number];
  const x = new Date(Date.UTC(y, mo - 1 - m, da));
  return x.toISOString().slice(0, 10);
};
const RUNNING_END = artDate(74);

function slots(...specs: string[]): string {
  const parts = specs.map((s) => {
    const [day, times] = s.split(' ') as [string, string];
    const [from, to] = times.split('-') as [string, string];
    return `{"day":"${day}","time_from":"${from}","time_to":"${to}"}`;
  });
  return `{"schedule":[${parts.join(',')}]}`;
}
// SGA: MONDAY 08-11 (102T/SDT), WEDNESDAY 08-10 (201F/SDF). P1 moves Monday to Tuesday 09-12.
const P1 = slots('TUESDAY 09:00-12:00', 'WEDNESDAY 08:00-10:00');
const P2 = slots('TUESDAY 10:00-13:00', 'WEDNESDAY 08:00-10:00');

const tokens = new Map<string, As>();
async function as(email: string): Promise<As> {
  let a = tokens.get(email);
  if (!a) {
    a = bearer(await mintJwt({ email, name: email === SUGGESTER ? SUGGESTER_NAME : email }));
    tokens.set(email, a);
  }
  return a;
}
const student = (n: number) => as(`alumno${n}@itba.edu.ar`);
const staff = () => as(STAFF);

async function commission(id: string, name: string, start: string, end: string) {
  await api.db`INSERT INTO public.commission (id, subject_code, commission_name, course_start, course_end, enrolled_students, quota, subject_type)
               VALUES (${id}, ${SUBJECT}, ${name}, ${start}, ${end}, 10, 30, 'SEMESTRAL')`;
  await api.db`INSERT INTO public.commission_time (course_id, day, hour_from, classroom, building, hour_to) VALUES (${id}, 'MONDAY', '08:00', '102T', 'SDT', '11:00')`;
  await api.db`INSERT INTO public.commission_time (course_id, day, hour_from, classroom, building, hour_to) VALUES (${id}, 'WEDNESDAY', '08:00', '201F', 'SDF', '10:00')`;
}

beforeEach(async () => {
  await api.db`TRUNCATE public.schedule_correction, public."user", public.commission_time, public.commission, public.plan_subject, public.subject, public.plan, public.careers, public.push_log CASCADE`;
  await api.db`INSERT INTO public.careers (id, name, updated_at) VALUES ('S', 'Sistemas', now())`;
  await api.db`INSERT INTO public.plan (id, career_id, name, updated_at) VALUES (${PLAN}, 'S', 'Plan 2023', now())`;
  await api.db`INSERT INTO public.subject (id, name, credits, updated_at) VALUES (${SUBJECT}, ${SUBJECT_NAME}, 3, now())`;
  await api.db`INSERT INTO public.plan_subject (dependencies, section, subject_id, plan_id, year, semester, credits_required)
               VALUES ('{}', 'Ciclo', ${SUBJECT}, ${PLAN}, 1, 1, 0)`;
  await commission(COMMISSION, 'G', minusMonths(RUNNING_END, 4), RUNNING_END);
  await commission(OTHER_COMMISSION, 'B', minusMonths(RUNNING_END, 4), RUNNING_END);
  await commission(ENDED_COMMISSION, 'G', minusMonths(artDate(-69), 4), artDate(-69));
  await seedStaff(api.db, STAFF);
});

const suggestAs = async (who: As | Promise<As>, commissionId: string, body: string) =>
  api.post(`/v1/commissions/${commissionId}/schedule-corrections`, { as: await who, body });

async function suggestOk(who: As | Promise<As>, body: string, commissionId = COMMISSION): Promise<string> {
  const r = await suggestAs(who, commissionId, body);
  expect(r.status).toBe(201);
  return r.json.correction.id;
}
const voteAs = async (who: As | Promise<As>, id: string, type: string) =>
  api.put(`/v1/schedule-corrections/${id}/vote`, { as: await who, body: `{"type":"${type}"}` });
async function vote(who: As | Promise<As>, id: string, type: string) {
  const r = await voteAs(who, id, type);
  expect(r.status).toBe(200);
  return r.json;
}
const unvote = async (who: As | Promise<As>, id: string) => api.delete(`/v1/schedule-corrections/${id}/vote`, { as: await who });
const staffPost = async (id: string, action: 'apply' | 'reject') => api.post(`/v1/staff/schedule-corrections/${id}/${action}`, { as: await staff() });
const statusOf = async (id: string) => ((await api.db`SELECT status FROM public.schedule_correction WHERE id = ${id}`)[0]!.status as string);
const correctionCount = async () => Number((await api.db`SELECT count(*)::int AS n FROM public.schedule_correction`)[0]!.n);

/** push_log rows of applied pushes, once the count stopped moving (deliveries run after commit). */
async function appliedPushEvents(): Promise<number> {
  const read = async () => Number((await api.db`SELECT count(*)::int AS n FROM public.push_log WHERE kind = 'schedule_correction_applied'`)[0]!.n);
  let last = await read();
  let stableSince = Date.now();
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    await Bun.sleep(50);
    const n = await read();
    if (n !== last) { last = n; stableSince = Date.now(); }
    else if (Date.now() - stableSince >= 400) break;
  }
  return last;
}

async function assertAnonymous(text: string) {
  const [u] = await api.db`SELECT id FROM public."user" WHERE email = ${SUGGESTER}`;
  expect(u).toBeDefined();
  expect(text).not.toContain(u!.id as string);
  expect(text).not.toContain(SUGGESTER);
  expect(text).not.toContain(SUGGESTER_NAME);
  expect(text).not.toContain('suggester');
}

async function subjectsCommission(who?: As | Promise<As>, commissionId = COMMISSION) {
  const r = await api.get('/v1/subjects', { as: who ? await who : undefined, query: { plan: PLAN } });
  expect(r.status).toBe(200);
  const list = r.json.Ciclo['1']['1'][0].commissions as { commission_id: string }[];
  const c = list.find((x) => x.commission_id === commissionId);
  if (!c) throw new Error(`commission not listed: ${r.text}`);
  return c as any;
}

describe('ScheduleCorrectionIT', () => {
  test('suggestionIsCreatedPendingWithTheSuggestersConfirm', async () => {
    const r = await suggestAs(as(SUGGESTER), COMMISSION, slots('WEDNESDAY 08:00:00-10:00:00', 'TUESDAY 09:00-12:00'));
    expect(r.status).toBe(201);
    const j = r.json;
    expect(j.created).toBe(true);
    expect(j.correction).toMatchObject({ commissionId: COMMISSION, status: 'PENDING', confirms: 1, rejects: 0, myVote: 'CONFIRM' });
    expect(j.correction.createdAt).toBeTruthy();
    expect(j.correction.schedule).toHaveLength(2);
    expect(j.correction.schedule[0]).toMatchObject({ day: 'TUESDAY', time_from: '09:00:00', time_to: '12:00:00', classroom: '102T', building: 'SDT' });
    expect(j.correction.schedule[1]).toMatchObject({ day: 'WEDNESDAY', classroom: '201F' });
    // Byte-level shape (record order; createdAt is an Instant).
    expect(r.text).toMatch(new RegExp(`^\\{"created":true,"correction":\\{"id":"${j.correction.id}","commissionId":"45112","status":"PENDING","schedule":\\[`
      + '\\{"day":"TUESDAY","classroom":"102T","building":"SDT","time_from":"09:00:00","time_to":"12:00:00"\\},'
      + '\\{"day":"WEDNESDAY","classroom":"201F","building":"SDF","time_from":"08:00:00","time_to":"10:00:00"\\}\\],'
      + '"confirms":1,"rejects":0,"myVote":"CONFIRM","createdAt":"\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{3}|\\.\\d{6})?Z"\\}\\}$'));
    await assertAnonymous(r.text);
  });

  test('invalidSlotsAreRejected', async () => {
    const invalid = [
      '{"schedule":[]}',
      slots('MONDAY 08:00-09:00', 'MONDAY 09:00-10:00', 'MONDAY 10:00-11:00', 'MONDAY 11:00-12:00', 'MONDAY 12:00-13:00', 'MONDAY 13:00-14:00', 'MONDAY 14:00-15:00'),
      slots('SUNDAY 09:00-12:00'),
      slots('FUNDAY 09:00-12:00'),
      slots('TUESDAY 12:00-09:00'),
      slots('TUESDAY 09:00-09:00'),
      slots('TUESDAY 06:30-09:00'),
      slots('TUESDAY 21:00-23:45'),
      slots('TUESDAY 9:00-12:00'),
      slots('TUESDAY 09:00:30-12:00'),
      slots('TUESDAY 09:00-12:00', 'TUESDAY 11:00-13:00'),
      slots('TUESDAY 09:00-12:00', 'TUESDAY 09:00-12:00'),
    ];
    for (const body of invalid) {
      const r = await suggestAs(student(1), COMMISSION, body);
      expect(r.status).toBe(400);
      expect(r.json.error).toBe('ValidationError');
    }
    expect((await suggestAs(student(1), COMMISSION, '{}')).status).toBe(400);
    expect((await suggestAs(student(1), COMMISSION, slots('TUESDAY 09:00-11:00', 'TUESDAY 11:00-13:00'))).status).toBe(201);
    expect(await correctionCount()).toBe(1);
  });

  test('sameAsSgaUnknownAndEndedCommissionsAreRejected', async () => {
    const same = await suggestAs(student(1), COMMISSION, slots('WEDNESDAY 08:00-10:00', 'MONDAY 08:00-11:00'));
    expect(same.status).toBe(400);
    expect(same.json.error).toBe('SameAsSga');
    expect((await suggestAs(student(1), 'nope', P1)).status).toBe(404);
    const ended = await suggestAs(student(1), ENDED_COMMISSION, P1);
    expect(ended.status).toBe(409);
    expect(ended.json.error).toBe('CommissionEnded');
    expect(await correctionCount()).toBe(0);
  });

  test('anonymousCallersCannotSuggestOrVote', async () => {
    expect((await api.post(`/v1/commissions/${COMMISSION}/schedule-corrections`, { body: P1 })).status).toBe(401);
    expect((await api.get('/v1/me/schedule-corrections')).status).toBe(401);
    expect((await suggestAs(as('someone@gmail.com'), COMMISSION, P1)).status).toBe(403);
  });

  test('identicalOpenSuggestionIsReturnedInsteadOfDuplicated', async () => {
    const id = await suggestOk(as(SUGGESTER), P1);
    const r = await suggestAs(student(2), COMMISSION, slots('WEDNESDAY 08:00-10:00', 'TUESDAY 09:00:00-12:00:00'));
    expect(r.status).toBe(200);
    expect(r.json.created).toBe(false);
    expect(r.json.correction.id).toBe(id);
    expect(r.json.correction.confirms).toBe(1);
    expect(r.json.correction.myVote).toBeNull();
    await assertAnonymous(r.text);
    const again = await suggestAs(as(SUGGESTER), COMMISSION, P1);
    expect(again.status).toBe(200);
    expect(again.json.correction.myVote).toBe('CONFIRM');
    expect(await correctionCount()).toBe(1);
  });

  test('oneDifferentPendingSuggestionPerUserAndCommission', async () => {
    await suggestOk(as(SUGGESTER), P1);
    const r = await suggestAs(as(SUGGESTER), COMMISSION, P2);
    expect(r.status).toBe(409);
    expect(r.json.error).toBe('AlreadySuggested');
    expect((await suggestAs(as(SUGGESTER), OTHER_COMMISSION, P2)).status).toBe(201);
  });

  test('appliesAtThreeConfirmsWithMoreConfirmsThanRejectsAndUnappliesWhenRejectsCatchUp', async () => {
    const id = await suggestOk(as(SUGGESTER), P1);
    expect((await vote(student(2), id, 'CONFIRM')).status).toBe('PENDING');
    const afterReject = await vote(student(3), id, 'REJECT');
    expect(afterReject).toMatchObject({ confirms: 2, rejects: 1, myVote: 'REJECT' });

    const applied = await vote(student(4), id, 'CONFIRM');
    expect(applied.status).toBe('APPLIED');
    expect(applied.confirms).toBe(3);
    expect(await appliedPushEvents()).toBe(1);

    await vote(student(5), id, 'REJECT');
    const unapplied = await vote(student(6), id, 'REJECT');
    expect(unapplied.rejects).toBe(3);
    expect(unapplied.status).toBe('PENDING');

    const changed = await vote(student(6), id, 'CONFIRM');
    expect(changed).toMatchObject({ confirms: 4, rejects: 2, status: 'APPLIED' });

    const removed = await unvote(student(6), id);
    expect(removed.status).toBe(200);
    expect(removed.json.confirms).toBe(3);
    expect(removed.json.myVote).toBeNull();
    expect(removed.json.status).toBe('APPLIED');

    expect(await appliedPushEvents()).toBe(1);
  });

  test('threeConfirmsAreNotEnoughWhenRejectsTie', async () => {
    const id = await suggestOk(as(SUGGESTER), P1);
    await vote(student(2), id, 'REJECT');
    await vote(student(3), id, 'REJECT');
    await vote(student(4), id, 'REJECT');
    await vote(student(5), id, 'CONFIRM');
    expect((await vote(student(6), id, 'CONFIRM')).status).toBe('PENDING');
    expect(await statusOf(id)).toBe('PENDING');
    expect((await vote(student(7), id, 'CONFIRM')).status).toBe('APPLIED');
  });

  test('secondCorrectionReachingTheThresholdSupersedesTheAppliedOne', async () => {
    const first = await suggestOk(as(SUGGESTER), P1);
    await vote(student(2), first, 'CONFIRM');
    await vote(student(3), first, 'CONFIRM');
    expect(await statusOf(first)).toBe('APPLIED');

    const second = await suggestOk(student(4), P2);
    await vote(student(5), second, 'CONFIRM');
    expect((await vote(student(6), second, 'CONFIRM')).status).toBe('APPLIED');
    expect(await statusOf(first)).toBe('SUPERSEDED');

    const late = await voteAs(student(7), first, 'CONFIRM');
    expect(late.status).toBe(409);
    expect(late.json.error).toBe('InvalidState');
    expect(late.json.message).toBe('Schedule correction is SUPERSEDED');
    expect((await unvote(student(2), first)).status).toBe(409);
    expect(await appliedPushEvents()).toBe(2);
  });

  test('votesOnUnknownOrEndedCorrectionsFail', async () => {
    const unknown = crypto.randomUUID();
    const nf = await voteAs(student(1), unknown, 'CONFIRM');
    expect(nf.status).toBe(404);
    expect(nf.json.message).toBe(`ScheduleCorrection with identifier '${unknown}' not found`);
    expect((await voteAs(student(1), 'not-a-uuid', 'CONFIRM')).status).toBe(400);

    const id = await suggestOk(as(SUGGESTER), P1);
    expect((await voteAs(student(1), id, 'MAYBE')).status).toBe(400);
    await api.db`UPDATE public.commission SET course_end = ${artDate(-2)} WHERE id = ${COMMISSION}`;
    const ended = await voteAs(student(1), id, 'CONFIRM');
    expect(ended.status).toBe(409);
    expect(ended.json.error).toBe('CommissionEnded');
    expect(ended.json.message).toBe(`Commission ${COMMISSION} has ended`);
  });

  test('staffApplySupersedesAndStaffRejectIsFinal', async () => {
    const first = await suggestOk(as(SUGGESTER), P1);
    const second = await suggestOk(student(2), P2);

    const applied = await staffPost(second, 'apply');
    expect(applied.status).toBe(200);
    expect(applied.json).toMatchObject({ status: 'APPLIED', reviewedByStaff: true, subjectId: SUBJECT, subjectName: SUBJECT_NAME, commissionName: 'G' });
    expect(applied.json.reviewedAt).toBeTruthy();
    expect(applied.json.appliedAt).toBeTruthy();
    expect(applied.json.sgaSchedule).toHaveLength(2);
    expect(applied.json.sgaSchedule[0].day).toBe('MONDAY');
    expect('myVote' in applied.json).toBe(false);
    await assertAnonymous(applied.text);
    expect(await appliedPushEvents()).toBe(1);

    for (let i = 3; i <= 6; i++) await vote(student(i), second, 'REJECT');
    expect(await statusOf(second)).toBe('APPLIED');

    const firstApplied = await staffPost(first, 'apply');
    expect(firstApplied.status).toBe(200);
    expect(firstApplied.json.status).toBe('APPLIED');
    expect(await statusOf(second)).toBe('SUPERSEDED');

    const rejected = await staffPost(first, 'reject');
    expect(rejected.status).toBe(200);
    expect(rejected.json.status).toBe('REJECTED');
    expect((await voteAs(student(7), first, 'CONFIRM')).status).toBe(409);
    const reapply = await staffPost(first, 'apply');
    expect(reapply.status).toBe(409);
    expect(reapply.json.message).toBe('Schedule correction is REJECTED');
    expect(await statusOf(first)).toBe('REJECTED');

    const list = await api.get('/v1/staff/schedule-corrections', { as: await staff(), query: { status: 'REJECTED' } });
    expect(list.status).toBe(200);
    expect(list.json.data).toHaveLength(1);
    expect(list.json.data[0].id).toBe(first);
    expect(list.json.meta.total).toBe(1);
    await assertAnonymous(list.text);
    const paged = await api.get('/v1/staff/schedule-corrections', { as: await staff(), query: { limit: 1, page: 2 } });
    expect(paged.status).toBe(200);
    expect(paged.json.data).toHaveLength(1);
    expect(paged.json.meta.total).toBe(2);
    expect(paged.json.meta.page).toBe(2);
    expect((await api.get('/v1/staff/schedule-corrections', { as: await staff(), query: { status: 'NOPE' } })).status).toBe(400);
  });

  test('staffListHidesOpenCorrectionsOfEndedCommissions', async () => {
    const running = await suggestOk(as(SUGGESTER), P1);
    const superseded = await suggestOk(student(2), P1, OTHER_COMMISSION);
    const rejected = await suggestOk(student(3), P2, OTHER_COMMISSION);
    const applied = await suggestOk(student(4), slots('FRIDAY 18:00-21:00'), OTHER_COMMISSION);
    const pending = await suggestOk(student(5), slots('SATURDAY 09:00-12:00'), OTHER_COMMISSION);
    expect((await staffPost(superseded, 'apply')).status).toBe(200);
    expect((await staffPost(rejected, 'reject')).status).toBe(200);
    expect((await staffPost(applied, 'apply')).status).toBe(200);
    expect(await statusOf(superseded)).toBe('SUPERSEDED');
    expect(await statusOf(pending)).toBe('PENDING');

    const list = async (status?: string) => (await api.get('/v1/staff/schedule-corrections', { as: await staff(), query: { status } })).json;
    expect((await list()).meta.total).toBe(5);

    await api.db`UPDATE public.commission SET course_end = ${artDate(-1)} WHERE id = ${OTHER_COMMISSION}`;
    const all = await list();
    expect(all.data.map((c: { id: string }) => c.id)).toEqual([running]);
    expect(all.meta.total).toBe(1);
    const p = await list('PENDING');
    expect(p.data.map((c: { id: string }) => c.id)).toEqual([running]);
    expect(p.meta.total).toBe(1);
    const a = await list('APPLIED');
    expect(a.data).toHaveLength(0);
    expect(a.meta.total).toBe(0);
    expect((await list('REJECTED')).data.map((c: { id: string }) => c.id)).toEqual([rejected]);
    expect((await list('SUPERSEDED')).data.map((c: { id: string }) => c.id)).toEqual([superseded]);

    await api.db`UPDATE public.commission SET course_end = ${artDate(0)} WHERE id = ${OTHER_COMMISSION}`;
    expect((await list('APPLIED')).data.map((c: { id: string }) => c.id)).toEqual([applied]);
    expect((await list('PENDING')).meta.total).toBe(2);
  });

  test('staffEndpointsRequireStaff', async () => {
    const id = await suggestOk(as(SUGGESTER), P1);
    expect((await api.get('/v1/staff/schedule-corrections', { as: await student(2) })).status).toBe(403);
    expect((await api.post(`/v1/staff/schedule-corrections/${id}/apply`, { as: await student(2) })).status).toBe(403);
    expect((await api.post(`/v1/staff/schedule-corrections/${id}/reject`)).status).toBe(401);
    expect(await statusOf(id)).toBe('PENDING');
  });

  test.skipIf(!hasSubjects)('subjectsOverlayServesTheEffectiveScheduleAndOpenCorrections', async () => {
    const plain = await subjectsCommission();
    expect(plain.name).toBe('G');
    expect(plain.schedule[0].day).toBe('MONDAY');
    expect('sga_schedule' in plain).toBe(false);
    expect(plain.corrections).toHaveLength(0);

    const applied = await suggestOk(as(SUGGESTER), P1);
    await vote(student(2), applied, 'CONFIRM');
    await vote(student(3), applied, 'CONFIRM');
    const pendingLow = await suggestOk(student(4), slots('FRIDAY 18:00-21:00'));
    const pendingHigh = await suggestOk(student(5), P2);
    await vote(student(6), pendingHigh, 'CONFIRM');
    await vote(student(7), pendingHigh, 'REJECT');
    const rejected = await suggestOk(student(8), slots('SATURDAY 09:00-12:00'));
    expect((await staffPost(rejected, 'reject')).status).toBe(200);

    const anon = await subjectsCommission();
    expect(anon.commission_id).toBe(COMMISSION);
    expect(anon.schedule).toHaveLength(2);
    expect(anon.schedule[0]).toMatchObject({ day: 'TUESDAY', time_from: '09:00:00', time_to: '12:00:00', classroom: '102T', building: 'SDT' });
    expect(anon.schedule[1].day).toBe('WEDNESDAY');
    expect(anon.sga_schedule[0]).toMatchObject({ day: 'MONDAY', time_from: '08:00:00' });
    const list = anon.corrections;
    expect(list).toHaveLength(3);
    expect(list[0]).toMatchObject({ id: applied, status: 'APPLIED', confirms: 3 });
    expect(list[1]).toMatchObject({ id: pendingHigh, confirms: 2, rejects: 1 });
    expect(list[2].id).toBe(pendingLow);
    expect(list[2].schedule[0].classroom).toBe('102T');
    for (const c of list) {
      expect('my_vote' in c).toBe(true);
      expect(c.my_vote).toBeNull();
      expect(c.created_at).toBeTruthy();
    }
    await assertAnonymous(JSON.stringify(anon));

    const mine = (await subjectsCommission(student(7))).corrections;
    expect(mine[0].my_vote).toBeNull();
    expect(mine[1].my_vote).toBe('REJECT');
    expect((await subjectsCommission(as(SUGGESTER))).corrections[0].my_vote).toBe('CONFIRM');

    const other = await subjectsCommission(undefined, OTHER_COMMISSION);
    expect(other.schedule[0].day).toBe('MONDAY');
    expect('sga_schedule' in other).toBe(false);
  });

  test.skipIf(!hasSubjects)('extraCorrectedSlotsHaveEmptyRooms', async () => {
    const id = await suggestOk(as(SUGGESTER), slots('MONDAY 08:00-11:00', 'WEDNESDAY 08:00-10:00', 'FRIDAY 14:00-16:00'));
    await vote(student(2), id, 'CONFIRM');
    await vote(student(3), id, 'CONFIRM');
    const schedule = (await subjectsCommission()).schedule;
    expect(schedule).toHaveLength(3);
    expect(schedule[2]).toMatchObject({ day: 'FRIDAY', classroom: '', building: '' });
  });

  test.skipIf(!hasCommissions)('commissionsEndpointServesCorrectedTimes', async () => {
    const id = await suggestOk(as(SUGGESTER), P1);
    await vote(student(2), id, 'CONFIRM');
    await vote(student(3), id, 'CONFIRM');
    const r = await api.get('/v1/commissions', { query: { plan: PLAN } });
    expect(r.status).toBe(200);
    for (const c of r.json) {
      if (c.id === COMMISSION) expect(c.times[0]).toMatchObject({ day: 'TUESDAY', hourFrom: '09:00', hourTo: '12:00', classroom: '102T' });
      else expect(c.times[0].day).toBe('MONDAY');
    }
  });

  test.skipIf(!hasSubjects || !hasCommissions)('overlaysFollowTheNewestTermInBothEndpoints', async () => {
    const current = await suggestOk(as(SUGGESTER), P1);
    await vote(student(2), current, 'CONFIRM');
    await vote(student(3), current, 'CONFIRM');
    await api.db`INSERT INTO public.commission (id, subject_code, commission_name, course_start, course_end, enrolled_students, quota, subject_type)
                 VALUES ('48120', ${SUBJECT}, 'G', ${artDate(157)}, ${artDate(281)}, 0, 30, 'SEMESTRAL')`;
    await api.db`INSERT INTO public.commission_time (course_id, day, hour_from, classroom, building, hour_to) VALUES ('48120', 'MONDAY', '08:00', '102T', 'SDT', '11:00')`;
    const nextId = await suggestOk(student(4), slots('THURSDAY 14:00-17:00'), '48120');

    const root = (await api.get('/v1/subjects', { query: { plan: PLAN } })).json;
    const shown = root.Ciclo['1']['1'][0].commissions;
    expect(shown).toHaveLength(1);
    expect(shown[0].commission_id).toBe('48120');
    expect(shown[0].schedule[0].day).toBe('MONDAY');
    expect(shown[0].corrections).toHaveLength(1);
    expect(shown[0].corrections[0].id).toBe(nextId);

    const list = (await api.get('/v1/commissions', { query: { plan: PLAN } })).json;
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('48120');
    expect(list[0].times[0].day).toBe('MONDAY');
  });

  test('myCorrectionsListAndSeenNotice', async () => {
    const older = await suggestOk(as(SUGGESTER), P1);
    const newerId = await suggestOk(as(SUGGESTER), P2, OTHER_COMMISSION);

    const first = await api.get('/v1/me/schedule-corrections', { as: await as(SUGGESTER) });
    expect(first.status).toBe(200);
    expect(first.json).toHaveLength(2);
    expect(first.json[0].id).toBe(newerId);
    expect(first.json[0].commissionName).toBe('B');
    expect(first.json[1]).toMatchObject({ id: older, subjectId: SUBJECT, subjectName: SUBJECT_NAME, commissionName: 'G', myVote: 'CONFIRM', appliedAt: null, seen: true });

    await vote(student(2), older, 'CONFIRM');
    await vote(student(3), older, 'CONFIRM');
    const after = (await api.get('/v1/me/schedule-corrections', { as: await as(SUGGESTER) })).json;
    expect(after[1].status).toBe('APPLIED');
    expect(after[1].appliedAt).toBeTruthy();
    expect(after[1].seen).toBe(false);

    const foreign = await api.post(`/v1/me/schedule-corrections/${older}/seen`, { as: await student(2) });
    expect(foreign.status).toBe(404);
    expect(foreign.json.message).toBe(`ScheduleCorrection with identifier '${older}' not found`);
    const seen = await api.post(`/v1/me/schedule-corrections/${older}/seen`, { as: await as(SUGGESTER) });
    expect(seen.status).toBe(204);
    expect(seen.text).toBe('');
    expect((await api.post(`/v1/me/schedule-corrections/${older}/seen`, { as: await as(SUGGESTER) })).status).toBe(204);
    expect((await api.get('/v1/me/schedule-corrections', { as: await as(SUGGESTER) })).json[1].seen).toBe(true);

    const others = await api.get('/v1/me/schedule-corrections', { as: await student(2) });
    expect(others.status).toBe(200);
    expect(others.text).toBe('[]');
  });

  test('concurrentVotesAreAllCountedAndApplyOnce', async () => {
    const id = await suggestOk(as(SUGGESTER), P1);
    const voters = 16;
    const who = await Promise.all(Array.from({ length: voters }, (_, i) => as(`par${i}@itba.edu.ar`)));
    const results = await Promise.all(who.map((w, i) => voteAs(w, id, i % 4 === 0 ? 'REJECT' : 'CONFIRM')));
    expect(results.every((r) => r.status === 200)).toBe(true);
    const [c] = await api.db`SELECT confirm_count, reject_count, status, applied_at FROM public.schedule_correction WHERE id = ${id}`;
    expect(c!.confirm_count).toBe(1 + 12);
    expect(c!.reject_count).toBe(4);
    expect(c!.status).toBe('APPLIED');
    expect(c!.applied_at).not.toBeNull();
    expect(await appliedPushEvents()).toBe(1);
  });

  test.skipIf(!hasAccountDeletion)('deletingAccountsKeepsCorrectionsAndFixesCounters', async () => {
    const id = await suggestOk(as(SUGGESTER), P1);
    await vote(student(2), id, 'CONFIRM');
    await vote(student(3), id, 'REJECT');
    expect((await api.delete('/v1/me', { as: await student(2) })).status).toBeLessThan(300);
    expect((await api.delete('/v1/me', { as: await as(SUGGESTER) })).status).toBeLessThan(300);
    const [c] = await api.db`SELECT suggester_id, confirm_count, reject_count FROM public.schedule_correction WHERE id = ${id}`;
    expect(c!.suggester_id).toBeNull();
    expect(c!.confirm_count).toBe(0);
    expect(c!.reject_count).toBe(1);
  });

  test.skipIf(!hasAccountDeletion)('deletingAnAccountReEvaluatesTheCorrectionsItVotedOn', async () => {
    const unapplies = await suggestOk(as(SUGGESTER), P1);
    await vote(student(2), unapplies, 'CONFIRM');
    await vote(student(3), unapplies, 'CONFIRM');
    expect(await statusOf(unapplies)).toBe('APPLIED');

    const other = await suggestOk(student(4), P2, OTHER_COMMISSION);
    await vote(student(5), other, 'CONFIRM');
    await vote(student(6), other, 'CONFIRM');
    await vote(student(3), other, 'REJECT');
    await vote(student(7), other, 'REJECT');
    await vote(student(8), other, 'REJECT');
    expect(await statusOf(other)).toBe('PENDING');

    expect((await api.delete('/v1/me', { as: await student(3) })).status).toBeLessThan(300);
    const [first] = await api.db`SELECT confirm_count, status FROM public.schedule_correction WHERE id = ${unapplies}`;
    expect(first!.confirm_count).toBe(2);
    expect(first!.status).toBe('PENDING');
    const [second] = await api.db`SELECT confirm_count, reject_count, status FROM public.schedule_correction WHERE id = ${other}`;
    expect(second).toEqual({ confirm_count: 3, reject_count: 2, status: 'APPLIED' });
  });
});

// Not in the IT: exact error bodies and the staff/my shapes, verified on the jar.
describe('ScheduleCorrection messages and shapes', () => {
  test('validationMessages', async () => {
    const msg = async (body: string) => (await suggestAs(student(1), COMMISSION, body)).json.message;
    expect(await msg('{"schedule":[]}')).toBe("Validation failed for field 'schedule' with value '0': must contain between 1 and 6 slots");
    expect(await msg('{}')).toBe('schedule: must not be null');
    expect(await msg('{"schedule":[null]}')).toBe("Validation failed for field 'schedule[0]' with value 'null': slot is required");
    expect(await msg(slots('SUNDAY 09:00-12:00'))).toBe("Validation failed for field 'schedule[0].day' with value 'SUNDAY': must be MONDAY..SATURDAY");
    expect(await msg(slots('FUNDAY 09:00-12:00'))).toBe("Validation failed for field 'schedule[0].day' with value 'FUNDAY': must be MONDAY..SATURDAY");
    expect(await msg('{"schedule":[{"time_from":"09:00","time_to":"10:00"}]}')).toBe("Validation failed for field 'schedule[0].day' with value 'null': is required");
    expect(await msg(slots('TUESDAY 12:00-09:00'))).toBe("Validation failed for field 'schedule[0]' with value '12:00-09:00': time_from must be before time_to");
    expect(await msg(slots('TUESDAY 06:30-09:00'))).toBe("Validation failed for field 'schedule[0]' with value '06:30-09:00': slots must be between 07:00 and 23:30");
    expect(await msg(slots('TUESDAY 9:00-12:00'))).toBe("Validation failed for field 'schedule[0].time_from' with value '9:00': must be HH:mm or HH:mm:ss");
    expect(await msg(slots('TUESDAY 09:00-25:00'))).toBe("Validation failed for field 'schedule[0].time_to' with value '25:00': must be HH:mm or HH:mm:ss");
    expect(await msg(slots('TUESDAY 09:00:30-12:00'))).toBe("Validation failed for field 'schedule[0].time_from' with value '09:00:30': must be a whole minute");
    expect(await msg(slots('TUESDAY 09:00-12:00', 'MONDAY 08:00-09:00', 'TUESDAY 11:00-13:00'))).toBe("Validation failed for field 'schedule' with value 'TUESDAY 11:00-13:00': overlaps TUESDAY 09:00-12:00 on the same day");
    // Lenient day / camelCase aliases and spaces.
    const ok = await suggestAs(student(1), COMMISSION, '{"schedule":[{"day":" tuesday ","timeFrom":" 09:00 ","timeTo":"12:00:00"}]}');
    expect(ok.status).toBe(201);
    expect(ok.json.correction.schedule).toEqual([{ day: 'TUESDAY', classroom: '102T', building: 'SDT', time_from: '09:00:00', time_to: '12:00:00' }]);
    const same = await suggestAs(student(2), COMMISSION, slots('WEDNESDAY 08:00-10:00', 'MONDAY 08:00-11:00'));
    expect(same.json.message).toBe('The proposed schedule is the same as the SGA schedule');
    const nf = await suggestAs(student(1), 'nope', '{"schedule":[]}');
    expect(nf.status).toBe(404);
    expect(nf.json.message).toBe("Commission with identifier 'nope' not found");
    const ended = await suggestAs(student(1), ENDED_COMMISSION, P1);
    expect(ended.json.message).toBe(`Commission ${ENDED_COMMISSION} has ended`);
    await suggestOk(as(SUGGESTER), P1);
    expect((await suggestAs(as(SUGGESTER), COMMISSION, P2)).json.message).toBe('You already have a pending correction for this commission');
    const badVote = await voteAs(student(1), crypto.randomUUID(), 'MAYBE');
    expect(badVote.json).toMatchObject({ error: 'BadRequest', message: 'Malformed or invalid request body' });
    const nullVote = await api.put(`/v1/schedule-corrections/${crypto.randomUUID()}/vote`, { as: await student(1), body: '{}' });
    expect(nullVote.json.message).toBe('type: must not be null');
  });

  test('staffAndMineShapes', async () => {
    const id = await suggestOk(as(SUGGESTER), P1);
    const TS = '"\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3}|\\.\\d{6})?Z"';
    const sched = '\\[\\{"day":"TUESDAY","classroom":"102T","building":"SDT","time_from":"09:00:00","time_to":"12:00:00"\\},\\{"day":"WEDNESDAY","classroom":"201F","building":"SDF","time_from":"08:00:00","time_to":"10:00:00"\\}\\]';
    const sga = '\\[\\{"day":"MONDAY","classroom":"102T","building":"SDT","time_from":"08:00:00","time_to":"11:00:00"\\},\\{"day":"WEDNESDAY","classroom":"201F","building":"SDF","time_from":"08:00:00","time_to":"10:00:00"\\}\\]';
    const list = await api.get('/v1/staff/schedule-corrections', { as: await staff() });
    expect(list.text).toMatch(new RegExp(`^\\{"data":\\[\\{"id":"${id}","commissionId":"45112","status":"PENDING","schedule":${sched},"confirms":1,"rejects":0,"createdAt":${TS},"subjectId":"31\\.08","subjectName":"${SUBJECT_NAME}","commissionName":"G","sgaSchedule":${sga},"appliedAt":null,"reviewedAt":null,"reviewedByStaff":false\\}\\],"meta":\\{"total":1,"page":1,"limit":20\\}\\}$`));
    const mine = await api.get('/v1/me/schedule-corrections', { as: await as(SUGGESTER) });
    expect(mine.text).toMatch(new RegExp(`^\\[\\{"id":"${id}","commissionId":"45112","status":"PENDING","schedule":${sched},"confirms":1,"rejects":0,"myVote":"CONFIRM","createdAt":${TS},"subjectId":"31\\.08","subjectName":"${SUBJECT_NAME}","commissionName":"G","appliedAt":null,"seen":true\\}\\]$`));
    const v = await voteAs(student(2), id, 'REJECT');
    expect(v.text).toMatch(new RegExp(`^\\{"id":"${id}","commissionId":"45112","status":"PENDING","schedule":${sched},"confirms":1,"rejects":1,"myVote":"REJECT","createdAt":${TS}\\}$`));
    expect(v.json.createdAt).toBe(list.json.data[0].createdAt);
    const rej = await staffPost(id, 'reject');
    expect(rej.text).toMatch(new RegExp(`"status":"REJECTED",.*"appliedAt":null,"reviewedAt":${TS},"reviewedByStaff":true\\}$`));
    // Clamped paging.
    expect((await api.get('/v1/staff/schedule-corrections', { as: await staff(), query: { page: 0, limit: 500 } })).json.meta).toEqual({ total: 1, page: 1, limit: 100 });
    const nf = await staffPost(crypto.randomUUID(), 'apply');
    expect(nf.status).toBe(404);
  });
});
