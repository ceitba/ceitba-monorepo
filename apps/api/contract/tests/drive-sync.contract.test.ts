// Black-box port of apps/api/src/test/java/org/ceitba/api/web/drive/DriveSyncIT.java.
//
// The IT drives an injected FakeDriveClient and an InMemoryObjectStorage. A
// black-box server only offers the fake's demo folders
// (DRIVE_SYNC_FAKE_DEMO_OWNERS: one "demo-<local>" tree per owner, the same
// shape as the IT's: Física I with a Doc + image and a PDF, a folder with a
// PDF someone else owns, Varios with an image) and a real S3 endpoint, here a
// tiny in-memory S3 (test/drive/support/s3mock.ts) standing in for
// InMemoryObjectStorage (keys, put count). Each @Test keeps its name and runs
// every assertion that needs no fake mutation, no direct service call and no
// scheduled run; the full test (rename/move/edit/remove/revoke, blocked
// downloads, cross-source moves, runAll/unclaimed, exact fake signed URLs) is
// test/drive/DriveSyncIT.test.ts (in-process, contract/IN-PROCESS.md).
// One demo owner per test so an async sync of one test never touches another's rows.
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { bearer, copyPlanSubjectsToEntries, mintJwt, seedStaff, supports, useServer, type As } from '../support';
import { startS3Mock } from '../../test/drive/support/s3mock';

const OWNERS = Array.from({ length: 12 }, (_, i) => `alumno${i + 1}@itba.edu.ar`);
const s3 = startS3Mock();
const api = useServer({
  env: { DRIVE_SYNC_USE_FAKE: 'true', DRIVE_SYNC_FAKE_DEMO_OWNERS: OWNERS.join(','), ...s3.env },
});
// Files kept by reference (every file with a size: binaries; Docs have none).
const s3ref = startS3Mock();
const ref = useServer({
  env: {
    DRIVE_SYNC_USE_FAKE: 'true', DRIVE_SYNC_FAKE_DEMO_OWNERS: 'alumno1@itba.edu.ar', DRIVE_SYNC_REFERENCE_ABOVE_BYTES: '1',
    ...s3ref.env,
  },
});
// No object storage at all: every copy fails, the per-file sync errors are Java's texts.
const bare = useServer({ env: { DRIVE_SYNC_USE_FAKE: 'true', DRIVE_SYNC_FAKE_DEMO_OWNERS: 'alumno1@itba.edu.ar' } });
afterAll(() => {
  s3.stop();
  s3ref.stop();
});
const hasAccountDeletion = await supports('DELETE /v1/me');

const CONSENT = '2026-10';
const tokens = new Map<string, Promise<string>>();
function as(email: string, name?: string): Promise<As> {
  if (!tokens.has(email)) tokens.set(email, mintJwt({ email, name: name ?? (email.startsWith('alumno') ? 'Alumno Uno' : email) }));
  return tokens.get(email)!.then(bearer);
}
const reader = (n: number) => as(`lector${n}@itba.edu.ar`);
async function staff(): Promise<As> {
  return as('staff@itba.edu.ar');
}

type Srv = typeof api;

async function seed(s: Srv) {
  await s.db`TRUNCATE wiki.kb_page, wiki.drive_unclaimed_share, wiki.drive_file_report, wiki.drive_file,
             wiki.drive_source, public."user", public.plan_subject, public.plan_entry, public.subject, public.plan, public.careers CASCADE`;
  await s.db`INSERT INTO public.capability_settings (capability, enabled_for_all) VALUES ('apuntes', true)
             ON CONFLICT (capability) DO UPDATE SET enabled_for_all = true`;
  await s.db`INSERT INTO public.subject (id, name, credits, updated_at) VALUES
             ('93.41', 'Física I', 6, now()), ('93.42', 'Física II', 6, now()),
             ('93.26', 'Análisis Matemático I', 6, now()), ('72.31', 'Programación Imperativa', 6, now())`;
  await seedStaff(s.db, 'staff@itba.edu.ar');
}

async function waitFor(what: string, fn: () => Promise<boolean>, ms = 20_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await Bun.sleep(50);
  }
  throw new Error(`timed out waiting for ${what}`);
}

const local = (email: string) => email.slice(0, email.indexOf('@'));
const folderUrl = (id: string) => `https://drive.google.com/drive/folders/${id}?usp=sharing`;

async function lastSynced(s: Srv, id: string): Promise<string | null> {
  const [r] = await s.db`SELECT last_synced_at::text AS t FROM wiki.drive_source WHERE id = ${id}`;
  return (r?.t as string | null) ?? null;
}

/** Registers the owner's demo folder and waits for the sync the registration queued. */
async function register(s: Srv, owner: string): Promise<string> {
  const r = await s.post('/v1/me/drive/sources', {
    as: await as(owner), body: { folderUrl: folderUrl(`demo-${local(owner)}`), consentVersion: CONSENT, anonymous: false },
  });
  expect(r.status).toBe(201);
  expect(r.json.createdAt).not.toBeNull();
  const id = r.json.id as string;
  await waitFor('the registration sync', async () => (await lastSynced(s, id)) !== null);
  return id;
}

/** Runs another sync now: clears the 5-minute cooldown, POST .../sync, waits for a newer lastSyncedAt. */
async function syncNow(s: Srv, owner: string, id: string) {
  const before = await lastSynced(s, id);
  await s.db`UPDATE wiki.drive_source SET last_sync_requested_at = NULL WHERE id = ${id}`;
  const r = await s.post(`/v1/me/drive/sources/${id}/sync`, { as: await as(owner) });
  expect(r.status).toBe(202);
  await waitFor('the requested sync', async () => (await lastSynced(s, id)) !== before);
}

async function tree(s: Srv, owner: string, id: string) {
  const r = await s.get(`/v1/me/drive/sources/${id}/tree`, { as: await as(owner) });
  expect(r.status).toBe(200);
  return r.json;
}

function item(t: { items: { name: string }[] }, name: string): any {
  const i = t.items.find((x) => x.name === name);
  if (!i) throw new Error(`no item ${name} in ${JSON.stringify(t)}`);
  return i;
}

async function fileId(s: Srv, driveId: string): Promise<string> {
  const [r] = await s.db`SELECT id FROM wiki.drive_file WHERE drive_id = ${driveId}`;
  if (!r) throw new Error(`no row for ${driveId}`);
  return r.id as string;
}

async function row(s: Srv, driveId: string) {
  const [r] = await s.db`SELECT * FROM wiki.drive_file WHERE drive_id = ${driveId}`;
  return r!;
}

/** Registered, approved and with Física I assigned to its folder. */
async function publishedSource(s: Srv, owner: string): Promise<string> {
  const id = await register(s, owner);
  expect((await s.post(`/v1/staff/drive/sources/${id}/approve`, { as: await staff() })).status).toBe(200);
  const r = await s.patch(`/v1/me/drive/files/${await fileId(s, `demo-${local(owner)}-fis`)}`, { as: await as(owner), body: { subjectId: '93.41' } });
  expect(r.status).toBe(200);
  return id;
}

/** A presigned GET as the storage signs it: object key and the response overrides. */
function signed(location: string | null, s3base: string) {
  expect(location).not.toBeNull();
  const u = new URL(location!);
  expect(`${u.origin}`).toBe(s3base);
  return {
    key: decodeURIComponent(u.pathname).replace(/^\/ceitba-media\//, ''),
    disposition: u.searchParams.get('response-content-disposition'),
    type: u.searchParams.get('response-content-type'),
    expires: u.searchParams.get('X-Amz-Expires'),
  };
}

/** Normalizes the values that differ per run (ids, now-timestamps, sizes of the fakes' generated PDFs). */
const stable = (s: string) => s
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>')
  .replace(/"(lastSyncedAt|createdAt|publishedAt|lastUpdatedAt|firstSeenAt|lastSeenAt)":"[^"]+"/g, '"$1":"<ts>"')
  .replace(/"sizeBytes":\d+/g, '"sizeBytes":<n>');

describe('DriveSyncIT', () => {
  beforeEach(async () => {
    await seed(api);
    s3.clear();
  });

  test('registerSyncSuggestApprovePublishAndRead', async () => {
    const me = OWNERS[0]!;
    const L = local(me);
    const info = await api.get('/v1/me/drive/info', { as: await as(me) });
    expect(info.status).toBe(200);
    expect(info.json.botEmail).toBe('apuntes-bot@ceitba-dev.iam.gserviceaccount.com');
    expect(info.json.consentVersion).toBe(CONSENT);
    expect(info.text).toBe(JSON.stringify({
      botEmail: 'apuntes-bot@ceitba-dev.iam.gserviceaccount.com', consentVersion: '2026-10',
      consentText: 'Al conectar esta carpeta autorizás al CEITBA a leer su contenido con una cuenta de servicio de '
        + 'solo lectura, guardar una copia y publicar, en la sección Apuntes, los archivos a los que les asignes una '
        + 'materia. Se publican solo los archivos de tu propiedad; los de otras personas quedan a revisión del staff. '
        + 'Podés ocultar archivos, publicar como anónimo, desconectar la carpeta o dejar de compartirla en cualquier '
        + 'momento: al hacerlo se despublica todo y se borran las copias. No subas datos personales de terceros ni '
        + 'material cuya distribución no esté permitida.',
    }));

    const sourceId = await register(api, me);
    let t = await tree(api, me, sourceId);
    expect(t.source.status).toBe('PENDING_REVIEW');
    expect(t.source.rootName).toBe(`Apuntes de ${L}`);
    // 3 folders + 5 files.
    expect(t.items).toHaveLength(8);
    expect(t.source.fileCount).toBe(5);
    const fis = item(t, 'Física I');
    expect(fis.kind).toBe('FOLDER');
    expect(fis.suggestedSubjectId).toBe('93.41');
    expect(fis.suggestedSubjectName).toBe('Física I');
    expect(item(t, 'Analisis Matematico I').suggestedSubjectId).toBe('93.26');
    expect(item(t, 'TP1 - Vectores.pdf').parentId).toBe(fis.id);
    expect(item(t, 'Varios').parentId).toBeNull();
    expect(item(t, 'TP1 - Vectores.pdf').publication).toBe('PRIVATE');
    expect(item(t, 'Guía de la cátedra.pdf').ownedByMe).toBe(false);
    // Someone else's file starts hidden; the student's own do not.
    expect(item(t, 'Guía de la cátedra.pdf').hidden).toBe(true);
    expect(item(t, 'TP1 - Vectores.pdf').hidden).toBe(false);
    // Folders first, then names case-insensitively; record order of every field.
    expect(t.items.map((i: { name: string }) => i.name)).toEqual(['Analisis Matematico I', 'Física I', 'Varios',
      'Guía de la cátedra.pdf', 'Parcial resuelto.pdf', 'pizarron.png', 'Resumen cinemática', 'TP1 - Vectores.pdf']);
    expect(stable(JSON.stringify(item(t, 'Física I')))).toBe(stable(JSON.stringify({
      id: fis.id, parentId: null, name: 'Física I', kind: 'FOLDER', subjectId: null, subjectName: null,
      effectiveSubjectId: null, effectiveSubjectName: null, suggestedSubjectId: '93.41', suggestedSubjectName: 'Física I',
      suggestedInMyPlan: false, effectiveInMyPlan: false, hidden: false, publication: 'PRIVATE', ownedByMe: true,
      sizeBytes: null, driveModifiedAt: '2026-01-01T00:02:00Z', syncError: null, exportBlocked: false,
      driveUrl: `https://drive.google.com/drive/folders/demo-${L}-fis`, academicYear: 2025, academicYearSource: 'DRIVE',
      ownAcademicYear: null,
    })));

    const accepted = await api.post(`/v1/me/drive/sources/${sourceId}/accept-suggestions`, { as: await as(me) });
    expect(accepted.status).toBe(200);
    expect(accepted.text).toBe('{"applied":2}');
    t = await tree(api, me, sourceId);
    const doc = item(t, 'Resumen cinemática');
    expect(doc.effectiveSubjectId).toBe('93.41');
    expect(doc.subjectId).toBeNull();
    // Held while the source waits for staff.
    expect(doc.publication).toBe('NEEDS_REVIEW');
    expect(t.source.needsReviewCount).toBe(3);
    expect(item(t, 'Guía de la cátedra.pdf').publication).toBe('PRIVATE');

    // Not visible to readers yet, but the owner can preview it.
    const docId = doc.id as string;
    expect((await api.get(`/v1/wiki/files/${docId}`, { as: await reader(1) })).status).toBe(404);
    const preview = await api.get(`/v1/wiki/files/${docId}`, { as: await as(me) });
    expect(preview.status).toBe(200);
    expect(preview.json.html).toContain(`<img src="/api/v1/wiki/files/${docId}/assets/image1.png"`);
    expect(preview.json.html).not.toContain('script');
    expect(preview.json.html).not.toContain('class=');
    expect(preview.json.hasHtml).toBe(true);
    expect(preview.json.hasPdf).toBe(true);
    expect(preview.json.path).toBe('Física I');
    // Byte-level: jsoup's pretty-printed and cleaned HTML, the text for search and the content fingerprint.
    expect(preview.json.html).toBe(`<h1>Cinemática</h1>\n<p>MRU: x = x0 + v t.</p>\n<p><img src="/api/v1/wiki/files/${docId}/assets/image1.png"></p>`);
    // Stored copies live under drive/ only.
    expect(s3.keys().length).toBeGreaterThan(0);
    expect(s3.keys().every((k) => k.startsWith('drive/'))).toBe(true);
    const docRow = await row(api, `demo-${L}-fis-res`);
    expect(docRow.text_content).toBe('Cinemática MRU: x = x0 + v t.');
    expect(docRow.content_fingerprint).toBe(EXPECTED_DEMO_DOC_FINGERPRINT);
    expect(s3.keys()).toContain(`drive/demo-${L}-fis-res/${EXPECTED_DEMO_DOC_PREFIX}/assets/image1.png`);
    expect(s3.keys()).toContain(`drive/demo-${L}-fis-res/${EXPECTED_DEMO_DOC_PREFIX}/export.pdf`);
    expect((await row(api, `demo-${L}-fis-tp`)).text_content).toBe('TP1 Vectores: suma, producto escalar y vectorial.');

    // Staff see the owner even before approval; approval publishes own files.
    const pending = await api.get('/v1/staff/drive/sources?status=PENDING_REVIEW', { as: await staff() });
    expect(pending.status).toBe(200);
    expect(pending.json.total).toBe(1);
    expect(pending.json.items[0].ownerEmail).toBe(me);
    expect(Object.keys(pending.json)).toEqual(['items', 'total']);
    expect(Object.keys(pending.json.items[0])).toEqual(['id', 'rootName', 'status', 'anonymous', 'lastSyncedAt', 'lastError',
      'fileCount', 'publishedCount', 'needsReviewCount', 'createdAt', 'ownerName', 'ownerEmail', 'community', 'subjectId']);
    const approved = await api.post(`/v1/staff/drive/sources/${sourceId}/approve`, { as: await staff(), body: { comment: 'ok' } });
    expect(approved.status).toBe(200);
    expect(approved.json.status).toBe('ACTIVE');
    expect(approved.json.publishedCount).toBe(3);
    expect(approved.json.needsReviewCount).toBe(0);

    const subjectFiles = await api.get('/v1/wiki/subjects/93.41/files', { as: await reader(1) });
    expect(subjectFiles.status).toBe(200);
    expect(subjectFiles.json.subjectName).toBe('Física I');
    expect(subjectFiles.json.groups).toHaveLength(1);
    const group = subjectFiles.json.groups[0];
    expect(group.author.name).toBe('Alumno Uno');
    expect(group.author.anonymous).toBe(false);
    expect(group.files).toHaveLength(2);
    expect(group.files[0].path).toBe('Física I');
    expect(stable(subjectFiles.text)).toBe(stable(JSON.stringify({
      subjectId: '93.41', subjectName: 'Física I', groups: [{
        sourceId, author: { name: 'Alumno Uno', anonymous: false, community: false }, files: [
          { id: docId, name: 'Resumen cinemática', kind: 'DOC', path: 'Física I', sizeBytes: null, driveModifiedAt: '2026-01-01T00:03:00Z',
            publishedAt: 'x', hasHtml: true, hasPdf: true, hasOriginal: false, pdfMimeType: 'application/pdf', originalMimeType: null,
            exportBlocked: false, driveUrl: `https://docs.google.com/document/d/demo-${L}-fis-res/edit`, academicYear: 2025,
            academicYearSource: 'DRIVE', community: false },
          { id: await fileId(api, `demo-${L}-fis-tp`), name: 'TP1 - Vectores.pdf', kind: 'PDF', path: 'Física I', sizeBytes: 1,
            driveModifiedAt: '2026-01-01T00:04:00Z', publishedAt: 'x', hasHtml: false, hasPdf: true, hasOriginal: true,
            pdfMimeType: 'application/pdf', originalMimeType: 'application/pdf', exportBlocked: false,
            driveUrl: `https://drive.google.com/file/d/demo-${L}-fis-tp/view`, academicYear: 2025, academicYearSource: 'DRIVE', community: false },
        ],
      }],
    })));

    // Downloads and Doc images redirect to short-lived signed URLs, shown inline by default.
    const pdfId = await fileId(api, `demo-${L}-fis-tp`);
    const dl = await api.get(`/v1/wiki/files/${pdfId}/download`, { as: await reader(1) });
    expect(dl.status).toBe(302);
    expect(dl.headers.get('cache-control')).toBe('no-store');
    const d = signed(dl.location, s3.endpoint);
    expect(d.key.startsWith(`drive/demo-${L}-fis-tp/`)).toBe(true);
    expect(d.key.endsWith('/original.pdf')).toBe(true);
    expect(d.expires).toBe('300');
    expect(d.disposition).toBe(`inline; filename="TP1 - Vectores.pdf"; filename*=UTF-8''TP1%20-%20Vectores.pdf`);
    expect(d.type).toBe('application/pdf');
    const att = signed((await api.get(`/v1/wiki/files/${pdfId}/download?disposition=attachment`, { as: await reader(1) })).location, s3.endpoint);
    expect(att.disposition).toBe(`attachment; filename="TP1 - Vectores.pdf"; filename*=UTF-8''TP1%20-%20Vectores.pdf`);
    expect(att.type).toBe('application/pdf');
    const bad = await api.get(`/v1/wiki/files/${pdfId}/download?disposition=x`, { as: await reader(1) });
    expect(bad.status).toBe(400);
    expect(bad.json.message).toBe("Validation failed for field 'disposition' with value 'x': must be inline or attachment");
    const badVariant = await api.get(`/v1/wiki/files/${pdfId}/download?variant=zip`, { as: await reader(1) });
    expect(badVariant.status).toBe(400);
    expect(badVariant.json.message).toBe("Validation failed for field 'variant' with value 'zip': must be pdf or original");
    const pdfDetail = await api.get(`/v1/wiki/files/${pdfId}`, { as: await reader(1) });
    expect(pdfDetail.json.pdfMimeType).toBe('application/pdf');
    expect(pdfDetail.json.originalMimeType).toBe('application/pdf');
    expect(pdfDetail.json.exportBlocked).toBe(false);
    expect(pdfDetail.json.driveUrl).toBe(`https://drive.google.com/file/d/demo-${L}-fis-tp/view`);
    expect(Object.keys(pdfDetail.json)).toEqual(['id', 'name', 'kind', 'path', 'sizeBytes', 'driveModifiedAt', 'publishedAt', 'hasHtml',
      'hasPdf', 'hasOriginal', 'pdfMimeType', 'originalMimeType', 'exportBlocked', 'driveUrl', 'academicYear', 'academicYearSource',
      'subjectId', 'subjectName', 'author', 'html', 'reportedByMe', 'community']);
    const docDetail = await api.get(`/v1/wiki/files/${docId}`, { as: await reader(1) });
    expect(docDetail.json.originalMimeType).toBeNull();
    expect(docDetail.json.driveUrl).toBe(`https://docs.google.com/document/d/demo-${L}-fis-res/edit`);
    const docPdf = signed((await api.get(`/v1/wiki/files/${docId}/download`, { as: await reader(1) })).location, s3.endpoint);
    expect(docPdf.key).toBe(`drive/demo-${L}-fis-res/${EXPECTED_DEMO_DOC_PREFIX}/export.pdf`);
    expect(docPdf.disposition).toBe(`inline; filename="Resumen cinem_tica.pdf"; filename*=UTF-8''Resumen%20cinem%C3%A1tica.pdf`);
    const asset = await api.get(`/v1/wiki/files/${docId}/assets/image1.png`, { as: await reader(1) });
    expect(asset.status).toBe(302);
    expect(asset.headers.get('cache-control')).toBe('no-store');
    const a = signed(asset.location, s3.endpoint);
    expect(a.key).toBe(`drive/demo-${L}-fis-res/${EXPECTED_DEMO_DOC_PREFIX}/assets/image1.png`);
    expect(a.disposition).toBe(`inline; filename="image1.png"; filename*=UTF-8''image1.png`);
    expect(a.type).toBe('image/png');
    expect((await api.get(`/v1/wiki/files/${docId}/assets/other.png`, { as: await reader(1) })).status).toBe(404);
    const noOriginal = await api.get(`/v1/wiki/files/${docId}/download?variant=original`, { as: await reader(1) });
    expect(noOriginal.status).toBe(404);
    expect(noOriginal.json.message).toBe(`DriveFile download with identifier '${docId}/original' not found`);

    // Anonymous sources hide the author from readers.
    const anon = await api.patch(`/v1/me/drive/sources/${sourceId}`, { as: await as(me), body: { anonymous: true } });
    expect(anon.status).toBe(200);
    expect(anon.json.anonymous).toBe(true);
    const anonFiles = await api.get('/v1/wiki/subjects/93.41/files', { as: await reader(1) });
    expect(anonFiles.json.groups[0].author.name).toBeNull();
    expect(anonFiles.json.groups[0].author.anonymous).toBe(true);
    expect((await api.get('/v1/staff/drive/sources', { as: await staff() })).json.items[0].ownerName).toBe('Alumno Uno');

    // Unhidden by the student, the foreign file waits in the staff queue;
    // syncs keep the student's choice; publishing it sticks.
    expect((await api.get('/v1/staff/drive/files?publication=NEEDS_REVIEW', { as: await staff() })).json.total).toBe(0);
    const foreignId = await fileId(api, `demo-${L}-am-ajeno`);
    // The Análisis folder got its suggestion accepted: the foreign PDF counts for 93.26 once unhidden.
    const unhidden = await api.patch(`/v1/me/drive/files/${foreignId}`, { as: await as(me), body: { hidden: false } });
    expect(unhidden.json.hidden).toBe(false);
    expect(unhidden.json.publication).toBe('NEEDS_REVIEW');
    await syncNow(api, me, sourceId);
    expect(item(await tree(api, me, sourceId), 'Guía de la cátedra.pdf').hidden).toBe(false);
    const queue = await api.get('/v1/staff/drive/files?publication=NEEDS_REVIEW', { as: await staff() });
    expect(queue.json.total).toBe(1);
    expect(queue.json.items[0].ownerEmail).toBe('catedra@itba.edu.ar');
    expect(queue.json.items[0].sharerEmail).toBe(me);
    expect(stable(JSON.stringify(queue.json.items[0]))).toBe(stable(JSON.stringify({
      id: foreignId, name: 'Guía de la cátedra.pdf', kind: 'PDF', sourceId, sourceRootName: `Apuntes de ${L}`,
      ownerEmail: 'catedra@itba.edu.ar', sharerName: 'Alumno Uno', sharerEmail: me, effectiveSubjectId: '93.26',
      effectiveSubjectName: 'Análisis Matemático I', publication: 'NEEDS_REVIEW', reportCount: 0, reports: [],
      driveModifiedAt: '2026-01-01T00:07:00Z', academicYear: 2025, academicYearSource: 'DRIVE',
    })));
    const published = await api.post(`/v1/staff/drive/files/${foreignId}/publish`, { as: await staff() });
    expect(published.json.publication).toBe('PUBLISHED');
    await syncNow(api, me, sourceId);
    expect(item(await tree(api, me, sourceId), 'Guía de la cátedra.pdf').publication).toBe('PUBLISHED');

    // Subject listings; hasWiki once the subject has a published wiki page.
    let subjects = await api.get('/v1/wiki/apuntes/subjects', { as: await reader(1) });
    expect(subjects.status).toBe(200);
    expect(subjects.json[0].subjectId).toBe('93.26');
    expect(subjects.json[0].fileCount).toBe(2);
    expect(subjects.json[1].subjectId).toBe('93.41');
    expect(subjects.json[1].fileCount).toBe(2);
    expect(subjects.json[0].hasWiki).toBe(false);
    expect(stable(subjects.text)).toBe(stable(JSON.stringify([
      { subjectId: '93.26', subjectName: 'Análisis Matemático I', fileCount: 2, lastUpdatedAt: 'x', year: null, semester: null, section: null, hasWiki: false },
      { subjectId: '93.41', subjectName: 'Física I', fileCount: 2, lastUpdatedAt: 'x', year: null, semester: null, section: null, hasWiki: false },
    ])));
    expect(subjects.json[0].lastUpdatedAt).toBe('2026-01-01T00:07:00Z');
    await api.db`INSERT INTO wiki.kb_page (subject_id, slug, type, title, summary, markdown, generator, generated_at)
                 VALUES ('93.42', 'index', 'INDEX', 'Física II', 's', 'm', 'manual', now())`;
    subjects = await api.get('/v1/wiki/apuntes/subjects', { as: await reader(1) });
    expect(subjects.json[0].hasWiki).toBe(false);
    const search = await api.get('/v1/wiki/apuntes/subjects?q=fisica', { as: await reader(1) });
    expect(search.status).toBe(200);
    expect(search.json).toHaveLength(2);
    expect(search.json[0].subjectId).toBe('93.41');
    expect(search.json[0].hasWiki).toBe(false);
    expect(search.json[1].fileCount).toBe(0);
    expect(search.json[1].hasWiki).toBe(true);
    expect(search.json[1].lastUpdatedAt).toBeNull();
    expect((await api.get('/v1/wiki/apuntes/subjects?q=93.2&limit=1', { as: await reader(1) })).json.map((x: { subjectId: string }) => x.subjectId)).toEqual(['93.26']);
    expect((await api.get('/v1/wiki/apuntes/subjects?limit=x', { as: await reader(1) })).status).toBe(400);

    // Hiding a folder hides what is in it.
    const fisId = await fileId(api, `demo-${L}-fis`);
    const hidden = await api.patch(`/v1/me/drive/files/${fisId}`, { as: await as(me), body: { hidden: true } });
    expect(hidden.json.hidden).toBe(true);
    expect(item(await tree(api, me, sourceId), 'TP1 - Vectores.pdf').publication).toBe('PRIVATE');
    const cleared = await api.patch(`/v1/me/drive/files/${fisId}`, { as: await as(me), body: { hidden: false, subjectId: '' } });
    expect(cleared.json.subjectId).toBeNull();
    expect(item(await tree(api, me, sourceId), 'TP1 - Vectores.pdf').publication).toBe('PRIVATE');
    const unknown = await api.patch(`/v1/me/drive/files/${fisId}`, { as: await as(me), body: { subjectId: '99.99' } });
    expect(unknown.status).toBe(400);
    expect(unknown.json.message).toBe("Validation failed for field 'subjectId' with value '99.99': unknown subject");
  });

  // ---- media types and blocked downloads ----------------------------------

  test('textOriginalsInlineAsPlainTextAndBlockedDownloadsAreMetadataOnly', async () => {
    // Black-box: the demo has no text or blocked files; images are kept as originals and shown inline.
    const me = OWNERS[1]!;
    const L = local(me);
    const sourceId = await publishedSource(api, me);
    const imgId = await fileId(api, `demo-${L}-varios-img`);
    const patched = await api.patch(`/v1/me/drive/files/${await fileId(api, `demo-${L}-varios`)}`, { as: await as(me), body: { subjectId: '93.42' } });
    expect(patched.status).toBe(200);
    const detail = await api.get(`/v1/wiki/files/${imgId}`, { as: await reader(1) });
    expect(detail.json.kind).toBe('IMAGE');
    expect(detail.json.hasOriginal).toBe(true);
    expect(detail.json.hasPdf).toBe(false);
    expect(detail.json.originalMimeType).toBe('image/png');
    expect(detail.json.pdfMimeType).toBeNull();
    const dl = signed((await api.get(`/v1/wiki/files/${imgId}/download?variant=original`, { as: await reader(1) })).location, s3.endpoint);
    expect(dl.disposition).toBe(`inline; filename="pizarron.png"; filename*=UTF-8''pizarron.png`);
    expect(dl.type).toBe('image/png');
    expect(dl.key.endsWith('/original.png')).toBe(true);
    expect((await api.get(`/v1/wiki/files/${imgId}/download?variant=pdf`, { as: await reader(1) })).status).toBe(404);
    expect(item(await tree(api, me, sourceId), 'pizarron.png').exportBlocked).toBe(false);
    expect((await row(api, `demo-${L}-varios-img`)).text_content).toBeNull();
  });

  test('reprocessReExportsDocsAndKeepsUnchangedCopies', async () => {
    const me = OWNERS[2]!;
    const L = local(me);
    const sourceId = await publishedSource(api, me);
    await syncNow(api, me, sourceId);
    const before = await row(api, `demo-${L}-fis-res`);
    const puts = s3.putCount();

    const r = await api.post('/v1/staff/drive/reprocess?kind=DOC', { as: await staff() });
    expect(r.status).toBe(200);
    expect(r.text).toBe('{"files":1,"sources":1}');
    const bad = await api.post('/v1/staff/drive/reprocess?kind=PDF', { as: await staff() });
    expect(bad.status).toBe(400);
    expect(bad.json.message).toBe("Validation failed for field 'kind' with value 'PDF': must be one of [DOC, SLIDES, SHEET, DRAWING]");
    expect((await api.post('/v1/staff/drive/reprocess?kind=nope', { as: await staff() })).json.message)
      .toBe("Validation failed for field 'kind' with value 'nope': unknown value");
    expect((await api.post('/v1/staff/drive/reprocess', { as: await as(me) })).status).toBe(403);
    await waitFor('the re-export', async () => (await row(api, `demo-${L}-fis-res`)).content_modified_at !== null);
    await waitFor('the reprocess sync', async () => {
      const [s] = await api.db`SELECT last_synced_at > ${before.updated_at} AS later FROM wiki.drive_source WHERE id = ${sourceId}`;
      return s!.later as boolean;
    });
    const after = await row(api, `demo-${L}-fis-res`);
    expect(after.content_fingerprint).toBe(before.content_fingerprint);
    expect(s3.putCount()).toBe(puts);
    // Default kind is DOC.
    expect((await api.post('/v1/staff/drive/reprocess', { as: await staff() })).text).toBe('{"files":1,"sources":1}');
    await waitFor('the second re-export', async () => (await row(api, `demo-${L}-fis-res`)).content_modified_at !== null);
  });

  test('academicYears', async () => {
    const me = OWNERS[3]!;
    const L = local(me);
    const sourceId = await publishedSource(api, me);
    let t = await tree(api, me, sourceId);
    // Fake Drive dates start at 2026-01-01T00:00Z: still 2025 in Buenos Aires.
    expect(item(t, 'Resumen cinemática').academicYear).toBe(2025);
    expect(item(t, 'Resumen cinemática').academicYearSource).toBe('DRIVE');
    expect(item(t, 'Resumen cinemática').ownAcademicYear).toBeNull();

    // A folder's own year flows to its contents; an item's own year wins.
    const fisId = await fileId(api, `demo-${L}-fis`);
    const docId = await fileId(api, `demo-${L}-fis-res`);
    const set = await api.patch(`/v1/me/drive/files/${fisId}`, { as: await as(me), body: { academicYear: 2020 } });
    expect(set.json.academicYear).toBe(2020);
    expect(set.json.academicYearSource).toBe('USER');
    expect(set.json.ownAcademicYear).toBe(2020);
    expect((await api.patch(`/v1/me/drive/files/${docId}`, { as: await as(me), body: { academicYear: 2022 } })).status).toBe(200);
    await syncNow(api, me, sourceId);
    t = await tree(api, me, sourceId);
    expect(item(t, 'TP1 - Vectores.pdf').academicYear).toBe(2020);
    expect(item(t, 'TP1 - Vectores.pdf').academicYearSource).toBe('INHERITED');
    expect(item(t, 'TP1 - Vectores.pdf').ownAcademicYear).toBeNull();
    expect(item(t, 'Resumen cinemática').academicYear).toBe(2022);
    expect(item(t, 'Resumen cinemática').academicYearSource).toBe('USER');

    // Absent = unchanged; null = automatic again; out of range = 400.
    expect((await api.patch(`/v1/me/drive/files/${docId}`, { as: await as(me), body: { hidden: false } })).json.academicYear).toBe(2022);
    const auto = await api.patch(`/v1/me/drive/files/${fisId}`, { as: await as(me), body: { academicYear: null } });
    expect(auto.json.ownAcademicYear).toBeNull();
    expect(item(await tree(api, me, sourceId), 'TP1 - Vectores.pdf').academicYearSource).toBe('DRIVE');
    const late = await api.patch(`/v1/me/drive/files/${docId}`, { as: await as(me), body: { academicYear: 2099 } });
    expect(late.status).toBe(400);
    expect(late.json.message).toMatch(/^Validation failed for field 'academicYear' with value '2099': must be between 1990 and \d{4}$/);
    const text = await api.patch(`/v1/me/drive/files/${docId}`, { as: await as(me), body: { academicYear: '2020' } });
    expect(text.status).toBe(400);
    expect(text.json.message).toBe(`Validation failed for field 'academicYear' with value '"2020"': must be a year or null`);
    const fraction = await api.patch(`/v1/me/drive/files/${docId}`, { as: await as(me), body: { academicYear: 2021.7 } });
    expect(fraction.status).toBe(200);
    expect(fraction.json.academicYear).toBe(2021);
    const tooOld = await api.patch(`/v1/me/drive/files/${docId}`, { as: await as(me), body: { academicYear: 1989 } });
    expect(tooOld.status).toBe(400);

    const pdfId = await fileId(api, `demo-${L}-fis-tp`);
    const detail = await api.get(`/v1/wiki/files/${pdfId}`, { as: await reader(1) });
    expect(detail.json.academicYear).toBe(2025);
    expect(detail.json.academicYearSource).toBe('DRIVE');
    expect((await api.get('/v1/wiki/subjects/93.41/files', { as: await reader(1) })).json.groups[0].files[0].academicYear).toBeDefined();
  });

  // ---- plan-aware suggestions -------------------------------------------

  test('planAwareSuggestionsAndMySubjects', async () => {
    const me = OWNERS[4]!;
    const L = local(me);
    await api.db`INSERT INTO public.careers (id, name, updated_at) VALUES ('LAES', 'Analítica', now())`;
    await api.db`INSERT INTO public.plan (id, career_id, name, updated_at) VALUES ('A22', 'LAES', 'Plan 2022', now())`;
    await api.db`INSERT INTO public.subject (id, name, credits, updated_at) VALUES
                 ('82.15', 'Matemática Aplicada', 6, now()), ('93.16', 'Matemática Discreta', 6, now()),
                 ('71.98', 'Sociología', 3, now()), ('71.97', 'Visualización de Datos', 3, now()), ('71.96', 'Análisis de Redes', 3, now())`;
    await api.db`INSERT INTO public.plan_subject (subject_id, plan_id, section, year, semester, credits_required, dependencies) VALUES
                 ('71.98', 'A22', 'Electivas Social', 0, 0, 0, '{}'), ('71.97', 'A22', 'Electivas Analytics', 0, 0, 0, '{}'),
                 ('71.96', 'A22', 'Electivas Analytics', 0, 0, 0, '{}'), ('93.26', 'A22', 'Ciclo', 1, 2, 0, '{}'),
                 ('93.16', 'A22', 'Ciclo', 2, 1, 0, '{}'), ('93.41', 'A22', 'Ciclo', 2, 2, 0, '{}')`;
    await copyPlanSubjectsToEntries(api.db);

    const sourceId = await register(api, me);
    // Without a plan: no plan flags, plan listing empty.
    let t = await tree(api, me, sourceId);
    expect(item(t, 'Física I').suggestedInMyPlan).toBe(false);
    expect((await api.get('/v1/wiki/apuntes/subjects?mine=true', { as: await as(me) })).json).toEqual([]);

    await api.db`UPDATE public."user" SET plan = 'A22' WHERE email = ${me}`;
    const recomputed = await api.post(`/v1/me/drive/sources/${sourceId}/recompute-suggestions`, { as: await as(me) });
    expect(recomputed.status).toBe(200);
    t = recomputed.json;
    expect(item(t, 'Física I').suggestedSubjectId).toBe('93.41');
    expect(item(t, 'Física I').suggestedInMyPlan).toBe(true);
    expect(item(t, 'Analisis Matematico I').suggestedSubjectId).toBe('93.26');
    expect(item(t, 'Analisis Matematico I').suggestedInMyPlan).toBe(true);
    // Children inherit the folder's suggestion unless their own differs.
    expect(item(t, 'TP1 - Vectores.pdf').suggestedSubjectId).toBeNull();
    expect(Object.keys(t)).toEqual(['source', 'items']);

    expect((await api.post(`/v1/me/drive/sources/${sourceId}/accept-suggestions`, { as: await as(me) })).json.applied).toBe(2);
    t = await tree(api, me, sourceId);
    expect(item(t, 'Parcial resuelto.pdf').effectiveSubjectId).toBe('93.26');
    expect(item(t, 'Parcial resuelto.pdf').effectiveInMyPlan).toBe(true);

    expect((await api.post(`/v1/staff/drive/sources/${sourceId}/approve`, { as: await staff() })).status).toBe(200);
    let mine = await api.get('/v1/wiki/apuntes/subjects?mine=true', { as: await as(me) });
    expect(mine.status).toBe(200);
    // Curricular by year/semester, then electives by section and name.
    expect(mine.json.map((m: { subjectId: string }) => m.subjectId)).toEqual(['93.26', '93.16', '93.41', '71.96', '71.97', '71.98']);
    expect(mine.json[0].year).toBe(1);
    expect(mine.json[0].semester).toBe(2);
    expect(mine.json[0].section).toBe('Ciclo');
    expect(mine.json[3].year).toBeNull();
    expect(mine.json[3].semester).toBeNull();
    expect(mine.json[3].section).toBe('Electivas Analytics');
    expect(mine.json[5].section).toBe('Electivas Social');
    expect(mine.json[0].fileCount).toBe(1);
    expect(mine.json[2].fileCount).toBe(2);
    expect(mine.json[1].fileCount).toBe(0);
    expect(mine.json[1].lastUpdatedAt).toBeNull();
    expect(mine.json[0].hasWiki).toBe(false);
    await api.db`INSERT INTO wiki.kb_page (subject_id, slug, type, title, summary, markdown, generator, generated_at, status)
                 VALUES ('93.16', 'index', 'INDEX', 'Discreta', 's', 'm', 'manual', now(), 'PUBLISHED'),
                        ('93.26', 'index', 'INDEX', 'Aplicada', 's', 'm', 'manual', now(), 'HIDDEN')`;
    mine = await api.get('/v1/wiki/apuntes/subjects?mine=true', { as: await as(me) });
    expect(mine.json[0].hasWiki).toBe(false); // only a HIDDEN page
    expect(mine.json[1].hasWiki).toBe(true);
    expect(stable(JSON.stringify(mine.json[3]))).toBe(stable(JSON.stringify(
      { subjectId: '71.96', subjectName: 'Análisis de Redes', fileCount: 0, lastUpdatedAt: null, year: null, semester: null, section: 'Electivas Analytics', hasWiki: false })));
    expect((await api.get('/v1/wiki/apuntes/subjects', { as: await reader(1) })).json[0].year).toBeNull();
    void L;
  });

  // ---- change detection ------------------------------------------------

  test('renameMoveEditRemoveAndRevoke', async () => {
    // Black-box: a sync with nothing changed in Drive refetches nothing and keeps every stored copy.
    const me = OWNERS[5]!;
    const L = local(me);
    const sourceId = await publishedSource(api, me);
    const doc = await row(api, `demo-${L}-fis-res`);
    const pdf = await row(api, `demo-${L}-fis-tp`);
    const keys = s3.keys();
    const puts = s3.putCount();
    await syncNow(api, me, sourceId);
    const doc2 = await row(api, `demo-${L}-fis-res`);
    expect(doc2.content_fingerprint).toBe(doc.content_fingerprint);
    expect(doc2.content_modified_at).toEqual(doc.content_modified_at);
    expect((await row(api, `demo-${L}-fis-tp`)).content_fingerprint).toBe(pdf.content_fingerprint);
    expect(s3.keys()).toEqual(keys);
    expect(s3.putCount()).toBe(puts);
    const t = await tree(api, me, sourceId);
    expect(t.source.status).toBe('ACTIVE');
    expect(t.source.lastError).toBeNull();
    expect(item(t, 'TP1 - Vectores.pdf').publication).toBe('PUBLISHED');
  });

  test('crossSourceMoveKeepsTheRowWhicheverSourceSyncsFirst', async () => {
    // Black-box: a student with an ACTIVE folder is trusted (new sources start ACTIVE); the move itself
    // needs fake mutations (in-process). Another student's demo folder cannot be connected by them.
    const me = OWNERS[6]!;
    const other = OWNERS[7]!;
    await publishedSource(api, me);
    const second = await api.post('/v1/me/drive/sources', {
      as: await as(other), body: { folderUrl: folderUrl(`demo-${local(me)}`), consentVersion: CONSENT, anonymous: true },
    });
    expect(second.status).toBe(403);
    expect(second.json.error).toBe('DRIVE_FOLDER_NOT_OWNED');
    const otherId = await register(api, other);
    const [s] = await api.db`SELECT status FROM wiki.drive_source WHERE id = ${otherId}`;
    expect(s!.status).toBe('PENDING_REVIEW');
  });

  // ---- registration errors ---------------------------------------------

  test('registrationErrors', async () => {
    const me = OWNERS[8]!;
    const L = local(me);
    const post = async (url: string, consent = CONSENT) => api.post('/v1/me/drive/sources',
      { as: await as(me), body: { folderUrl: url, consentVersion: consent, anonymous: false } });
    let r = await post('https://example.com/x');
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('DRIVE_INVALID_FOLDER_URL');
    expect(r.json.message).toBe('Not a Google Drive folder link');
    expect(Object.keys(r.json)).toEqual(['error', 'message', 'path', 'timestamp']);
    expect(r.json.path).toBe('/api/v1/me/drive/sources');
    r = await post('not-shared-folder-01');
    expect(r.status).toBe(422);
    expect(r.json.error).toBe('DRIVE_FOLDER_NOT_SHARED');
    expect(r.json.message).toBe('The folder is not shared with apuntes-bot@ceitba-dev.iam.gserviceaccount.com');
    r = await post(`demo-${local(OWNERS[9]!)}`);
    expect(r.status).toBe(403);
    expect(r.json.error).toBe('DRIVE_FOLDER_NOT_OWNED');
    expect(r.json.message).toBe('Only the owner of the folder can connect it');
    r = await post(`demo-${L}-fis-tp`);
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('DRIVE_INVALID_FOLDER_URL');
    expect(r.json.message).toBe('The link is not a folder');
    r = await post(`demo-${L}`, '2020-01');
    expect(r.status).toBe(400);
    expect(r.json.message).toBe("Validation failed for field 'consentVersion' with value '2020-01': must be the current consent version 2026-10");
    r = await api.post('/v1/me/drive/sources', { as: await as(me), body: { folderUrl: '', consentVersion: CONSENT } });
    expect(r.status).toBe(400);
    expect(r.json.message).toBe('folderUrl: must not be blank');
    r = await api.post('/v1/me/drive/sources', { as: await as(me), body: { folderUrl: `demo-${L}`, consentVersion: 'x'.repeat(33) } });
    expect(r.status).toBe(400);
    expect(r.json.message).toBe('consentVersion: size must be between 0 and 32');

    const created = await api.post('/v1/me/drive/sources', {
      as: await as(me), body: { folderUrl: folderUrl(`demo-${L}`), consentVersion: CONSENT, anonymous: true },
    });
    expect(created.status).toBe(201);
    const sourceId = created.json.id as string;
    expect(Object.keys(created.json)).toEqual(['id', 'rootName', 'status', 'anonymous', 'lastSyncedAt', 'lastError', 'fileCount',
      'publishedCount', 'needsReviewCount', 'createdAt', 'community']);
    expect(created.json.rootName).toBe(`Apuntes de ${L}`);
    expect(created.json.anonymous).toBe(true);
    expect(created.json.status).toBe('PENDING_REVIEW');
    expect(created.json.lastSyncedAt).toBeNull();
    // Built from the entity just created: @CreationTimestamp in the JVM zone.
    expect(created.json.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?-03:00$/);
    await waitFor('the registration sync', async () => (await lastSynced(api, sourceId)) !== null);

    r = await post(folderUrl(`demo-${L}`));
    expect(r.status).toBe(409);
    expect(r.json.error).toBe('DRIVE_SOURCE_EXISTS');
    expect(r.json.message).toBe('This folder is already connected');
    r = await api.post(`/v1/me/drive/sources/${sourceId}/sync`, { as: await as(me) });
    expect(r.status).toBe(429);
    expect(r.json.error).toBe('DRIVE_SYNC_RATE_LIMITED');
    expect(r.json.message).toBe('A sync was requested less than 5 minutes ago');
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(250);
    expect(Number(r.headers.get('retry-after'))).toBeLessThanOrEqual(301);
    // Someone else's source is invisible.
    r = await api.get(`/v1/me/drive/sources/${sourceId}/tree`, { as: await reader(1) });
    expect(r.status).toBe(404);
    expect(r.json.message).toBe(`DriveSource with identifier '${sourceId}' not found`);
    expect((await api.get('/v1/me/drive/sources/not-a-uuid/tree', { as: await as(me) })).status).toBe(400);
    expect((await api.patch(`/v1/me/drive/sources/${sourceId}`, { as: await reader(1), body: { anonymous: true } })).status).toBe(404);
    expect((await api.patch(`/v1/me/drive/sources/${sourceId}`, { as: await as(me), body: {} })).json.message).toBe('anonymous: must not be null');

    // Unclaimed shares need a scheduled run (in-process); staff only.
    const unclaimed = await api.get('/v1/staff/drive/unclaimed', { as: await staff() });
    expect(unclaimed.status).toBe(200);
    expect(unclaimed.text).toBe('[]');
    expect((await api.get('/v1/staff/drive/unclaimed', { as: await as(me) })).status).toBe(403);

    const list = await api.get('/v1/me/drive/sources', { as: await as(me) });
    expect(list.json).toHaveLength(1);
    expect(list.json[0].fileCount).toBe(5);

    // Disconnect deletes the copies.
    expect(s3.keys().length).toBeGreaterThan(0);
    expect((await api.delete(`/v1/me/drive/sources/${sourceId}`, { as: await as(me) })).status).toBe(204);
    const [n] = await api.db`SELECT count(*)::int AS n FROM wiki.drive_file WHERE source_id = ${sourceId}`;
    expect(n!.n).toBe(0);
    expect(s3.keys()).toEqual([]);
    expect((await api.get('/v1/me/drive/sources', { as: await as(me) })).text).toBe('[]');
    expect((await api.delete(`/v1/me/drive/sources/${sourceId}`, { as: await as(me) })).status).toBe(404);
    // ...and the folder can be connected again.
    await register(api, me);
  });

  // ---- reports -----------------------------------------------------------

  test('threeReportsHideAFileUntilStaffRestoresIt', async () => {
    const me = OWNERS[10]!;
    const L = local(me);
    await publishedSource(api, me);
    const pdfId = await fileId(api, `demo-${L}-fis-tp`);
    const report = { reason: 'COPYRIGHT', comment: 'es del libro' };
    expect((await api.put(`/v1/wiki/files/${pdfId}/report`, { as: await reader(1), body: report })).status).toBe(204);
    expect((await api.put(`/v1/wiki/files/${pdfId}/report`, { as: await reader(1), body: report })).status).toBe(204);
    expect((await api.put(`/v1/wiki/files/${pdfId}/report`, { as: await reader(2), body: { reason: 'SPAM' } })).status).toBe(204);
    expect((await api.get(`/v1/wiki/files/${pdfId}`, { as: await reader(1) })).json.reportedByMe).toBe(true);
    expect((await api.get(`/v1/wiki/files/${pdfId}`, { as: await reader(3) })).json.reportedByMe).toBe(false);
    expect((await row(api, `demo-${L}-fis-tp`)).publication).toBe('PUBLISHED');
    expect((await api.put(`/v1/wiki/files/${pdfId}/report`, { as: await reader(3), body: { reason: 'BOGUS' } })).status).toBe(400);
    expect((await api.put(`/v1/wiki/files/${pdfId}/report`, { as: await reader(3), body: {} })).json.message).toBe('reason: must not be null');

    expect((await api.put(`/v1/wiki/files/${pdfId}/report`, { as: await reader(3), body: { reason: 'OTHER' } })).status).toBe(204);
    expect((await row(api, `demo-${L}-fis-tp`)).publication).toBe('HIDDEN_REPORTED');
    expect((await api.get(`/v1/wiki/files/${pdfId}`, { as: await reader(4) })).status).toBe(404);
    expect((await api.get('/v1/wiki/subjects/93.41/files', { as: await reader(4) })).json.groups[0].files).toHaveLength(1);
    // Folders and unpublished files cannot be reported.
    const folder = await api.put(`/v1/wiki/files/${await fileId(api, `demo-${L}-fis`)}/report`, { as: await reader(4), body: { reason: 'SPAM' } });
    expect(folder.status).toBe(404);

    const queue = await api.get('/v1/staff/drive/files?publication=HIDDEN_REPORTED', { as: await staff() });
    expect(queue.json.total).toBe(1);
    expect(queue.json.items[0].reportCount).toBe(3);
    expect(queue.json.items[0].reports).toHaveLength(3);
    expect(queue.json.items[0].reports.map((x: { reason: string }) => x.reason)).toEqual(['OTHER', 'SPAM', 'COPYRIGHT']);
    expect(Object.keys(queue.json.items[0].reports[0])).toEqual(['reason', 'comment', 'createdAt']);
    expect(queue.json.items[0].reports[2].comment).toBe('es del libro');
    expect((await api.get('/v1/staff/drive/files?publication=nope', { as: await staff() })).status).toBe(400);
    const restored = await api.post(`/v1/staff/drive/files/${pdfId}/restore`, { as: await staff() });
    expect(restored.json.publication).toBe('PUBLISHED');
    expect(restored.json.reportCount).toBe(0);

    const removed = await api.post(`/v1/staff/drive/files/${pdfId}/remove`, { as: await staff() });
    expect(removed.json.publication).toBe('REMOVED_BY_STAFF');
    expect((await api.get(`/v1/wiki/files/${pdfId}`, { as: await reader(4) })).status).toBe(404);
    expect((await api.post(`/v1/staff/drive/files/${await fileId(api, `demo-${L}-fis`)}/publish`, { as: await staff() })).status).toBe(404);
    expect((await api.post(`/v1/staff/drive/files/${pdfId}/remove`, { as: await reader(4) })).status).toBe(403);
  });

  // ---- account deletion -------------------------------------------------

  test.skipIf(!hasAccountDeletion)('accountDeletionRemovesSourcesCopiesAndReports', async () => {
    const me = OWNERS[11]!;
    const L = local(me);
    await publishedSource(api, me);
    const pdfId = await fileId(api, `demo-${L}-fis-tp`);
    for (let n = 1; n <= 3; n++) {
      expect((await api.put(`/v1/wiki/files/${pdfId}/report`, { as: await reader(n), body: { reason: 'SPAM' } })).status).toBe(204);
    }
    expect((await row(api, `demo-${L}-fis-tp`)).publication).toBe('HIDDEN_REPORTED');

    // A reporter leaves: the file is recounted and published again.
    const left = await api.delete('/v1/me', { as: await reader(1) });
    expect(left.status).toBeLessThan(300);
    const after = await row(api, `demo-${L}-fis-tp`);
    expect(after.report_count).toBe(2);
    expect(after.publication).toBe('PUBLISHED');

    // The student leaves: sources, files and stored copies go.
    expect(s3.keys().length).toBeGreaterThan(0);
    expect((await api.delete('/v1/me', { as: await as(me) })).status).toBeLessThan(300);
    const [c] = await api.db`SELECT (SELECT count(*)::int FROM wiki.drive_source) AS s, (SELECT count(*)::int FROM wiki.drive_file) AS f`;
    expect(c!.s).toBe(0);
    expect(c!.f).toBe(0);
    expect(s3.keys()).toEqual([]);
  });
});

describe('DriveSyncIT (staff block and source listing)', () => {
  beforeEach(async () => {
    await seed(api);
    s3.clear();
  });

  test('blockUnpublishesAndCannotBeDisconnectedOrRegisteredAgain', async () => {
    const me = OWNERS[0]!;
    const L = local(me);
    const sourceId = await publishedSource(api, me);
    expect((await api.get('/v1/wiki/subjects/93.41/files', { as: await reader(1) })).json.groups).toHaveLength(1);
    const blocked = await api.post(`/v1/staff/drive/sources/${sourceId}/block`, { as: await staff(), body: { comment: '  spam  ' } });
    expect(blocked.status).toBe(200);
    expect(blocked.json.status).toBe('BLOCKED');
    expect(blocked.json.publishedCount).toBe(0);
    expect(blocked.json.community).toBe(false);
    expect(blocked.json.subjectId).toBeNull();
    const [s] = await api.db`SELECT review_comment FROM wiki.drive_source WHERE id = ${sourceId}`;
    expect(s!.review_comment).toBe('spam');
    expect((await api.get('/v1/wiki/subjects/93.41/files', { as: await reader(1) })).json.groups).toEqual([]);
    let r = await api.delete(`/v1/me/drive/sources/${sourceId}`, { as: await as(me) });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe('DRIVE_SOURCE_BLOCKED');
    expect(r.json.message).toBe('A folder blocked by staff cannot be disconnected');
    r = await api.post(`/v1/me/drive/sources/${sourceId}/sync`, { as: await as(me) });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe('InvalidState');
    r = await api.post('/v1/me/drive/sources', { as: await as(me), body: { folderUrl: `demo-${L}`, consentVersion: CONSENT, anonymous: false } });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe('DRIVE_SOURCE_BLOCKED');
    // Approve lifts the block.
    const approved = await api.post(`/v1/staff/drive/sources/${sourceId}/approve`, { as: await staff() });
    expect(approved.json.status).toBe('ACTIVE');
    expect(approved.json.publishedCount).toBe(2);
    expect((await api.post(`/v1/staff/drive/sources/${crypto.randomUUID()}/approve`, { as: await staff() })).status).toBe(404);
    const tooLong = await api.post(`/v1/staff/drive/sources/${sourceId}/block`, { as: await staff(), body: { comment: 'x'.repeat(2001) } });
    expect(tooLong.status).toBe(400);
    expect(tooLong.json.message).toBe('comment: size must be between 0 and 2000');
  });

  test('staffListsSourcesByStatusWithPaging', async () => {
    const a = await register(api, OWNERS[1]!);
    const b = await register(api, OWNERS[2]!);
    expect((await api.post(`/v1/staff/drive/sources/${a}/approve`, { as: await staff() })).status).toBe(200);
    let r = await api.get('/v1/staff/drive/sources', { as: await staff() });
    expect(r.json.total).toBe(2);
    expect(r.json.items.map((x: { id: string }) => x.id)).toEqual([b, a]);
    r = await api.get('/v1/staff/drive/sources?status=active', { as: await staff() });
    expect(r.json.items.map((x: { id: string }) => x.id)).toEqual([a]);
    r = await api.get('/v1/staff/drive/sources?limit=1&page=1', { as: await staff() });
    expect(r.json.total).toBe(2);
    expect(r.json.items.map((x: { id: string }) => x.id)).toEqual([a]);
    r = await api.get('/v1/staff/drive/sources?limit=0&page=-3', { as: await staff() });
    expect(r.json.items).toHaveLength(1);
    r = await api.get('/v1/staff/drive/sources?status=WHAT', { as: await staff() });
    expect(r.status).toBe(400);
    expect(r.json.message).toBe("Validation failed for field 'status' with value 'WHAT': unknown value");
    expect((await api.get('/v1/staff/drive/sources', { as: await reader(1) })).status).toBe(403);
    const files = await api.get('/v1/staff/drive/files', { as: await staff() });
    expect(files.status).toBe(200);
    // a is ACTIVE but nothing has a subject yet; b's files are left out while it is PENDING_REVIEW.
    expect(files.text).toBe('{"items":[],"total":0}');
  });

  test('capabilityAndConfiguredChecks', async () => {
    await api.db`UPDATE public.capability_settings SET enabled_for_all = false WHERE capability = 'apuntes'`;
    const r = await api.get('/v1/me/drive/info', { as: await reader(1) });
    expect(r.status).toBe(403);
    expect(r.json.error).toBe('CAPABILITY_REQUIRED');
    expect(r.json.message).toBe("This feature requires the 'apuntes' capability");
    // A bad body is rejected before the capability check.
    const bad = await api.post('/v1/me/drive/sources', { as: await reader(1), body: { folderUrl: '' } });
    expect(bad.status).toBe(400);
    expect((await api.get('/v1/wiki/apuntes/subjects', { as: await reader(1) })).status).toBe(403);
    // Staff hold every capability.
    expect((await api.get('/v1/me/drive/info', { as: await staff() })).status).toBe(200);
    expect((await api.get('/v1/me/drive/info')).status).toBe(401);
    expect((await api.get('/v1/wiki/subjects/99.99/files', { as: await staff() })).status).toBe(404);
  });
});

describe('DriveSyncIT (reference storage)', () => {
  beforeEach(async () => {
    await seed(ref);
    s3ref.clear();
  });

  test('filesKeptByReferenceStreamFromDrive', async () => {
    const me = OWNERS[0]!;
    const L = local(me);
    const sourceId = await publishedSource(ref, me);
    void sourceId;
    const pdf = await row(ref, `demo-${L}-fis-tp`);
    expect(pdf.by_reference).toBe(true);
    expect(pdf.pdf_key).toBeNull();
    expect(pdf.content_fingerprint).toMatch(/^ref:md5:[0-9a-f]{32}$/);
    expect(pdf.text_content).toBe('TP1 Vectores: suma, producto escalar y vectorial.');
    // Docs have no size: still stored.
    expect((await row(ref, `demo-${L}-fis-res`)).by_reference).toBe(false);
    expect(s3ref.keys().every((k) => k.startsWith(`drive/demo-${L}-fis-res/`))).toBe(true);
    const pdfId = pdf.id as string;
    const detail = await ref.get(`/v1/wiki/files/${pdfId}`, { as: await reader(1) });
    expect(detail.json.hasPdf).toBe(true);
    expect(detail.json.hasOriginal).toBe(true);
    const dl = await ref.get(`/v1/wiki/files/${pdfId}/download`, { as: await reader(1) });
    expect(dl.status).toBe(200);
    expect(dl.headers.get('content-type')).toBe('application/pdf');
    expect(dl.headers.get('content-disposition')).toBe("inline; filename*=UTF-8''TP1%20-%20Vectores.pdf");
    expect(dl.headers.get('x-content-type-options')).toBe('nosniff');
    expect(dl.headers.get('cache-control')).toBe('no-store');
    expect(dl.headers.get('content-length')).toBe(String(pdf.size_bytes));
    expect(dl.text.startsWith('%PDF-')).toBe(true);
    const att = await ref.get(`/v1/wiki/files/${pdfId}/download?variant=original&disposition=attachment`, { as: await reader(1) });
    expect(att.status).toBe(200);
    expect(att.headers.get('content-disposition')).toBe("attachment; filename*=UTF-8''TP1%20-%20Vectores.pdf");
    expect(att.headers.get('content-type')).toBe('application/octet-stream');
    // The image is not downloaded at sync time; it streams on request.
    await ref.patch(`/v1/me/drive/files/${await fileId(ref, `demo-${L}-varios`)}`, { as: await as(me), body: { subjectId: '93.42' } });
    const img = await row(ref, `demo-${L}-varios-img`);
    expect(img.by_reference).toBe(true);
    expect(img.original_content_type).toBe('image/png');
    const png = await ref.get(`/v1/wiki/files/${img.id}/download`, { as: await reader(1) });
    expect(png.status).toBe(200);
    expect(png.headers.get('content-type')).toBe('image/png');
    expect(png.headers.get('content-disposition')).toBe("inline; filename*=UTF-8''pizarron.png");
    expect((await ref.get(`/v1/wiki/files/${img.id}/download?variant=pdf`, { as: await reader(1) })).status).toBe(404);
    const imgAttachment = await ref.get(`/v1/wiki/files/${img.id}/download?disposition=attachment`, { as: await reader(1) });
    expect(imgAttachment.headers.get('content-type')).toBe('application/octet-stream');
    expect(imgAttachment.headers.get('content-disposition')).toBe("attachment; filename*=UTF-8''pizarron.png");
  });
});

describe('DriveSyncIT (no object storage)', () => {
  beforeEach(async () => {
    await seed(bare);
  });

  test('copiesFailWithTheStorageErrorAsSyncError', async () => {
    const me = OWNERS[0]!;
    const sourceId = await register(bare, me);
    const t = await tree(bare, me, sourceId);
    const msg = 'FeatureNotConfiguredException: Object storage not configured. Set STORAGE_ENDPOINT, STORAGE_BUCKET, '
      + 'STORAGE_ACCESS_KEY_ID, STORAGE_SECRET_ACCESS_KEY and STORAGE_PUBLIC_URL.';
    for (const n of ['TP1 - Vectores.pdf', 'Resumen cinemática', 'pizarron.png', 'Parcial resuelto.pdf']) expect([n, item(t, n).syncError]).toEqual([n, msg]);
    expect(item(t, 'Física I').syncError).toBeNull();
    expect(t.source.status).toBe('PENDING_REVIEW');
    expect(t.source.lastError).toBeNull();
    const [r] = await bare.db`SELECT content_fingerprint, text_content FROM wiki.drive_file WHERE drive_id = ${`demo-${local(me)}-fis-tp`}`;
    expect(r!.content_fingerprint).toBeNull();
    expect(r!.text_content).toBeNull();
  });
});

// Doc fingerprint of the demo Doc ("doc\n" + sanitized HTML + image bytes): identical only when the HTML is
// byte-identical to jsoup's. Frozen from the Java run; the key prefix is DriveBlobs.prefix's hash of it.
const EXPECTED_DEMO_DOC_FINGERPRINT = 'sha:2ae3efbeb5d36e328221c1e9c37849c8';
const EXPECTED_DEMO_DOC_PREFIX = 'bdc0901d812127ec';
