// Subject reviews (docs/SUBJECT-REVIEWS.md): reviews, professors by ITBA
// address (fake directory: REVIEWS_DIRECTORY_USE_FAKE), "Me sirvió", reports
// that hide at 3, and the staff queue. Bun-only: no Java counterpart.
import { beforeEach, describe, expect, test } from 'bun:test';
import { currentTerm } from '../../src/features/review/service';
import { bearer, mintJwt, seedStaff, seedUser, useServer, type As } from '../support';

const api = useServer();

const ANA = 'ana@itba.edu.ar';
const BETO = 'beto@itba.edu.ar';
const CAMI = 'cami@itba.edu.ar';
const DANI = 'dani@itba.edu.ar';
const STAFF = 'staff@itba.edu.ar';

const as = async (email: string): Promise<As> => bearer(await mintJwt({ email, name: null }));
// The server runs on the real clock: terms relative to today (Argentina).
const NOW = currentTerm(new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }));
const Y = NOW.year - 1; // a past year: both of its terms started
const review = (o: Record<string, unknown> = {}) => ({
  year: Y, period: 2, commission: 'A', recommend: true, difficulty: 2, professorIds: [], comment: 'Hacer las guías al día.', ...o,
});
const post = async (email: string, body: unknown, subject = '93.59') => api.post(`/v1/subjects/${subject}/reviews`, { as: await as(email), body });
const list = async (email: string, subject = '93.59') => api.get(`/v1/subjects/${subject}/reviews`, { as: await as(email) });
const lookup = async (email: string, address: string) => api.post('/v1/professors/lookup', { as: await as(email), body: { email: address } });

beforeEach(async () => {
  await api.db`TRUNCATE public."user", public.subject, public.professor CASCADE`;
  for (const e of [ANA, BETO, CAMI, DANI]) await seedUser(api.db, e, { name: e });
  await seedStaff(api.db, STAFF);
  await api.db`INSERT INTO public.subject (id, name, updated_at) VALUES ('93.59', 'Análisis Matemático II', now())`;
  // The Opiniones tab is part of Apuntes: every student route needs the capability.
  await api.db`INSERT INTO public.capability_settings (capability, enabled_for_all) VALUES ('apuntes', true)
    ON CONFLICT (capability) DO UPDATE SET enabled_for_all = true`;
});

describe('SubjectReviews', () => {
  test('create_listsAnonymouslyWithTheProfessorsItNames', async () => {
    const garcia = (await lookup(ANA, 'MGarcia@itba.edu.ar')).json;
    const benitez = (await lookup(ANA, 'lbenitez@itba.edu.ar')).json;
    const r = await post(ANA, review({ professorIds: [garcia.id, benitez.id, garcia.id] }));
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ year: Y, period: 2, commission: 'A', recommend: true, difficulty: 2, comment: 'Hacer las guías al día.',
      helpfulCount: 0, helpful: false, reported: false, mine: true, hidden: false });
    // Deduplicated, in name order ("Laura Benítez" < "María García").
    expect(r.json.professorIds).toEqual([benitez.id, garcia.id]);

    const other = await list(BETO);
    expect(other.status).toBe(200);
    expect(other.json.subjectName).toBe('Análisis Matemático II');
    expect(other.json.reviews).toHaveLength(1);
    expect(other.json.reviews[0].mine).toBe(false);
    expect(other.json.professors).toEqual([{ id: benitez.id, name: 'Laura Benítez' }, { id: garcia.id, name: 'María García' }]);
    // Nothing identifies the author or the professors' addresses.
    expect(other.text).not.toContain('ana@');
    expect(other.text).not.toContain('@itba.edu.ar');
    expect(Object.keys(other.json.reviews[0])).toEqual(['id', 'year', 'period', 'commission', 'professorIds', 'recommend', 'difficulty',
      'comment', 'helpfulCount', 'helpful', 'reported', 'mine', 'hidden', 'createdAt', 'updatedAt']);
  });

  test('blankCommentIsNull_andNewestTermFirst', async () => {
    expect((await post(ANA, review({ year: Y, period: 1, comment: '   ' }))).json.comment).toBeNull();
    await post(BETO, review({ year: Y, period: 2 }));
    const r = await list(CAMI);
    expect(r.json.reviews.map((x: { year: number; period: number }) => `${x.period}C${x.year}`)).toEqual([`2C${Y}`, `1C${Y}`]);
  });

  test('onePerStudentSubjectAndTerm_409', async () => {
    expect((await post(ANA, review())).status).toBe(201);
    const r = await post(ANA, review({ commission: 'B' }));
    expect(r.status).toBe(409);
    expect(r.json.error).toBe('SubjectReviewExists');
    const other = await post(ANA, review({ year: Y, period: 1 }));
    expect(other.status).toBe(201);
    // Moving a review onto a term already reviewed is the same conflict.
    const moved = await api.put(`/v1/subject-reviews/${other.json.id}`, { as: await as(ANA), body: review() });
    expect(moved.status).toBe(409);
    expect(moved.json.error).toBe('SubjectReviewExists');
  });

  test('futureTerm_400_unknownProfessor_400_unknownSubject_404', async () => {
    expect((await post(ANA, review({ year: NOW.year + 1, period: 1 }))).json.error).toBe('SubjectReviewFutureTerm');
    expect((await post(ANA, review({ year: NOW.year, period: NOW.period }))).status).toBe(201); // the current term counts
    expect((await post(ANA, review({ professorIds: [crypto.randomUUID()] }))).json.error).toBe('UnknownProfessor');
    expect((await post(ANA, review(), 'XX.99')).status).toBe(404);
    expect((await list(ANA, 'XX.99')).status).toBe(404);
  });

  test('validation_400', async () => {
    const r = await post(ANA, review({ difficulty: 4, period: 3, commission: ' ' }));
    expect(r.status).toBe(400);
  });

  test('editAndDelete_onlyTheAuthor', async () => {
    const id = (await post(ANA, review())).json.id;
    expect((await api.put(`/v1/subject-reviews/${id}`, { as: await as(BETO), body: review({ recommend: false }) })).status).toBe(404);
    const r = await api.put(`/v1/subject-reviews/${id}`, { as: await as(ANA), body: review({ recommend: false, difficulty: 3 }) });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ recommend: false, difficulty: 3 });
    expect((await api.delete(`/v1/subject-reviews/${id}`, { as: await as(BETO) })).status).toBe(404);
    expect((await api.delete(`/v1/subject-reviews/${id}`, { as: await as(ANA) })).status).toBe(204);
    expect((await list(ANA)).json.reviews).toEqual([]);
  });

  test('helpful_idempotentAndNotOnYourOwn', async () => {
    const id = (await post(ANA, review())).json.id;
    expect((await api.put(`/v1/subject-reviews/${id}/helpful`, { as: await as(BETO) })).status).toBe(204);
    expect((await api.put(`/v1/subject-reviews/${id}/helpful`, { as: await as(BETO) })).status).toBe(204);
    expect((await list(BETO)).json.reviews[0]).toMatchObject({ helpfulCount: 1, helpful: true });
    expect((await list(CAMI)).json.reviews[0]).toMatchObject({ helpfulCount: 1, helpful: false });
    expect((await api.put(`/v1/subject-reviews/${id}/helpful`, { as: await as(ANA) })).json.error).toBe('SubjectReviewOwn');
    expect((await api.delete(`/v1/subject-reviews/${id}/helpful`, { as: await as(BETO) })).status).toBe(204);
    expect((await list(BETO)).json.reviews[0].helpfulCount).toBe(0);
  });

  test('threeReportsHide_authorStillSeesIt_staffRestores', async () => {
    const id = (await post(ANA, review())).json.id;
    const report = async (email: string) => api.put(`/v1/subject-reviews/${id}/report`, { as: await as(email), body: { reason: 'OFFENSIVE', comment: 'x' } });
    expect((await report(ANA)).json.error).toBe('SubjectReviewOwn');
    expect((await report(BETO)).status).toBe(204);
    expect((await report(BETO)).status).toBe(204); // one per user
    expect((await report(CAMI)).status).toBe(204);
    expect((await list(BETO)).json.reviews[0].reported).toBe(true);
    expect((await report(DANI)).status).toBe(204);

    expect((await list(BETO)).json.reviews).toEqual([]);
    expect((await list(ANA)).json.reviews[0]).toMatchObject({ mine: true, hidden: true });
    expect((await api.put(`/v1/subject-reviews/${id}/helpful`, { as: await as(BETO) })).status).toBe(404);
    // The author cannot delete it to post a fresh copy without reports.
    const del = await api.delete(`/v1/subject-reviews/${id}`, { as: await as(ANA) });
    expect(del.status).toBe(409);
    expect(del.json.error).toBe('SubjectReviewHidden');

    const queue = await api.get('/v1/staff/subject-reviews', { as: await as(STAFF) });
    expect(queue.status).toBe(200);
    expect(queue.json).toHaveLength(1);
    expect(queue.json[0]).toMatchObject({ id, subjectId: '93.59', subjectName: 'Análisis Matemático II', reportCount: 3 });
    expect(queue.json[0].reports).toHaveLength(3);

    expect((await api.post(`/v1/staff/subject-reviews/${id}/restore`, { as: await as(STAFF) })).status).toBe(204);
    expect((await list(BETO)).json.reviews[0]).toMatchObject({ id, reported: false });
    expect((await api.get('/v1/staff/subject-reviews', { as: await as(STAFF) })).json).toEqual([]);

    expect((await api.delete(`/v1/staff/subject-reviews/${id}`, { as: await as(STAFF) })).status).toBe(204);
    expect((await list(BETO)).json.reviews).toEqual([]);
  });

  test('concurrentReportsStillHideAtThree', async () => {
    for (let i = 0; i < 5; i++) {
      await api.db`DELETE FROM public.subject_review`;
      const id = (await post(ANA, review())).json.id;
      const report = async (email: string) => api.put(`/v1/subject-reviews/${id}/report`, { as: await as(email), body: { reason: 'SPAM' } });
      await report(BETO);
      const [x, y] = await Promise.all([report(CAMI), report(DANI)]);
      expect([x.status, y.status]).toEqual([204, 204]);
      const [row] = await api.db`SELECT report_count, hidden FROM public.subject_review WHERE id = ${id}`;
      expect(row).toEqual({ report_count: 3, hidden: true });
    }
  });

  test('staffRoutes_403ForStudents', async () => {
    expect((await api.get('/v1/staff/subject-reviews', { as: await as(ANA) })).status).toBe(403);
    expect((await api.post(`/v1/staff/subject-reviews/${crypto.randomUUID()}/restore`, { as: await as(ANA) })).status).toBe(403);
    expect((await api.delete(`/v1/staff/subject-reviews/${crypto.randomUUID()}`, { as: await as(ANA) })).status).toBe(403);
    expect((await api.post(`/v1/staff/subject-reviews/${crypto.randomUUID()}/restore`, { as: await as(STAFF) })).status).toBe(404);
  });

  test('anonymous_401_evenThoughSubjectReadsArePublic', async () => {
    expect((await api.get('/v1/subjects/93.59')).status).toBe(200);
    expect((await api.get('/v1/subjects/93.59/reviews')).status).toBe(401);
    expect((await api.post('/v1/professors/lookup', { body: { email: 'mgarcia@itba.edu.ar' } })).status).toBe(401);
  });

  test('studentRoutes_403WithoutTheApuntesCapability', async () => {
    const mineId = (await post(ANA, review())).json.id;
    await api.db`DELETE FROM public.capability_settings WHERE capability = 'apuntes'`;
    const id = mineId as string;
    const calls: [string, () => Promise<{ status: number; json: { error?: string; message?: string } }>][] = [
      ['list', () => list(BETO)],
      ['create', () => post(BETO, review())],
      ['update', async () => api.put(`/v1/subject-reviews/${id}`, { as: await as(ANA), body: review() })],
      ['delete', async () => api.delete(`/v1/subject-reviews/${id}`, { as: await as(ANA) })],
      ['helpful', async () => api.put(`/v1/subject-reviews/${id}/helpful`, { as: await as(BETO) })],
      ['unhelpful', async () => api.delete(`/v1/subject-reviews/${id}/helpful`, { as: await as(BETO) })],
      ['report', async () => api.put(`/v1/subject-reviews/${id}/report`, { as: await as(BETO), body: { reason: 'SPAM' } })],
      ['lookup', () => lookup(BETO, 'mgarcia@itba.edu.ar')],
    ];
    for (const [name, call] of calls) {
      const r = await call();
      expect([name, r.status, r.json.error, r.json.message]).toEqual([name, 403, 'CAPABILITY_REQUIRED', "This feature requires the 'apuntes' capability"]);
    }
    // Nothing happened: no professor looked up, the review untouched.
    expect((await api.db`SELECT 1 FROM public.professor`).length).toBe(0);
    expect((await api.db`SELECT 1 FROM public.subject_review WHERE id = ${id}`).length).toBe(1);
    // A bad body is still a 400 first (the check runs after binding).
    expect((await api.post('/v1/professors/lookup', { as: await as(BETO), body: { email: 'not-an-email' } })).status).toBe(400);
    // Staff hold every capability; anonymous callers are still 401.
    expect((await list(STAFF)).status).toBe(200);
    expect((await api.get('/v1/subjects/93.59/reviews')).status).toBe(401);
  });

  test('professorLookup', async () => {
    const r = await lookup(ANA, 'MGARCIA@itba.edu.ar');
    expect(r.status).toBe(200);
    expect(Object.keys(r.json)).toEqual(['id', 'name']);
    expect(r.json.name).toBe('María García');
    expect((await lookup(BETO, 'mgarcia@itba.edu.ar')).json.id).toBe(r.json.id); // stored once
    expect((await api.db`SELECT email FROM public.professor`).map((x) => x.email)).toEqual(['mgarcia@itba.edu.ar']);

    const notFound = await lookup(ANA, 'nadie@itba.edu.ar');
    expect(notFound.status).toBe(404);
    expect(notFound.json.error).toBe('ProfessorNotFound');
    const domain = await lookup(ANA, 'mgarcia@gmail.com');
    expect(domain.status).toBe(400);
    expect(domain.json.error).toBe('ProfessorEmailDomain');
    expect((await lookup(ANA, 'not-an-email')).status).toBe(400);
  });
});

describe('SubjectReviews without a directory', () => {
  const real = useServer({ env: { REVIEWS_DIRECTORY_USE_FAKE: 'false' } });

  test('lookupOfAnUnknownProfessor_503_whenNoAccountHasTheDirectoryScope', async () => {
    await real.db`TRUNCATE public."user" CASCADE`;
    await real.db`INSERT INTO public.capability_settings (capability, enabled_for_all) VALUES ('apuntes', true)
      ON CONFLICT (capability) DO UPDATE SET enabled_for_all = true`;
    const r = await real.post('/v1/professors/lookup', { as: await as(ANA), body: { email: 'mgarcia@itba.edu.ar' } });
    expect(r.status).toBe(503);
    expect(r.json.error).toBe('ProfessorDirectoryUnavailable');
  });
});
