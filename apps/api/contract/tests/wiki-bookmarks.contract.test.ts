// Ports apps/api/src/test/java/org/ceitba/api/web/wiki/SubjectBookmarkAuthIT.java
// and PinnedSubjectsIT.java (web/wiki/SubjectBookmarkController).
// MockMvc's jwt() becomes a real JWT; repository assertions become SQL.
import { beforeEach, describe, expect, test } from 'bun:test';
import { bearer, mintJwt, useServer, type As } from '../support';

const api = useServer();

const jwtFor = async (email: string, name: string): Promise<As> => bearer(await mintJwt({ email, name }));
const count = async (q: Promise<{ n: number }[]>) => Number((await q)[0]!.n);
const userExists = async (email: string) => (await count(api.db`SELECT count(*)::int AS n FROM public."user" WHERE email = ${email}`)) > 0;
const bookmarkCount = () => count(api.db`SELECT count(*)::int AS n FROM wiki.subject_bookmarks`);

describe('SubjectBookmarkAuthIT', () => {
  beforeEach(async () => {
    await api.db`TRUNCATE wiki.subject_bookmarks, public."user", public.subject CASCADE`;
    await api.db`INSERT INTO public.subject (id, name, credits, updated_at) VALUES ('93.12', 'Algoritmos', 6, now())`;
  });

  test('postCreatesBookmarkAndJitProvisionsUser', async () => {
    expect(await userExists('alice@itba.edu.ar')).toBe(false);
    const r = await api.post('/v1/wiki/bookmarks/93.12', { as: await jwtFor('alice@itba.edu.ar', 'Alice') });
    expect(r.status).toBe(200);
    expect(r.text).toBe('{"count":1,"bookmarked":true}');
    expect(r.headers.get('content-type')).toBe('application/json');
    expect(await userExists('alice@itba.edu.ar')).toBe(true);
    expect(await bookmarkCount()).toBe(1);
  });

  test('putIsIdempotent', async () => {
    const alice = await jwtFor('alice@itba.edu.ar', 'Alice');
    expect((await api.put('/v1/wiki/bookmarks/93.12', { as: alice })).status).toBe(200);
    const r = await api.put('/v1/wiki/bookmarks/93.12', { as: alice });
    expect(r.status).toBe(200);
    expect(r.json.count).toBe(1);
    expect(await bookmarkCount()).toBe(1);
  });

  test('deleteRemovesBookmarkAndIs204', async () => {
    const alice = await jwtFor('alice@itba.edu.ar', 'Alice');
    expect((await api.post('/v1/wiki/bookmarks/93.12', { as: alice })).status).toBe(200);
    const d = await api.delete('/v1/wiki/bookmarks/93.12', { as: alice });
    expect(d.status).toBe(204);
    expect(d.text).toBe('');
    const r = await api.get('/v1/wiki/bookmarks/93.12');
    expect(r.json.count).toBe(0);
  });

  test('deleteWithNoExistingBookmarkIsStill204', async () => {
    const r = await api.delete('/v1/wiki/bookmarks/93.12', { as: await jwtFor('alice@itba.edu.ar', 'Alice') });
    expect(r.status).toBe(204);
  });

  test('countIsGlobalEvenForAnonymousReader', async () => {
    expect((await api.post('/v1/wiki/bookmarks/93.12', { as: await jwtFor('alice@itba.edu.ar', 'Alice') })).status).toBe(200);
    expect((await api.post('/v1/wiki/bookmarks/93.12', { as: await jwtFor('bob@itba.edu.ar', 'Bob') })).status).toBe(200);
    const r = await api.get('/v1/wiki/bookmarks/93.12');
    expect(r.status).toBe(200);
    expect(r.text).toBe('{"count":2,"bookmarked":false}');
  });

  test('disallowedEmailIsRejectedWith403', async () => {
    const r = await api.post('/v1/wiki/bookmarks/93.12', { as: await jwtFor('evil@gmail.com', 'Evil') });
    expect(r.status).toBe(403);
    expect(await bookmarkCount()).toBe(0);
    expect(await userExists('evil@gmail.com')).toBe(false);
  });

  test('explicitlyAllowedExternalEmailIsAccepted', async () => {
    const r = await api.post('/v1/wiki/bookmarks/93.12', { as: await jwtFor('external@gmail.com', 'External') });
    expect(r.status).toBe(200);
    expect(await userExists('external@gmail.com')).toBe(true);
  });

  test('twoConsecutiveAuthenticatedRequestsReuseSameUserRow', async () => {
    const alice = await jwtFor('alice@itba.edu.ar', 'Alice');
    expect((await api.post('/v1/wiki/bookmarks/93.12', { as: alice })).status).toBe(200);
    expect((await api.delete('/v1/wiki/bookmarks/93.12', { as: alice })).status).toBe(204);
    expect(await count(api.db`SELECT count(*)::int AS n FROM public."user"`)).toBe(1);
  });

  // Not in the IT: the signed-in caller's own flag, and an unknown subject id
  // (the FK fails: 409 DataIntegrityViolation), and the anonymous list.
  test('getStateShowsTheCallersOwnFlag', async () => {
    const alice = await jwtFor('alice@itba.edu.ar', 'Alice');
    await api.put('/v1/wiki/bookmarks/93.12', { as: alice });
    expect((await api.get('/v1/wiki/bookmarks/93.12', { as: alice })).text).toBe('{"count":1,"bookmarked":true}');
    expect((await api.get('/v1/wiki/bookmarks/93.12', { as: await jwtFor('bob@itba.edu.ar', 'Bob') })).text).toBe('{"count":1,"bookmarked":false}');
  });

  test('bookmarkingAnUnknownSubjectIsAConstraintViolation', async () => {
    const r = await api.put('/v1/wiki/bookmarks/NOPE', { as: await jwtFor('alice@itba.edu.ar', 'Alice') });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe('DataIntegrityViolation');
    expect((await api.get('/v1/wiki/bookmarks/NOPE')).text).toBe('{"count":0,"bookmarked":false}');
  });
});

describe('PinnedSubjectsIT', () => {
  const as = (email: string) => jwtFor(email, email);

  beforeEach(async () => {
    await api.db`TRUNCATE wiki.subject_bookmarks, wiki.kb_page, wiki.drive_file, wiki.drive_source, public."user", public.subject CASCADE`;
    for (let i = 10; i < 45; i++) {
      await api.db`INSERT INTO public.subject (id, name, credits, updated_at) VALUES (${`90.${i}`}, ${`Materia ${i}`}, 3, now())`;
    }
    const owner = crypto.randomUUID();
    await api.db`INSERT INTO public."user" (id, email, name, created_at, updated_at) VALUES (${owner}, 'autora@itba.edu.ar', 'Autora', now(), now())`;
    const source = crypto.randomUUID();
    await api.db`INSERT INTO wiki.drive_source (id, user_id, root_folder_id, root_name, status, consent_version, consented_at, approved_at)
                 VALUES (${source}, ${owner}, 'root', 'Apuntes', 'ACTIVE', '2026-10', now(), now())`;
    await api.db`INSERT INTO wiki.drive_file (id, source_id, drive_id, name, mime_type, kind, owned_by_sharer, effective_subject_id, publication)
                 VALUES (${crypto.randomUUID()}, ${source}, 'd1', 'a.pdf', 'application/pdf', 'PDF', true, '90.10', 'PUBLISHED')`;
    await api.db`INSERT INTO wiki.kb_page (subject_id, slug, type, title, summary, markdown, generator, generated_at)
                 VALUES ('90.10', 'index', 'INDEX', 'Materia 10', 's', 'm', 'manual', now())`;
  });

  test('listCapAndAccess', async () => {
    const me = await as('alumno@itba.edu.ar');
    const anon = await api.get('/v1/wiki/bookmarks');
    expect(anon.status).toBe(401);
    const empty = await api.get('/v1/wiki/bookmarks', { as: me });
    expect(empty.status).toBe(200);
    expect(empty.text).toBe('[]');

    expect((await api.put('/v1/wiki/bookmarks/90.10', { as: me })).status).toBe(200);
    await api.db`UPDATE wiki.subject_bookmarks SET updated_at = now() - interval '1 hour'`;
    expect((await api.put('/v1/wiki/bookmarks/90.11', { as: me })).status).toBe(200);
    expect((await api.put('/v1/wiki/bookmarks/90.12', { as: await as('otro@itba.edu.ar') })).status).toBe(200);

    const r = await api.get('/v1/wiki/bookmarks', { as: me });
    expect(r.status).toBe(200);
    expect(r.json.length).toBe(2);
    expect(r.json[0]).toMatchObject({ subjectId: '90.11', subjectName: 'Materia 11', fileCount: 0, hasWiki: false });
    expect(r.json[0].pinnedAt).toBeString();
    expect(r.json[1]).toMatchObject({ subjectId: '90.10', fileCount: 1, hasWiki: true });
    // Byte-level shape: keys in record order, pinnedAt read from the DB (UTC `Z`).
    const [pin] = await api.db`SELECT updated_at::text AS t FROM wiki.subject_bookmarks WHERE subject_id = '90.10'`;
    expect(r.text).toMatch(/^\[\{"subjectId":"90\.11","subjectName":"Materia 11","fileCount":0,"hasWiki":false,"pinnedAt":"[^"]+Z"\},\{"subjectId":"90\.10","subjectName":"Materia 10","fileCount":1,"hasWiki":true,"pinnedAt":"[^"]+Z"\}\]$/);
    expect(pin).toBeDefined();

    const state = await api.get('/v1/wiki/bookmarks/90.10');
    expect(state.status).toBe(200);
    expect(state.json.count).toBe(1);

    for (let i = 13; i < 41; i++) {
      expect((await api.put(`/v1/wiki/bookmarks/90.${i}`, { as: me })).status).toBe(200);
    }
    const limited = await api.put('/v1/wiki/bookmarks/90.41', { as: me });
    expect(limited.status).toBe(409);
    expect(limited.json).toMatchObject({ error: 'BOOKMARK_LIMIT', message: 'You can pin at most 30 subjects', path: '/api/v1/wiki/bookmarks/90.41' });
    expect((await api.put('/v1/wiki/bookmarks/90.10', { as: me })).status).toBe(200);
    expect((await api.delete('/v1/wiki/bookmarks/90.10', { as: me })).status).toBe(204);
    expect((await api.put('/v1/wiki/bookmarks/90.41', { as: me })).status).toBe(200);
  });

  // Not in the IT: POST hits the same cap as PUT.
  test('postHitsTheSameCap', async () => {
    const me = await as('alumno@itba.edu.ar');
    for (let i = 10; i < 40; i++) expect((await api.post(`/v1/wiki/bookmarks/90.${i}`, { as: me })).status).toBe(200);
    expect((await api.post('/v1/wiki/bookmarks/90.40', { as: me })).json.error).toBe('BOOKMARK_LIMIT');
    expect((await api.post('/v1/wiki/bookmarks/90.10', { as: me })).text).toBe('{"count":1,"bookmarked":true}');
  });
});
