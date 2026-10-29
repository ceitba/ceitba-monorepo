// Ports apps/api/src/test/java/org/ceitba/api/service/sync/FirestoreImportServiceTest.java
// and FirestoreImportResponseTest.java. The Java test runs the service over
// Mockito repositories; here it runs over a real database clone (test/support/app.ts),
// with the proposal importer swapped through the service's seam like the
// Java test's mock. Failures Mockito injected are produced for real
// (a 22001 value-too-long for the constraint case) or through the seam.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { FirestoreImportReport, FirestoreImportService, importResponse, PROPUESTAS, USUARIOS, type FirestoreBenefitDoc, type FirestoreExport, type FirestoreUserDoc, type ProposalImporterPort } from '../../src/features/sync/firestoreImport';
import { FirestoreImportError, type Outcome } from '../../src/features/sync/proposalImporter';
import { MutableClock } from '../../src/infra/clock';
import { testApp, type TestApp } from '../support/app';

let t: TestApp;
let proposals: ProposalImporterPort & { available: boolean; impl: (id: string, doc: Record<string, unknown>, w: string[]) => Promise<Outcome>; calls: number };
let service: FirestoreImportService;

beforeAll(async () => {
  t = await testApp({ overrides: { clock: new MutableClock('2026-03-01T12:00:00Z') } });
  proposals = {
    available: true, calls: 0,
    impl: async () => 'CREATED',
    isAvailable() { return this.available; },
    importProposal(id, doc, w) { this.calls++; return this.impl(id, doc, w); },
  };
  service = new FirestoreImportService(t.deps, () => proposals);
  // The Java test stubs orgs.existsById("ceitba"); the IT schema (V4.x) has no V7 seed.
  await t.sql`INSERT INTO public.organizations (slug, name, full_name) VALUES ('ceitba', 'CEITBA', 'Centro de Estudiantes del ITBA') ON CONFLICT DO NOTHING`;
}, 60_000);
afterAll(async () => { await t?.close(); });

beforeEach(async () => {
  proposals.available = true;
  proposals.calls = 0;
  proposals.impl = async () => 'CREATED';
  await t.sql`DELETE FROM public.ceitba_moderators`;
  await t.sql`DELETE FROM public.user_follows`;
  await t.sql`DELETE FROM public."user"`;
  await t.sql`DELETE FROM public.benefit_cards`;
  await t.sql`DELETE FROM public.benefits`;
  await t.sql`DELETE FROM public.plan`;
  await t.sql`DELETE FROM public.careers`;
  await t.sql`INSERT INTO public.careers (id, name, updated_at) VALUES ('S', 'Ingeniería en Informática', now()), ('PAI', 'Proceso de Admisión', now())`;
  await t.sql`INSERT INTO public.plan (id, career_id, name, updated_at) VALUES ('S10-Rev23', 'S', 'S10-Rev23', now()), ('PX-Current', 'PAI', 'PX-Current', now())`;
  await t.sql`INSERT INTO public.benefits (slug, color_var) VALUES ('convenios', 'x'), ('deportes', 'x'), ('idiomas', 'x')`;
});

const userDoc = (id: string | null, email: string | null, degree: string | null, plan: string | null): FirestoreUserDoc =>
  ({ id, email, name: 'Alumno Prueba', degree, plan, moderator: false, socialMedia: null });
const users = (...docs: FirestoreUserDoc[]): FirestoreExport => ({ usuarios: docs, propuestas: null, benefits: null });
const benefits = (...docs: FirestoreBenefitDoc[]): FirestoreExport => ({ usuarios: null, propuestas: null, benefits: docs });
const benefit = (title: string, category: string | null, description: string[]): FirestoreBenefitDoc => ({
  id: `b-${title.toLowerCase()}`, title, category, imageUrl: 'https://img.example.test/a.png', description, location: 'Av. Siempreviva 742',
  locationUrl: 'https://maps.example.test/x', inscriptionUrl: 'https://forms.example.test/x', phone: '+54 11 0000-0000',
  website: 'https://partner.example.test', email: 'contacto@partner.example.test',
});
const social = (linkedin: string | null, instagram: string | null, discord: string | null) => ({ linkedin, instagram, discord });
async function allUsers() { return t.sql`SELECT * FROM public."user"`; }
async function onlyUser() {
  const rows = await allUsers();
  expect(rows.length).toBe(1);
  return rows[0]!;
}
async function insertUser(email: string, name: string | null, extra: { firebaseUid?: string; careerId?: string; instagram?: string } = {}) {
  const id = crypto.randomUUID();
  await t.sql`INSERT INTO public."user" (id, email, name, firebase_uid, career_id, instagram, created_at, updated_at)
    VALUES (${id}, ${email}, ${name}, ${extra.firebaseUid ?? null}, ${extra.careerId ?? null}, ${extra.instagram ?? null}, now(), now())`;
  return id;
}
const followCount = async () => Number((await t.sql`SELECT count(*)::int AS n FROM public.user_follows`)[0]!.n);
const cards = () => t.sql`SELECT * FROM public.benefit_cards ORDER BY created_at`;

describe('FirestoreImportServiceTest', () => {
  test('createsUserWithUidCareerPlanAndHandles', async () => {
    const r = await service.importExport(users({ id: 'uid-1', email: 'Alumno.Uno@Example.test', name: '  Alumno Uno ', degree: 'Ingeniería en Informática',
      plan: 'S10-Rev23', moderator: false, socialMedia: social('https://www.linkedin.com/in/alumno-uno/', '@Alumno.Uno', 'alumno_uno') }), false);
    expect(r.created).toBe(1);
    expect(r.usuarios.created).toBe(1);
    expect(r.errors).toEqual([]);
    const u = await onlyUser();
    expect([u.email, u.firebase_uid, u.name, u.career_id, u.plan, u.linkedin, u.instagram, u.discord])
      .toEqual(['alumno.uno@example.test', 'uid-1', 'Alumno Uno', 'S', 'S10-Rev23', 'alumno-uno', 'alumno.uno', 'alumno_uno']);
    expect(await followCount()).toBe(1);
  });

  test('deletedAccountIsNotReimported', async () => {
    await t.sql`INSERT INTO public.deleted_firebase_accounts (firebase_uid_sha256) VALUES (encode(sha256(convert_to('uid-gone', 'UTF8')), 'hex'))`;
    const fresh = await insertUser('gone@example.test', null);
    const r = await service.importExport(users(userDoc('uid-gone', 'gone@example.test', 'S', null)), false);
    expect(r.usuarios.skipped).toBe(1);
    expect(r.errors).toEqual([]);
    expect(r.warnings.map((w) => w.message)).toEqual(['account was deleted in the new app; not re-imported']);
    const u = await onlyUser();
    expect([u.id, u.firebase_uid, u.career_id]).toEqual([fresh, null, null]);
    await t.sql`DELETE FROM public.deleted_firebase_accounts`;
  });

  test('careerMatchesByIdToo', async () => {
    await service.importExport(users(userDoc('uid-1', 'a@example.test', 'S', null)), false);
    const u = await onlyUser();
    expect([u.career_id, u.plan]).toEqual(['S', null]);
  });

  test('rerunIsIdempotent', async () => {
    const exp = users({ id: 'uid-1', email: 'a@example.test', name: 'Alumno', degree: 'S', plan: 'S10-Rev23', moderator: true, socialMedia: social('', 'alumno', '') });
    await service.importExport(exp, false);
    const second = await service.importExport(exp, false);
    expect((await allUsers()).length).toBe(1);
    expect(Number((await t.sql`SELECT count(*)::int AS n FROM public.ceitba_moderators`)[0]!.n)).toBe(1);
    expect([second.created, second.updated, second.skipped]).toEqual([0, 0, 1]);
    expect(await followCount()).toBe(1);
  });

  test('unknownDegreeLeavesCareerAndPlanNull', async () => {
    await service.importExport(users(userDoc('uid-1', 'a@example.test', 'ADM', 'Ingreso')), false);
    const u = await onlyUser();
    expect([u.career_id, u.plan]).toEqual([null, null]);
  });

  test('planOutsideTheCareerCatalogueDropsTheCareerToo', async () => {
    await service.importExport(users(userDoc('uid-1', 'a@example.test', 'Proceso de Admisión', 'PX-Old')), false);
    const u = await onlyUser();
    expect([u.career_id, u.plan]).toEqual([null, null]);
  });

  test('appAbbreviatedCareerLabelIsNotGuessed', async () => {
    await service.importExport(users(userDoc('uid-1', 'a@example.test', 'Ing. Informática', 'S10-Rev23')), false);
    const u = await onlyUser();
    expect([u.career_id, u.plan]).toEqual([null, null]);
  });

  test('existingUserKeepsItsValuesAndOnlyFillsNulls', async () => {
    const id = await insertUser('a@example.test', 'Nombre Nuevo', { careerId: 'PAI', instagram: 'ya.cargado' });
    const r = await service.importExport(users({ id: 'uid-1', email: 'A@EXAMPLE.TEST', name: 'Nombre Viejo', degree: 'S', plan: 'S10-Rev23',
      moderator: false, socialMedia: social(null, 'otro', 'nuevo_discord') }), false);
    expect(r.updated).toBe(1);
    const u = await onlyUser();
    expect([u.id, u.firebase_uid, u.name, u.career_id, u.plan, u.instagram, u.discord])
      .toEqual([id, 'uid-1', 'Nombre Nuevo', 'PAI', null, 'ya.cargado', 'nuevo_discord']);
    expect(await followCount()).toBe(0);
  });

  test('moderatorFlagCreatesGrant', async () => {
    await service.importExport(users({ id: 'uid-1', email: 'mod@example.test', name: 'Mod', degree: null, plan: null, moderator: true, socialMedia: null }), false);
    const u = await onlyUser();
    const [g] = await t.sql`SELECT granted_by, revoked_at, granted_at FROM public.ceitba_moderators WHERE user_id = ${u.id}`;
    expect(g!.granted_by).toBeNull();
    expect(g!.revoked_at).toBeNull();
    expect(new Date(g!.granted_at).toISOString()).toBe('2026-03-01T12:00:00.000Z');
  });

  test('moderatorGrantOnExistingUserCountsAsUpdate', async () => {
    const id = await insertUser('mod@example.test', 'Mod', { firebaseUid: 'uid-1' });
    const r = await service.importExport(users({ id: 'uid-1', email: 'mod@example.test', name: 'Mod', degree: null, plan: null, moderator: true, socialMedia: null }), false);
    expect(r.updated).toBe(1);
    expect((await t.sql`SELECT 1 FROM public.ceitba_moderators WHERE user_id = ${id}`).length).toBe(1);
  });

  test('revokedModeratorIsNotRegranted', async () => {
    const id = await insertUser('mod@example.test', 'Mod', { firebaseUid: 'uid-1' });
    await t.sql`INSERT INTO public.ceitba_moderators (user_id, granted_at, revoked_at) VALUES (${id}, '2025-01-01T00:00:00Z', '2025-06-01T00:00:00Z')`;
    const r = await service.importExport(users({ id: 'uid-1', email: 'mod@example.test', name: 'Mod', degree: null, plan: null, moderator: true, socialMedia: null }), false);
    expect((await t.sql`SELECT revoked_at FROM public.ceitba_moderators WHERE user_id = ${id}`)[0]!.revoked_at).not.toBeNull();
    expect(r.skipped).toBe(1);
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0]!.message).toContain('revoked');
  });

  test('invalidHandleIsDroppedWithWarning', async () => {
    const r = await service.importExport(users({ id: 'uid-1', email: 'a@example.test', name: 'A', degree: null, plan: null, moderator: false,
      socialMedia: social('https://example.test/not-linkedin', 'ok_handle', null) }), false);
    const u = await onlyUser();
    expect([u.linkedin, u.instagram]).toEqual([null, 'ok_handle']);
    expect(r.warnings).toEqual([{ collection: 'usuarios', id: 'uid-1', message: 'invalid linkedin handle dropped' }]);
  });

  test('badDocumentsAreReportedWithoutEmailsAndOthersStillImport', async () => {
    const r = await service.importExport(users(userDoc('uid-1', null, null, null), userDoc('uid-2', 'not-an-email', null, null),
      userDoc(null, 'x@example.test', null, null), userDoc('uid-4', 'ok@example.test', null, null)), false);
    expect(r.created).toBe(1);
    expect(r.usuarios.errors).toBe(3);
    expect(r.errors.length).toBe(3);
    for (const e of r.errors) expect(e.message).not.toContain('@');
    expect(r.errors.map((e) => e.id)).toEqual(['uid-1', 'uid-2', null]);
  });

  test('uidAndEmailOnDifferentUsersIsAnError', async () => {
    await insertUser('a@example.test', 'A', { firebaseUid: 'uid-a' });
    const b = await insertUser('b@example.test', 'B');
    const r = await service.importExport(users(userDoc('uid-a', 'b@example.test', null, null)), false);
    expect(r.errors.map((e) => e.message)).toEqual(['firebase uid and email belong to different users']);
    expect((await t.sql`SELECT firebase_uid FROM public."user" WHERE id = ${b}`)[0]!.firebase_uid).toBeNull();
  });

  test('emailAlreadyLinkedToAnotherUidIsAnError', async () => {
    const a = await insertUser('a@example.test', 'A', { firebaseUid: 'uid-old' });
    const r = await service.importExport(users(userDoc('uid-new', 'a@example.test', null, null)), false);
    expect(r.usuarios.errors).toBe(1);
    expect((await t.sql`SELECT firebase_uid FROM public."user" WHERE id = ${a}`)[0]!.firebase_uid).toBe('uid-old');
  });

  // Java injects a DataIntegrityViolationException on flush; here a real one: a name longer than the column (22001).
  test('constraintViolationIsReportedGenerically', async () => {
    const doc = { ...userDoc('uid-1', 'a@example.test', null, null), name: 'n'.repeat(300) };
    const r = await service.importExport(users(doc), false);
    expect(r.errors.map((e) => e.message)).toEqual(['conflicts with an existing row']);
    expect((await allUsers()).length).toBe(0);
  });

  // Java throws IllegalStateException from a mocked repository; here the proposal seam throws one.
  test('unexpectedExceptionIsReportedByTypeOnly', async () => {
    proposals.impl = async () => { throw Object.assign(new Error('boom a@example.test'), { javaName: 'IllegalStateException' }); };
    const r = await service.importExport({ usuarios: null, propuestas: [{ id: 'p1' }], benefits: null }, false);
    expect(r.errors.map((e) => e.message)).toEqual(['unexpected error (IllegalStateException)']);
  });

  test('dryRunMarksEveryDocumentTransactionRollbackOnly', async () => {
    const r = await service.importExport({ usuarios: [userDoc('uid-1', 'a@example.test', 'S', 'S10-Rev23')], propuestas: null,
      benefits: [benefit('Gimnasio', 'deportes', ['10% off'])] }, true);
    expect(r.dryRun).toBe(true);
    expect(r.created).toBe(2);
    // Every document transaction rolled back: nothing written.
    expect((await allUsers()).length).toBe(0);
    expect((await cards()).length).toBe(0);
    expect(await followCount()).toBe(0);
  });

  test('nullDocumentsAndMissingCollectionsAreIgnored', async () => {
    const r = await service.importExport({ usuarios: [null], propuestas: null, benefits: null }, false);
    expect(r.created + r.updated + r.skipped).toBe(0);
    expect(r.errors).toEqual([]);
  });

  test('benefitIsMappedToCard', async () => {
    const r = await service.importExport(benefits(benefit('Gimnasio', 'Deportes', [' 10% off ', '', 'Pase libre'])), false);
    expect(r.benefits.created).toBe(1);
    const [c, ...rest] = await cards();
    expect(rest.length).toBe(0);
    expect([c!.title_es, c!.title_en, c!.category_slug, c!.bullets_es, c!.cta_url, c!.image_url, c!.location, c!.location_url, c!.phone, c!.website, c!.email])
      .toEqual(['Gimnasio', 'Gimnasio', 'deportes', ['10% off', 'Pase libre'], 'https://forms.example.test/x', 'https://img.example.test/a.png',
        'Av. Siempreviva 742', 'https://maps.example.test/x', '+54 11 0000-0000', 'https://partner.example.test', 'contacto@partner.example.test']);
  });

  test('unknownOrMissingCategoryFallsBackToConvenios', async () => {
    const r = await service.importExport(benefits(benefit('Pizzeria', 'comida', ['2x1']), benefit('Otro', null, ['x'])), false);
    expect(new Set((await cards()).map((c) => c.category_slug))).toEqual(new Set(['convenios']));
    expect(r.warnings.map((w) => w.message)).toEqual(["unknown category 'comida' filed under convenios"]);
  });

  test('benefitRerunUpdatesInPlaceWithoutDuplicates', async () => {
    await service.importExport(benefits(benefit('Gimnasio', 'deportes', ['10% off'])), false);
    await t.sql`UPDATE public.benefit_cards SET title_en = 'Gym'`;
    const same = await service.importExport(benefits(benefit('gimnasio', 'deportes', ['10% off'])), false);
    const changed = await service.importExport(benefits(benefit('Gimnasio', 'deportes', ['20% off'])), false);
    const all = await cards();
    expect(all.length).toBe(1);
    expect(same.benefits.updated).toBe(1);
    expect(changed.benefits.updated).toBe(1);
    expect([all[0]!.bullets_es, all[0]!.title_es, all[0]!.title_en]).toEqual([['20% off'], 'Gimnasio', 'Gym']);
    expect((await service.importExport(benefits(benefit('Gimnasio', 'deportes', ['20% off'])), false)).benefits.skipped).toBe(1);
  });

  test('nonHttpUrlsAndOversizedFieldsAreDropped', async () => {
    const r = await service.importExport(benefits({ id: 'b1', title: 'Curso', category: 'idiomas', imageUrl: 'javascript:alert(1)', description: null,
      location: null, locationUrl: 'intent://x', inscriptionUrl: 'www.no-scheme.test', phone: '1'.repeat(65), website: 'https://ok.example.test', email: null }), false);
    const [c] = await cards();
    expect([c!.image_url, c!.location_url, c!.cta_url, c!.phone, c!.website, c!.bullets_es]).toEqual([null, null, null, null, 'https://ok.example.test', []]);
    expect(r.warnings.length).toBe(4);
  });

  test('benefitWithoutTitleOrWithAmbiguousTitleIsAnError', async () => {
    await t.sql`INSERT INTO public.benefit_cards (category_slug, title_es, title_en) VALUES ('convenios', 'Duplicado', 'Duplicado'), ('convenios', 'duplicado', 'duplicado')`;
    const r = await service.importExport(benefits(benefit('Duplicado', 'convenios', []),
      { id: 'b2', title: ' ', category: null, imageUrl: null, description: null, location: null, locationUrl: null, inscriptionUrl: null, phone: null, website: null, email: null }), false);
    expect(r.benefits.errors).toBe(2);
    expect(r.errors.map((e) => e.message)).toEqual(['several benefit cards share this title', 'missing title']);
  });

  test('proposalsAreSkippedWhileImporterIsUnavailable', async () => {
    proposals.available = false;
    const r = await service.importExport({ usuarios: null, propuestas: [{ id: 'p1' }, { id: 'p2' }], benefits: null }, false);
    expect(r.propuestas.skipped).toBe(2);
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0]!.collection).toBe('propuestas');
    expect(proposals.calls).toBe(0);
  });

  test('proposalsGoThroughTheImporterWhenAvailable', async () => {
    proposals.impl = async (id) => {
      if (id === 'p1') return 'CREATED';
      throw new FirestoreImportError('unknown author');
    };
    const r = await service.importExport({ usuarios: null, propuestas: [{ id: 'p1' }, { id: 'p2' }, { title: 'no id' }], benefits: null }, false);
    expect(r.propuestas.created).toBe(1);
    expect(r.propuestas.errors).toBe(2);
    expect(r.errors.map((e) => e.message)).toEqual(['unknown author', 'missing document id']);
  });

  test('importerWarningsAreReportedUnderTheDocument', async () => {
    proposals.impl = async (_id, _doc, w) => { w.push('2 votes by users not imported dropped'); return 'UPDATED'; };
    const r = await service.importExport({ usuarios: null, propuestas: [{ id: 'p1' }], benefits: null }, false);
    expect(r.propuestas.updated).toBe(1);
    expect(r.warnings).toEqual([{ collection: 'propuestas', id: 'p1', message: '2 votes by users not imported dropped' }]);
  });
});

describe('FirestoreImportResponseTest', () => {
  test('mapsEveryCounterAndIssueAndKeepsTheJsonShape', () => {
    const report = new FirestoreImportReport(true);
    report.usuarios.count('CREATED');
    report.usuarios.count('CREATED');
    report.benefits.count('UPDATED');
    report.propuestas.count('SKIPPED');
    report.propuestas.errors++;
    report.error(PROPUESTAS, 'prop-1', 'missing title');
    report.warning(USUARIOS, 'uid-1', 'invalid discord handle dropped');
    const response = importResponse(report);
    expect(response.dryRun).toBe(true);
    expect([response.created, response.updated, response.skipped]).toEqual([2, 1, 1]);
    expect(response.usuarios).toEqual({ created: 2, updated: 0, skipped: 0, errors: 0 });
    expect(response.benefits).toEqual({ created: 0, updated: 1, skipped: 0, errors: 0 });
    expect(response.propuestas).toEqual({ created: 0, updated: 0, skipped: 1, errors: 1 });
    expect(response.errors).toEqual([{ collection: 'propuestas', id: 'prop-1', message: 'missing title' }]);
    expect(response.warnings).toEqual([{ collection: 'usuarios', id: 'uid-1', message: 'invalid discord handle dropped' }]);
    expect(JSON.stringify(response)).toBe('{"dryRun":true,"created":2,"updated":1,"skipped":1,"usuarios":{"created":2,"updated":0,"skipped":0,"errors":0},"benefits":{"created":0,"updated":1,"skipped":0,"errors":0},"propuestas":{"created":0,"updated":0,"skipped":1,"errors":1},"errors":[{"collection":"propuestas","id":"prop-1","message":"missing title"}],"warnings":[{"collection":"usuarios","id":"uid-1","message":"invalid discord handle dropped"}]}');
  });
});
