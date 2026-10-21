// Ports apps/api/src/test/java/org/ceitba/api/web/sync/FirestoreImportIT.java
// with the same PII-free fixture (apps/api/src/test/resources/fixtures/firestore-export.json).
// The /v1/proposals reads are skipped on ts until the proposal feature lands.
import { beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { nameUuid } from '../../src/features/sync/proposalImporter';
import { apiKey, bearer, mintJwt, seedCareer, seedPlan, supports, TEST_SYNC_KEY, useServer } from '../support';

const api = useServer();
const FIXTURE = readFileSync(join(import.meta.dir, '../../../api/src/test/resources/fixtures/firestore-export.json'), 'utf8');
const hasProposals = await supports('GET /v1/proposals/{id}', 'GET /v1/proposals/{id}/comments', 'PUT /v1/proposals/{id}/vote', 'POST /v1/proposals/{id}/comments');
const proposal = (doc: string) => nameUuid(`firestore:propuestas:${doc}`);
let fixture = FIXTURE;

const runImport = (dryRun: boolean) => api.post(`/v1/sync/import/firestore?dryRun=${dryRun}`, { as: apiKey(TEST_SYNC_KEY), body: fixture });
const count = async (q: string) => Number((await api.db.unsafe(q))[0]!.n);
async function user(uid: string) {
  const [u] = await api.db`SELECT * FROM public."user" WHERE firebase_uid = ${uid}`;
  return u!;
}
const viewer = async () => bearer(await mintJwt({ email: 'lector@itba.edu.ar', name: 'Lector' }));

describe('FirestoreImportIT', () => {
  beforeEach(async () => {
    fixture = FIXTURE;
    await api.db`DELETE FROM public.proposal`;
    await api.db`DELETE FROM public.ceitba_moderators`;
    await api.db`DELETE FROM public.user_follows`;
    await api.db`DELETE FROM public."user"`;
    await api.db`DELETE FROM public.benefit_cards`;
    await api.db`DELETE FROM public.benefits`;
    await api.db`DELETE FROM public.plan`;
    await api.db`DELETE FROM public.careers`;
    await seedCareer(api.db, 'S', 'Ingeniería en Informática');
    await seedCareer(api.db, 'PAI', 'Proceso de Admisión');
    await seedPlan(api.db, 'S10-Rev23', 'S', 'S10-Rev23');
    await seedPlan(api.db, 'PX-Current', 'PAI', 'PX-Current');
    await api.db`INSERT INTO public.benefits (slug, color_var, display_order) VALUES ('convenios', '--dept-color-media', 1), ('deportes', '--dept-color-infra', 2)`;
  });

  test('requiresSyncApiKey', async () => {
    expect((await api.post('/v1/sync/import/firestore', { body: fixture })).status).toBe(401);
  });

  test('dryRunReportsWithoutWriting', async () => {
    const r = await runImport(true);
    expect(r.status).toBe(200);
    expect(r.json.dryRun).toBe(true);
    expect(r.json.created).toBe(9);
    expect(r.json.updated).toBe(0);
    expect(r.json.skipped).toBe(0);
    expect(r.json.errors.length).toBe(2);
    expect(r.json.errors[0].id).toBe('uid-sin-email');
    expect(r.json.errors[1].id).toBe('prop-invalida');
    expect(await count('SELECT count(*)::int AS n FROM public."user"')).toBe(0);
    expect(await count('SELECT count(*)::int AS n FROM public.benefit_cards')).toBe(0);
    expect(await count('SELECT count(*)::int AS n FROM public.ceitba_moderators')).toBe(0);
    expect(await count('SELECT count(*)::int AS n FROM public.proposal')).toBe(0);
  });

  test('importsFixtureAndRerunIsIdempotent', async () => {
    const r = await runImport(false);
    expect(r.status).toBe(200);
    expect(r.json.dryRun).toBe(false);
    expect(r.json.usuarios.created).toBe(4);
    expect(r.json.usuarios.errors).toBe(1);
    expect(r.json.benefits.created).toBe(2);
    expect(r.json.propuestas.created).toBe(3);
    expect(r.json.propuestas.errors).toBe(1);
    expect(r.json.errors[0].collection).toBe('usuarios');
    expect(r.json.errors[0].message).toBe('missing or invalid email');
    expect(r.text).not.toContain('example.test"');
    // The whole report, byte for byte (everything in it is deterministic).
    expect(r.text).toBe('{"dryRun":false,"created":9,"updated":0,"skipped":0,"usuarios":{"created":4,"updated":0,"skipped":0,"errors":1},"benefits":{"created":2,"updated":0,"skipped":0,"errors":0},"propuestas":{"created":3,"updated":0,"skipped":0,"errors":1},'
      + '"errors":[{"collection":"usuarios","id":"uid-sin-email","message":"missing or invalid email"},{"collection":"propuestas","id":"prop-invalida","message":"authorized must be 0, 1 or 2"}],'
      + `"warnings":${JSON.stringify(r.json.warnings)}}`);

    expect(await count('SELECT count(*)::int AS n FROM public."user"')).toBe(4);
    expect(await count('SELECT count(*)::int AS n FROM public.benefit_cards')).toBe(2);

    const alumno = await user('uid-alumno-1');
    expect(alumno.email).toBe('alumno.uno@example.test');
    expect(alumno.career_id).toBe('S');
    expect(alumno.plan).toBe('S10-Rev23');
    expect(alumno.linkedin).toBe('alumno-uno');
    expect(alumno.instagram).toBe('alumno.uno');
    expect(alumno.discord).toBeNull();
    expect(alumno.file_number).toBeNull();
    for (const uid of ['uid-ingreso-1', 'uid-ingreso-2']) {
      const u = await user(uid);
      expect(u.career_id).toBeNull();
      expect(u.plan).toBeNull();
    }
    const mod = await user('uid-mod-1');
    expect(mod.career_id).toBe('S');
    expect(mod.plan).toBeNull();
    expect(mod.linkedin).toBeNull();
    expect(mod.discord).toBe('mod_1');
    expect(await count(`SELECT count(*)::int AS n FROM public.ceitba_moderators WHERE user_id = '${mod.id}' AND revoked_at IS NULL`)).toBe(1);
    expect(await count(`SELECT count(*)::int AS n FROM public.ceitba_moderators WHERE user_id = '${alumno.id}'`)).toBe(0);

    const pizza = await api.db`SELECT category_slug, bullets_es FROM public.benefit_cards WHERE upper(title_es) = upper('Pizzería')`;
    expect(pizza.length).toBe(1);
    expect(pizza[0]!.category_slug).toBe('convenios');
    expect(pizza[0]!.bullets_es).toEqual(['2x1 los martes']);
    const gym = await api.db`SELECT cta_url, title_en, summary_es, bullets_en FROM public.benefit_cards WHERE title_es = 'Gimnasio'`;
    expect(gym[0]).toEqual({ cta_url: 'https://forms.example.test/gym', title_en: 'Gimnasio', summary_es: '', bullets_en: [] });

    const again = await runImport(false);
    expect(again.status).toBe(200);
    expect(again.json.created).toBe(0);
    expect(again.json.updated).toBe(0);
    expect(again.json.skipped).toBe(9);
    expect(await count('SELECT count(*)::int AS n FROM public."user"')).toBe(4);
    expect(await count('SELECT count(*)::int AS n FROM public.benefit_cards')).toBe(2);
    expect(await count('SELECT count(*)::int AS n FROM public.ceitba_moderators')).toBe(1);
    expect(await count('SELECT count(*)::int AS n FROM public.proposal')).toBe(3);
  });

  test('importKeepsValuesAlreadySetInTheNewSystem', async () => {
    const id = crypto.randomUUID();
    await api.db`INSERT INTO public."user" (id, email, name, instagram, created_at, updated_at) VALUES (${id}, 'alumno.uno@example.test', 'Nombre Google', 'elegido.en.la.app', now(), now())`;
    const r = await runImport(false);
    expect(r.status).toBe(200);
    expect(r.json.usuarios.created).toBe(3);
    expect(r.json.usuarios.updated).toBe(1);
    const u = await user('uid-alumno-1');
    expect(u.id).toBe(id);
    expect(u.name).toBe('Nombre Google');
    expect(u.instagram).toBe('elegido.en.la.app');
    expect(u.career_id).toBe('S');
  });

  test.skipIf(!hasProposals)('importsLegacyProposalsIntoTheBoard', async () => {
    const r = await runImport(false);
    expect(r.status).toBe(200);
    expect(r.json.errors[1].collection).toBe('propuestas');
    expect(r.json.errors[1].message).toBe('authorized must be 0, 1 or 2');
    const p1warnings = r.json.warnings.filter((w: { id: string }) => w.id === 'prop-1').map((w: { message: string }) => w.message);
    expect(p1warnings).toContain('1 votes by users not imported dropped');
    expect(p1warnings).toContain('1 filesURL entries not copied to object storage dropped (re-export with --copy-attachments)');
    expect(p1warnings).toContain('1 malformed filesURL entries dropped');
    expect(r.json.warnings.filter((w: { id: string }) => w.id === 'prop-3').map((w: { message: string }) => w.message))
      .toContain('author not imported; proposal kept without author');
    expect(r.text).not.toContain('uid-no-importado');

    const alumno = await user('uid-alumno-1');
    const mod = await user('uid-mod-1');
    const p1 = proposal('prop-1');
    const [row] = await api.db`SELECT * FROM public.proposal WHERE id = ${p1}`;
    expect(row).toMatchObject({ author_id: alumno.id, status: 'APPROVED', lifecycle: 'ACEPTADO', topic: 'VIDA_UNIVERSITARIA', rejection_reason: null,
      moderated_by: mod.id, up_count: 1, down_count: 1, comment_count: 3 });
    expect(new Date(row!.created_at).toISOString()).toBe('2024-05-01T12:00:00.000Z');

    const view = await api.get(`/v1/proposals/${p1}`, { as: await viewer() });
    expect(view.status).toBe(200);
    expect(view.json.title).toBe('Más microondas');
    expect(view.json.authorAlias).toBe('AlfaRojo');
    expect(view.json.upCount).toBe(1);
    expect(view.json.downCount).toBe(1);
    expect(view.json.commentCount).toBe(3);
    expect(view.json.attachments.length).toBe(1);
    expect(view.json.attachments[0].position).toBe(0);
    expect(view.json.attachments[0].contentType).toBe('image/jpeg');
    const keys = await api.db`SELECT object_key FROM public.proposal_attachment WHERE proposal_id = ${p1}`;
    expect(keys.map((k) => k.object_key)).toEqual(['proposals/legacy/5d41402a-bc4b-4a76-b971-9d911017c592.jpg']);

    const comments = await api.get(`/v1/proposals/${p1}/comments`, { as: await viewer() });
    expect(comments.status).toBe(200);
    expect(comments.json.data.length).toBe(2);
    expect(comments.json.data[0].body).toBe('Comentario sin usuario');
    expect(comments.json.data[0].alias).toBeNull();
    expect(comments.json.data[1].body).toBe('Buena idea');
    expect(comments.json.data[1].alias).toBe('BetaAzul');
    expect(comments.json.data[1].replies[0].body).toBe('Gracias');
    expect(comments.json.data[1].replies[0].alias).toBe('AlfaRojo');
    expect(comments.json.data[1].replies[0].isAuthor).toBe(true);

    expect(await count(`SELECT count(*)::int AS n FROM public.proposal_alias WHERE proposal_id = '${p1}'`)).toBe(2);
    const p2 = proposal('prop-2');
    const [r2] = await api.db`SELECT status, lifecycle, topic, author_id, moderated_by FROM public.proposal WHERE id = ${p2}`;
    expect(r2).toEqual({ status: 'PENDING', lifecycle: 'ABIERTO', topic: 'CEITBA', author_id: (await user('uid-ingreso-1')).id, moderated_by: null });
    const [a2] = await api.db`SELECT alias FROM public.proposal_alias WHERE proposal_id = ${p2}`;
    expect(String(a2!.alias).trim().length).toBeGreaterThan(0);
    const [r3] = await api.db`SELECT status, topic, author_id, rejection_reason FROM public.proposal WHERE id = ${proposal('prop-3')}`;
    expect(r3).toEqual({ status: 'REJECTED', topic: 'OTROS', author_id: null, rejection_reason: 'Duplicada' });
    expect(await count(`SELECT count(*)::int AS n FROM public.proposal WHERE id = '${proposal('prop-invalida')}'`)).toBe(0);
  });

  // The same database assertions as importsLegacyProposalsIntoTheBoard, without the /v1/proposals reads (run on both targets).
  test('importsLegacyProposalsIntoTheTables', async () => {
    const r = await runImport(false);
    expect(r.status).toBe(200);
    const alumno = await user('uid-alumno-1');
    const mod = await user('uid-mod-1');
    const p1 = proposal('prop-1');
    const [row] = await api.db`SELECT * FROM public.proposal WHERE id = ${p1}`;
    expect(row).toMatchObject({ author_id: alumno.id, status: 'APPROVED', lifecycle: 'ACEPTADO', topic: 'VIDA_UNIVERSITARIA', rejection_reason: null,
      moderated_by: mod.id, up_count: 1, down_count: 1, comment_count: 3 });
    const aliases = await api.db`SELECT u.firebase_uid, a.alias FROM public.proposal_alias a JOIN public."user" u ON u.id = a.user_id WHERE a.proposal_id = ${p1} ORDER BY 1`;
    expect(aliases.map((a) => `${a.firebase_uid}=${a.alias}`)).toEqual(['uid-alumno-1=AlfaRojo', 'uid-mod-1=BetaAzul']);
    // Comment ids are keyed on the HMAC secret: both servers derive the same ids from the same export.
    const ids = await api.db`SELECT id::text AS id, body, parent_id::text AS parent FROM public.proposal_comment WHERE proposal_id = ${p1} ORDER BY created_at`;
    expect(ids.map((c) => c.body)).toEqual(['Buena idea', 'Gracias', 'Comentario sin usuario']);
    expect(ids[1]!.parent).toBe(ids[0]!.id);
    expect(ids.map((c) => c.id)).toEqual(EXPECTED_COMMENT_IDS);
  });

  test.skipIf(!hasProposals)('proposalRerunAddsOnlyWhatIsMissingAndKeepsNewActivity', async () => {
    expect((await runImport(false)).status).toBe(200);
    const p1 = proposal('prop-1');
    expect((await api.put(`/v1/proposals/${p1}/vote`, { as: await viewer(), body: { value: 'UP' } })).status).toBe(200);
    expect((await api.post(`/v1/proposals/${p1}/comments`, { as: await viewer(), body: { body: 'Nuevo comentario' } })).status).toBe(201);

    const exp = JSON.parse(FIXTURE);
    for (const doc of exp.propuestas) {
      if (doc.id === 'prop-1') doc.comments.push({ author: 'uid-mod-1', comment: 'Otro más', dateTime: '2024-05-05T10:00:00.000Z' });
    }
    fixture = JSON.stringify(exp);
    const r = await runImport(false);
    expect(r.status).toBe(200);
    expect(r.json.propuestas.created).toBe(0);
    expect(r.json.propuestas.updated).toBe(1);
    expect(r.json.propuestas.skipped).toBe(2);
    const [c] = await api.db`SELECT up_count, down_count, comment_count FROM public.proposal WHERE id = ${p1}`;
    expect(c).toEqual({ up_count: 2, down_count: 1, comment_count: 5 });
    expect(await count(`SELECT count(*)::int AS n FROM public.proposal_comment WHERE proposal_id = '${p1}' AND body = 'Otro más'`)).toBe(1);
    expect((await runImport(false)).json.propuestas.skipped).toBe(3);
  });

  // The rerun half that needs no proposal endpoint: one more legacy comment is the only change.
  test('proposalRerunAddsOnlyTheMissingComment', async () => {
    expect((await runImport(false)).status).toBe(200);
    const exp = JSON.parse(FIXTURE);
    for (const doc of exp.propuestas) {
      if (doc.id === 'prop-1') doc.comments.push({ author: 'uid-mod-1', comment: 'Otro más', dateTime: '2024-05-05T10:00:00.000Z' });
    }
    fixture = JSON.stringify(exp);
    const r = await runImport(false);
    expect(r.json.propuestas).toEqual({ created: 0, updated: 1, skipped: 2, errors: 1 });
    const [c] = await api.db`SELECT up_count, down_count, comment_count FROM public.proposal WHERE id = ${proposal('prop-1')}`;
    expect(c).toEqual({ up_count: 1, down_count: 1, comment_count: 4 });
    expect((await runImport(false)).json.propuestas.skipped).toBe(3);
  });

  test('firebaseUidIsUnique', async () => {
    await api.db`INSERT INTO public."user" (id, email, name, firebase_uid, created_at, updated_at) VALUES (${crypto.randomUUID()}, 'a@example.test', 'A', 'uid-dup', now(), now())`;
    let failed = false;
    try {
      await api.db`INSERT INTO public."user" (id, email, name, firebase_uid, created_at, updated_at) VALUES (${crypto.randomUUID()}, 'b@example.test', 'B', 'uid-dup', now(), now())`;
    } catch (e) {
      failed = (e as { code?: string }).code === '23505';
    }
    expect(failed).toBe(true);
  });

  // Not in the IT: wire shape of the body.
  test('bodyShapeErrorsAre400AndMissingCollectionsImportNothing', async () => {
    const bad = await api.post('/v1/sync/import/firestore', { as: apiKey(TEST_SYNC_KEY), body: { usuarios: 'x' } });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toBe('BadRequest');
    const empty = await api.post('/v1/sync/import/firestore', { as: apiKey(TEST_SYNC_KEY), body: { other: [1], usuarios: [null] } });
    expect(empty.text).toBe('{"dryRun":false,"created":0,"updated":0,"skipped":0,"usuarios":{"created":0,"updated":0,"skipped":0,"errors":0},"benefits":{"created":0,"updated":0,"skipped":0,"errors":0},"propuestas":{"created":0,"updated":0,"skipped":0,"errors":0},"errors":[],"warnings":[]}');
  });
});

// HMAC-SHA256 comment ids of prop-1 under the contract AUTH_JWT_SECRET (recorded from the jar).
const EXPECTED_COMMENT_IDS = ['5271622a-6846-494f-a75e-98b2054644ec', '83bd2772-2621-4646-a7e4-a5aa383fc51f', '7c93024b-a182-4a74-a083-b6cb7736e00b'];
