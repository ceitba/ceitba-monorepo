// Ports apps/api/src/test/java/org/ceitba/api/web/digest/DigestCorrectionVoteIT.java.
//
// The IT pins the clock at Monday 2026-10-05 12:00 ART; a black-box server
// runs on the real clock, so the commission's term is placed around today
// (started 60 days ago, ends in 60) instead of 2026-08-03..2026-12-05. The
// suggestion (ScheduleCorrectionService.suggest: the row plus the suggester's
// implicit CONFIRM) and the second CONFIRM are seeded as rows; staffReject is
// the REJECTED row state. The expired token is minted with a clock 15 days
// back (TTL 14 days), like the IT's Clock.fixed(NOW - 15d).
import { beforeEach, describe, expect, test } from 'bun:test';
import { bearer, mintJwt, seedStaff, seedUser, useServer } from '../support';
import { pastVoteTokens, setCapabilityOpen, voteTokens } from '../../test/digest/support/seed';
import { plusDays } from '../../src/lib/javaCompat';
import { localDateOf, systemNowMicros } from '../../src/lib/time';

const api = useServer();

const SUBJECT = '93.41';
const SUBJECT_NAME = 'Física I';
const COMMISSION = '45112';
const READER = 'lector@itba.edu.ar';
const SUGGESTER = 'sugeridor@itba.edu.ar';
const SUGGESTER_NAME = 'Sugeridor Secreto';
const URL = '/v1/digests/correction-vote';

let reader: string;
let suggester: string;
let correctionId: string;

const token = () => voteTokens().issue(reader, correctionId);
const view = (t: string, headers: Record<string, string> = {}) => api.get(URL, { query: { token: t }, headers });
const vote = (t: string, v: string, headers: Record<string, string> = {}) => api.post(URL, { body: { token: t, vote: v }, headers });

function assertAnonymous(s: string) {
  for (const x of [suggester, SUGGESTER, SUGGESTER_NAME, 'suggester']) expect(s).not.toContain(x);
}

describe('DigestCorrectionVoteIT', () => {
  beforeEach(async () => {
    const db = api.db;
    await db`
      TRUNCATE public.schedule_correction, public.saved_schedules, public.commission_time, public.commission,
               public.subject, public.digest_deliveries, public.digest_issues, public.capability_settings,
               public."user" CASCADE`;
    const today = localDateOf(systemNowMicros());
    await db`INSERT INTO public.subject (id, name, credits, updated_at) VALUES (${SUBJECT}, ${SUBJECT_NAME}, 6, now())`;
    await db`INSERT INTO public.commission (id, subject_code, commission_name, course_start, course_end, enrolled_students, quota, subject_type)
             VALUES (${COMMISSION}, ${SUBJECT}, 'A', ${plusDays(today, -60)}, ${plusDays(today, 60)}, 10, 30, 'SEMESTRAL')`;
    await db`INSERT INTO public.commission_time (course_id, day, classroom, building, hour_from, hour_to)
             VALUES (${COMMISSION}, 'MONDAY', '102T', 'SDT', '08:00', '11:00')`;
    reader = await seedUser(db, READER, { name: 'Lector' });
    suggester = await seedUser(db, SUGGESTER, { name: SUGGESTER_NAME });
    const other = await seedUser(db, 'otro@itba.edu.ar', { name: 'Otro' });

    // Suggestion = the suggester's CONFIRM; one more makes 2 of 3.
    const [row] = await db`
      INSERT INTO public.schedule_correction (commission_id, suggester_id, proposed_slots, sga_snapshot, slots_key, status,
                                              confirm_count, reject_count, created_at, updated_at, reviewed_by_staff)
      VALUES (${COMMISSION}, ${suggester}, ${db.json([{ day: 'TUESDAY', from: '09:00', to: '12:00' }])},
              ${db.json([{ day: 'MONDAY', from: '08:00', to: '11:00' }])}, 'TUESDAY 09:00-12:00', 'PENDING', 2, 0, now(), now(), false)
      RETURNING id`;
    correctionId = row!.id as string;
    await db`INSERT INTO public.schedule_correction_vote (correction_id, user_id, type, created_at, updated_at)
             VALUES (${correctionId}, ${suggester}, 'CONFIRM', now(), now()), (${correctionId}, ${other}, 'CONFIRM', now(), now())`;
  });

  test('viewShowsTheCorrectionWithoutWritingOrRevealingTheSuggester', async () => {
    const r = await view(token());
    expect(r.status).toBe(200);
    expect(r.json.subjectName).toBe(SUBJECT_NAME);
    expect(r.json.commissionName).toBe('A');
    expect(r.json.status).toBe('PENDING');
    expect(r.json.open).toBe(true);
    expect(r.json.proposed[0].day).toBe('TUESDAY');
    expect(r.json.proposed[0].from).toBe('09:00');
    expect(r.json.sga[0].day).toBe('MONDAY');
    expect(r.json.confirms).toBe(2);
    expect(r.json.myVote).toBeNull();
    expect(Object.keys(r.json)).toEqual(['correctionId', 'subjectId', 'subjectName', 'commissionName', 'status', 'open',
      'proposed', 'sga', 'confirms', 'rejects', 'myVote', 'expiresAt']);
    expect(r.text).toContain(`{"correctionId":"${correctionId}","subjectId":"93.41","subjectName":"Física I","commissionName":"A","status":"PENDING","open":true,"proposed":[{"day":"TUESDAY","from":"09:00","to":"12:00"}],"sga":[{"day":"MONDAY","from":"08:00","to":"11:00"}],"confirms":2,"rejects":0,"myVote":null,"expiresAt":"`);
    expect(r.json.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-03:00$/);
    assertAnonymous(r.text);
    expect((await view(token())).status).toBe(200);
    const [c] = await api.db`SELECT confirm_count, status FROM public.schedule_correction WHERE id = ${correctionId}`;
    expect(c).toMatchObject({ confirm_count: 2, status: 'PENDING' });
  });

  test('voteCountsTowardTheRuleAndAReplayDoesNotCountTwice', async () => {
    const t = token();
    const first = await vote(t, 'confirm');
    expect(first.status).toBe(200);
    expect(Object.keys(first.json)).toEqual(['correction', 'previousVote']);
    expect(first.json.previousVote).toBeNull();
    expect(first.json.correction.myVote).toBe('CONFIRM');
    expect(first.json.correction.confirms).toBe(3);
    expect(first.json.correction.status).toBe('APPLIED');
    assertAnonymous(first.text);
    const [applied] = await api.db`SELECT applied_at FROM public.schedule_correction WHERE id = ${correctionId}`;
    expect(applied!.applied_at).not.toBeNull();

    const replay = await vote(t, 'confirm');
    expect(replay.status).toBe(200);
    expect(replay.json.previousVote).toBe('CONFIRM');
    expect(replay.json.correction.confirms).toBe(3);

    // Changing the vote replaces it (the service allows it): back to 2 confirms.
    const changed = await vote(t, 'REJECT');
    expect(changed.status).toBe(200);
    expect(changed.json.previousVote).toBe('CONFIRM');
    expect(changed.json.correction.confirms).toBe(2);
    expect(changed.json.correction.rejects).toBe(1);
    expect(changed.json.correction.status).toBe('PENDING');
    expect((await view(t)).json.myVote).toBe('REJECT');
  });

  test('expiredInvalidAndBadVoteAreRejected', async () => {
    const expired = pastVoteTokens(15).issue(reader, correctionId);
    const ev = await view(expired);
    expect(ev.status).toBe(410);
    expect(ev.json.error).toBe('TOKEN_EXPIRED');
    expect(ev.json.message).toBe('This link has expired');
    const evp = await vote(expired, 'confirm');
    expect(evp.status).toBe(410);
    expect(evp.json.error).toBe('TOKEN_EXPIRED');

    const t = token();
    const forged = t.slice(0, -2) + (t.endsWith('AA') ? 'BB' : 'AA');
    const fv = await view(forged);
    expect(fv.status).toBe(400);
    expect(fv.json.error).toBe('INVALID_TOKEN');
    expect(fv.json.message).toBe('Invalid correction vote token');
    const fp = await vote(forged, 'confirm');
    expect(fp.status).toBe(400);
    expect(fp.json.error).toBe('INVALID_TOKEN');
    const none = await api.get(URL);
    expect(none.status).toBe(400);
    expect(none.json.error).toBe('INVALID_TOKEN');
    const maybe = await vote(t, 'maybe');
    expect(maybe.status).toBe(400);
    expect(maybe.json.error).toBe('INVALID_VOTE');
    expect(maybe.json.message).toBe('vote must be confirm or reject');

    // An unknown correction (signed, but gone) is a 404.
    const gone = await view(voteTokens().issue(reader, crypto.randomUUID()));
    expect(gone.status).toBe(404);
    expect(gone.json.error).toBe('CORRECTION_NOT_FOUND');
    expect(gone.json.message).toBe('Schedule correction not found');
    const [c] = await api.db`SELECT confirm_count FROM public.schedule_correction WHERE id = ${correctionId}`;
    expect(c!.confirm_count).toBe(2);

    // Body validation (not in the IT): @NotNull token / vote.
    const noVote = await api.post(URL, { body: { token: t } });
    expect(noVote.status).toBe(400);
    expect(noVote.json.error).toBe('ValidationError');
    expect(noVote.json.message).toBe('vote: must not be null');
  });

  test('aClosedCorrectionCanBeViewedButNotVoted', async () => {
    await api.db`UPDATE public.schedule_correction SET status = 'REJECTED', reviewed_by_staff = true, reviewed_at = now(),
                 reviewed_by = ${suggester} WHERE id = ${correctionId}`;
    const v = await view(token());
    expect(v.status).toBe(200);
    expect(v.json.status).toBe('REJECTED');
    expect(v.json.open).toBe(false);
    const p = await vote(token(), 'confirm');
    expect(p.status).toBe(409);
    expect(p.json.error).toBe('CORRECTION_CLOSED');
    expect(p.json.message).toBe('This correction no longer accepts votes (REJECTED)');
  });

  test('aStaleSessionDoesNotGetInTheWay', async () => {
    expect((await view(token(), { Authorization: 'Bearer not-a-jwt' })).status).toBe(200);
    expect((await vote(token(), 'confirm', { Authorization: 'Bearer not-a-jwt' })).status).toBe(200);
  });

  // ---- the section in the email ---------------------------------------

  async function preview(email: string): Promise<string> {
    await seedStaff(api.db, email);
    const as = bearer(await mintJwt({ email, name: 'Staff' }));
    const created = await api.post('/v1/digests', { as, body: { weekStart: '2026-09-28' } });
    const id = created.json?.id ?? ((await api.db`SELECT id::text AS id FROM public.digest_issues`)[0]!.id as string);
    const r = await api.get(`/v1/digests/${id}/preview`, { as });
    expect(r.status).toBe(200);
    return r.text;
  }

  // A real staff row holds every capability (apuntes included), where the
  // IT's mock ROLE_STAFF holds none: the preview reader is staff here, so the
  // apuntes capability only matters for whom the IT expects no wiki link.
  test('previewShowsTheReadersOwnSectionWithAWorkingVoteLink', async () => {
    await api.db`INSERT INTO public.saved_schedules (user_id, name, payload, is_primary, created_at, updated_at, payload_updated_at)
                 VALUES (${reader}, '2C', ${api.db.json({ version: 1, selectedCourses: [{ subject_id: SUBJECT, selectedCommissions: ['A'] }] })},
                         true, now(), now(), now())`;
    await setCapabilityOpen(api.db, 'apuntes', true);
    await api.db`INSERT INTO wiki.kb_page (subject_id, slug, type, title, summary, markdown, generator, generated_at)
                 VALUES (${SUBJECT}, 'index', 'INDEX', 'Física I', 'Resumen', '# Física I', 'test', '2026-09-30T12:00:00-03:00')`;

    const html = await preview(READER);
    for (const s of ['Tu cuatrimestre', SUBJECT_NAME, 'com. A', 'https://ceitba.org.ar/apuntes/93.41?vista=wiki', 'actualizado esta semana',
      'Alguien reportó que Física I (com. A) se dicta martes 09:00 a 12:00 en vez de lunes 08:00 a 11:00',
      '/correction?token=', 'vote=confirm', 'vote=reject']) expect(html).toContain(s);
    assertAnonymous(html);

    const m = /\/correction\?token=([^&"]+)&amp;vote=confirm/.exec(html);
    expect(m).not.toBeNull();
    const t = decodeURIComponent(m![1]!.replace(/\+/g, ' '));
    const v = await vote(t, 'confirm');
    expect(v.status).toBe(200);
    expect(v.json.correction.status).toBe('APPLIED');

    // Voted: the prompt is gone from the next rendering.
    await api.db`TRUNCATE public.digest_issues CASCADE`;
    const again = await preview(READER);
    expect(again).toContain(SUBJECT_NAME);
    expect(again).not.toContain('Alguien reportó');
  });

  test('theSuggesterIsNotAskedAndAReaderWithoutScheduleGetsTheCallToAction', async () => {
    await api.db`INSERT INTO public.saved_schedules (user_id, name, payload, is_primary, created_at, updated_at, payload_updated_at)
                 VALUES (${suggester}, '2C', ${api.db.json({ version: 1, selectedCourses: [{ subject_id: SUBJECT, selectedCommissions: ['A'] }] })},
                         true, now(), now(), now())`;
    // No published wiki page: no wiki link whatever the capabilities (the IT: no apuntes capability).
    const html = await preview(SUGGESTER);
    expect(html).toContain('Tu cuatrimestre');
    expect(html).toContain(SUBJECT_NAME);
    expect(html).not.toContain('Alguien reportó');
    expect(html).not.toContain('vista=wiki');

    await api.db`TRUNCATE public.digest_issues CASCADE`;
    const cta = await preview(READER);
    expect(cta).toContain('Armá tu horario en la app');
    expect(cta).toContain('https://ceitba.org.ar/app/horario');
    expect(cta).not.toContain('Alguien reportó');
  });
});
