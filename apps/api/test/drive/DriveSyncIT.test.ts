// In-process port of apps/api/src/test/java/org/ceitba/api/web/drive/DriveSyncIT.java,
// every @Test in full: the FakeDriveClient is mutated (rename/move/edit/remove/
// revoke, blocked downloads, backdated items), the InMemoryObjectStorage is
// inspected (keys, put count, fake signed URLs), DriveSyncService.syncSource /
// runAll are called directly. The black-box half is contract/tests/drive-sync.contract.test.ts.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { copyPlanSubjectsToEntries, mintJwt, seedStaff } from '../../contract/support/identity';
import { FakeDriveClient } from '../../src/external/drive';
import { driveServices } from '../../src/features/drive/services';
import type { Outcome } from '../../src/features/drive/sync';
import { InMemoryObjectStorage } from '../media/support/InMemoryObjectStorage';
import { testApp, type TestApp } from '../support/app';

const ALUMNO = 'alumno1@itba.edu.ar';
const ROOT = 'root-alumno1-0001';
const FIS = 'folder-fisica-0001';
const MISC = 'folder-varios-0001';
const DOC = 'doc-resumen-00001';
const PDF = 'pdf-tp1-000000001';
const FOREIGN = 'pdf-catedra-00001';
const IMG = 'img-pizarron-0001';
const pdf = FakeDriveClient.pdf;
const png = FakeDriveClient.tinyPng;
const bytes = (s: string) => new TextEncoder().encode(s);

let t: TestApp;
const drive = new FakeDriveClient();
const storage = new InMemoryObjectStorage();

beforeAll(async () => {
  t = await testApp({ env: { DRIVE_SYNC_USE_FAKE: 'true' }, overrides: { drive, storage } });
}, 60_000);
afterAll(async () => {
  await driveServices(t.deps).trigger.idle();
  driveServices(t.deps).pool.close();
  await t?.close();
});

const svc = () => driveServices(t.deps);
const tokens = new Map<string, string>();
async function auth(email: string): Promise<Record<string, string>> {
  if (!tokens.has(email)) tokens.set(email, await mintJwt({ email, name: email === ALUMNO ? 'Alumno Uno' : email }));
  return { Authorization: `Bearer ${tokens.get(email)}` };
}
const student = () => auth(ALUMNO);
const reader = (n: number) => auth(`lector${n}@itba.edu.ar`);
const staff = () => auth('staff@itba.edu.ar');

async function call(method: string, path: string, who: Record<string, string>, body?: unknown) {
  return t.request(method, path, { headers: who, body });
}

async function register(folder: string, who: Record<string, string>): Promise<string> {
  const r = await call('POST', '/v1/me/drive/sources', who,
    { folderUrl: `https://drive.google.com/drive/folders/${folder}?usp=sharing`, consentVersion: '2026-10', anonymous: false });
  expect(r.status).toBe(201);
  expect(r.json.createdAt).not.toBeNull();
  // Registration queues an async sync; wait for it to finish.
  await svc().trigger.idle();
  const [s] = await t.sql`SELECT last_synced_at FROM wiki.drive_source WHERE id = ${r.json.id}`;
  expect(s!.last_synced_at).not.toBeNull();
  return r.json.id as string;
}

/** Runs a sync now (retrying while an async one still holds the source). */
async function syncNow(sourceId: string): Promise<Outcome> {
  for (let i = 0; i < 400; i++) {
    const out = await svc().sync.syncSource(sourceId);
    if (out !== 'SKIPPED') return out;
    await Bun.sleep(50);
  }
  throw new Error('sync kept being skipped');
}

async function tree(sourceId: string) {
  const r = await call('GET', `/v1/me/drive/sources/${sourceId}/tree`, await student());
  expect(r.status).toBe(200);
  return r.json;
}

function item(tr: { items: { name: string }[] }, name: string): any {
  const i = tr.items.find((x) => x.name === name);
  if (!i) throw new Error(`no item ${name} in ${JSON.stringify(tr)}`);
  return i;
}

async function row(driveId: string): Promise<any> {
  const [r] = await t.sql`SELECT * FROM wiki.drive_file WHERE drive_id = ${driveId}`;
  return r;
}
const fileId = async (driveId: string) => (await row(driveId)).id as string;
const keysOf = (r: any): string[] => {
  const keys: string[] = [];
  if (r.pdf_key) keys.push(r.pdf_key);
  if (r.original_key && r.original_key !== r.pdf_key) keys.push(r.original_key);
  if (r.asset_prefix) for (const n of r.asset_names as string[]) keys.push(r.asset_prefix + n);
  return keys;
};

/** Registered, approved and with Física I assigned to its folder. */
async function publishedSource(): Promise<string> {
  const id = await register(ROOT, await student());
  expect((await call('POST', `/v1/staff/drive/sources/${id}/approve`, await staff())).status).toBe(200);
  expect((await call('PATCH', `/v1/me/drive/files/${await fileId(FIS)}`, await student(), { subjectId: '93.41' })).status).toBe(200);
  return id;
}

describe('DriveSyncIT', () => {
  beforeEach(async () => {
    await svc().trigger.idle();
    await t.sql`TRUNCATE wiki.kb_page, wiki.drive_unclaimed_share, wiki.drive_file_report, wiki.drive_file,
                wiki.drive_source, public."user", public.plan_subject, public.plan_entry, public.subject, public.plan, public.careers CASCADE`;
    await t.sql`INSERT INTO public.capability_settings (capability, enabled_for_all) VALUES ('apuntes', true)
                ON CONFLICT (capability) DO UPDATE SET enabled_for_all = true`;
    drive.reset();
    storage.clear();
    await t.sql`INSERT INTO public.subject (id, name, credits, updated_at) VALUES ('93.41', 'Física I', 6, now()),
                ('93.42', 'Física II', 6, now()), ('93.26', 'Análisis Matemático I', 6, now()), ('72.31', 'Programación Imperativa', 6, now())`;
    await seedStaff(t.sql, 'staff@itba.edu.ar');
    drive.folder(ROOT, 'Apuntes de Alumno', null, ALUMNO)
      .folder(FIS, 'Física I', ROOT, ALUMNO)
      .doc(DOC, 'Resumen cinemática', FIS, ALUMNO,
        '<html><body><p class="c1">MRU uniforme</p><img src="images/image1.png"><script>x()</script></body></html>',
        new Map([['image1.png', png()]]))
      .file(PDF, 'TP1.pdf', 'application/pdf', FIS, ALUMNO, pdf('Vectores y escalares'))
      .file(FOREIGN, 'Guia catedra.pdf', 'application/pdf', FIS, 'catedra@itba.edu.ar', pdf('Guia de ejercicios'))
      .folder(MISC, 'Varios', ROOT, ALUMNO)
      .file(IMG, 'pizarron.png', 'image/png', MISC, ALUMNO, png())
      .file('form-encuesta-0001', 'Encuesta', 'application/vnd.google-apps.form', ROOT, ALUMNO, null)
      .shortcut('shortcut-tp1-0001', 'Atajo TP1', MISC, ALUMNO, PDF);
  });

  test('registerSyncSuggestApprovePublishAndRead', async () => {
    let r = await call('GET', '/v1/me/drive/info', await student());
    expect(r.status).toBe(200);
    expect(r.json.botEmail).toBe(FakeDriveClient.BOT_EMAIL);
    expect(r.json.consentVersion).toBe('2026-10');

    const sourceId = await register(ROOT, await student());
    let tr = await tree(sourceId);
    expect(tr.source.status).toBe('PENDING_REVIEW');
    expect(tr.source.rootName).toBe('Apuntes de Alumno');
    // 2 folders + 4 files; the form is skipped and the shortcut to TP1 is deduplicated.
    expect(tr.items).toHaveLength(6);
    expect(tr.source.fileCount).toBe(4);
    const fis = item(tr, 'Física I');
    expect(fis.kind).toBe('FOLDER');
    expect(fis.suggestedSubjectId).toBe('93.41');
    expect(fis.suggestedSubjectName).toBe('Física I');
    expect(item(tr, 'TP1.pdf').parentId).toBe(fis.id);
    expect(item(tr, 'Varios').parentId).toBeNull();
    expect(item(tr, 'TP1.pdf').publication).toBe('PRIVATE');
    expect(item(tr, 'Guia catedra.pdf').ownedByMe).toBe(false);
    expect(item(tr, 'Guia catedra.pdf').hidden).toBe(true);
    expect(item(tr, 'TP1.pdf').hidden).toBe(false);

    r = await call('POST', `/v1/me/drive/sources/${sourceId}/accept-suggestions`, await student());
    expect(r.status).toBe(200);
    expect(r.json.applied).toBe(1);
    tr = await tree(sourceId);
    const doc = item(tr, 'Resumen cinemática');
    expect(doc.effectiveSubjectId).toBe('93.41');
    expect(doc.subjectId).toBeNull();
    expect(doc.publication).toBe('NEEDS_REVIEW');
    expect(tr.source.needsReviewCount).toBe(2);
    expect(item(tr, 'Guia catedra.pdf').publication).toBe('PRIVATE');

    const docId = doc.id as string;
    expect((await call('GET', `/v1/wiki/files/${docId}`, await reader(1))).status).toBe(404);
    const preview = await call('GET', `/v1/wiki/files/${docId}`, await student());
    expect(preview.status).toBe(200);
    expect(preview.json.html).toContain(`<img src="/api/v1/wiki/files/${docId}/assets/image1.png"`);
    expect(preview.json.html).not.toContain('script');
    expect(preview.json.html).not.toContain('class=');
    expect(preview.json.hasHtml).toBe(true);
    expect(preview.json.hasPdf).toBe(true);
    expect(preview.json.path).toBe('Física I');
    expect(storage.keys().length).toBeGreaterThan(0);
    expect(storage.keys().every((k) => k.startsWith('drive/'))).toBe(true);
    expect((await row(DOC)).text_content).toContain('MRU uniforme');
    expect((await row(PDF)).text_content).toContain('Vectores');

    r = await call('GET', '/v1/staff/drive/sources?status=PENDING_REVIEW', await staff());
    expect(r.status).toBe(200);
    expect(r.json.total).toBe(1);
    expect(r.json.items[0].ownerEmail).toBe(ALUMNO);
    r = await call('POST', `/v1/staff/drive/sources/${sourceId}/approve`, await staff(), { comment: 'ok' });
    expect(r.status).toBe(200);
    expect(r.json.status).toBe('ACTIVE');
    expect(r.json.publishedCount).toBe(2);
    expect(r.json.needsReviewCount).toBe(0);

    const subjectFiles = (await call('GET', '/v1/wiki/subjects/93.41/files', await reader(1))).json;
    expect(subjectFiles.subjectName).toBe('Física I');
    expect(subjectFiles.groups).toHaveLength(1);
    const group = subjectFiles.groups[0];
    expect(group.author.name).toBe('Alumno Uno');
    expect(group.author.anonymous).toBe(false);
    expect(group.files).toHaveLength(2);
    expect(group.files[0].path).toBe('Física I');

    const pdfId = await fileId(PDF);
    r = await call('GET', `/v1/wiki/files/${pdfId}/download`, await reader(1));
    expect(r.status).toBe(302);
    const loc = r.headers.get('location')!;
    expect(loc.startsWith('https://storage.test/drive/')).toBe(true);
    expect(loc).toContain('ttl=300');
    expect(loc).toContain('disposition=inline&filename=TP1.pdf&type=application%2Fpdf');
    expect((await call('GET', `/v1/wiki/files/${pdfId}/download?disposition=attachment`, await reader(1))).headers.get('location')).toContain('disposition=attachment');
    expect((await call('GET', `/v1/wiki/files/${pdfId}/download?disposition=x`, await reader(1))).status).toBe(400);
    r = await call('GET', `/v1/wiki/files/${pdfId}`, await reader(1));
    expect(r.json.pdfMimeType).toBe('application/pdf');
    expect(r.json.originalMimeType).toBe('application/pdf');
    expect(r.json.exportBlocked).toBe(false);
    expect(r.json.driveUrl).toBe(`https://drive.google.com/file/d/${PDF}/view`);
    r = await call('GET', `/v1/wiki/files/${docId}`, await reader(1));
    expect(r.json.originalMimeType).toBeNull();
    expect(r.json.driveUrl).toBe(`https://docs.google.com/document/d/${DOC}/edit`);
    r = await call('GET', `/v1/wiki/files/${docId}/assets/image1.png`, await reader(1));
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toContain('disposition=inline&filename=image1.png&type=image%2Fpng');
    expect((await call('GET', `/v1/wiki/files/${docId}/assets/other.png`, await reader(1))).status).toBe(404);
    expect((await call('GET', `/v1/wiki/files/${docId}/download?variant=original`, await reader(1))).status).toBe(404);

    expect((await call('PATCH', `/v1/me/drive/sources/${sourceId}`, await student(), { anonymous: true })).status).toBe(200);
    r = await call('GET', '/v1/wiki/subjects/93.41/files', await reader(1));
    expect(r.json.groups[0].author.name).toBeNull();
    expect(r.json.groups[0].author.anonymous).toBe(true);
    expect((await call('GET', '/v1/staff/drive/sources', await staff())).json.items[0].ownerName).toBe('Alumno Uno');

    expect((await call('GET', '/v1/staff/drive/files?publication=NEEDS_REVIEW', await staff())).json.total).toBe(0);
    r = await call('PATCH', `/v1/me/drive/files/${await fileId(FOREIGN)}`, await student(), { hidden: false });
    expect(r.json.hidden).toBe(false);
    expect(r.json.publication).toBe('NEEDS_REVIEW');
    await syncNow(sourceId);
    expect(item(await tree(sourceId), 'Guia catedra.pdf').hidden).toBe(false);
    r = await call('GET', '/v1/staff/drive/files?publication=NEEDS_REVIEW', await staff());
    expect(r.json.total).toBe(1);
    expect(r.json.items[0].ownerEmail).toBe('catedra@itba.edu.ar');
    expect(r.json.items[0].sharerEmail).toBe(ALUMNO);
    expect((await call('POST', `/v1/staff/drive/files/${await fileId(FOREIGN)}/publish`, await staff())).json.publication).toBe('PUBLISHED');
    await syncNow(sourceId);
    expect(item(await tree(sourceId), 'Guia catedra.pdf').publication).toBe('PUBLISHED');

    r = await call('GET', '/v1/wiki/apuntes/subjects', await reader(1));
    expect(r.json[0].subjectId).toBe('93.41');
    expect(r.json[0].fileCount).toBe(3);
    expect(r.json[0].hasWiki).toBe(false);
    await t.sql`INSERT INTO wiki.kb_page (subject_id, slug, type, title, summary, markdown, generator, generated_at)
                VALUES ('93.42', 'index', 'INDEX', 'Física II', 's', 'm', 'manual', now())`;
    expect((await call('GET', '/v1/wiki/apuntes/subjects', await reader(1))).json[0].hasWiki).toBe(false);
    const search = (await call('GET', '/v1/wiki/apuntes/subjects?q=fisica', await reader(1))).json;
    expect(search).toHaveLength(2);
    expect(search[0].subjectId).toBe('93.41');
    expect(search[0].hasWiki).toBe(false);
    expect(search[1].fileCount).toBe(0);
    expect(search[1].hasWiki).toBe(true);

    expect((await call('PATCH', `/v1/me/drive/files/${await fileId(FIS)}`, await student(), { hidden: true })).json.hidden).toBe(true);
    expect(item(await tree(sourceId), 'TP1.pdf').publication).toBe('PRIVATE');
    expect((await call('PATCH', `/v1/me/drive/files/${await fileId(FIS)}`, await student(), { hidden: false, subjectId: '' })).json.subjectId).toBeNull();
    expect(item(await tree(sourceId), 'TP1.pdf').publication).toBe('PRIVATE');
    expect((await call('PATCH', `/v1/me/drive/files/${await fileId(FIS)}`, await student(), { subjectId: '99.99' })).status).toBe(400);
  });

  test('textOriginalsInlineAsPlainTextAndBlockedDownloadsAreMetadataOnly', async () => {
    drive.file('py-script-000001', 'tp2.py', 'text/x-python', FIS, ALUMNO, bytes("print('hola')"))
      .file('ipynb-colab-00001', 'Clase 3.ipynb', 'application/vnd.google.colaboratory', FIS, ALUMNO, bytes('{"cells":[]}'))
      .file('html-page-000001', 'pagina.html', 'text/html', FIS, ALUMNO, bytes('<script>x</script>'))
      .doc('doc-blocked-00001', 'Resumen bloqueado', FIS, ALUMNO, '<p>secreto</p>')
      .file('pdf-blocked-00001', 'Bloqueado.pdf', 'application/pdf', FIS, ALUMNO, pdf('x'));
    drive.setDownloadBlocked('doc-blocked-00001', true);
    drive.setDownloadBlocked('pdf-blocked-00001', true);
    await publishedSource();

    const py = await fileId('py-script-000001');
    let r = await call('GET', `/v1/wiki/files/${py}`, await reader(1));
    expect(r.json.kind).toBe('OTHER');
    expect(r.json.hasOriginal).toBe(true);
    expect(r.json.originalMimeType).toBe('text/plain; charset=utf-8');
    r = await call('GET', `/v1/wiki/files/${py}/download?variant=original`, await reader(1));
    expect(r.headers.get('location')).toContain('disposition=inline&filename=tp2.py&type=text%2Fplain%3B+charset%3Dutf-8');
    expect((await row('py-script-000001')).text_content).toContain('hola');
    expect((await call('GET', `/v1/wiki/files/${await fileId('ipynb-colab-00001')}`, await reader(1))).json.originalMimeType).toBe('text/plain; charset=utf-8');
    // HTML is not text the pipeline can use: skipped entirely (no row).
    expect(await row('html-page-000001')).toBeUndefined();

    for (const blocked of ['doc-blocked-00001', 'pdf-blocked-00001']) {
      const b = await row(blocked);
      expect(b.export_blocked).toBe(true);
      expect(b.sync_error).toBeNull();
      expect(keysOf(b)).toEqual([]);
    }
    const blockedPdf = await fileId('pdf-blocked-00001');
    r = await call('GET', `/v1/wiki/files/${blockedPdf}`, await reader(1));
    expect(r.json.exportBlocked).toBe(true);
    expect(r.json.hasPdf).toBe(false);
    expect(r.json.driveUrl).toBe('https://drive.google.com/file/d/pdf-blocked-00001/view');
    expect((await call('GET', `/v1/wiki/files/${blockedPdf}/download`, await reader(1))).status).toBe(404);
    const sourceId = (await row('pdf-blocked-00001')).source_id as string;
    expect(item(await tree(sourceId), 'Bloqueado.pdf').exportBlocked).toBe(true);

    drive.setDownloadBlocked('pdf-blocked-00001', false);
    await syncNow(sourceId);
    const unblocked = await row('pdf-blocked-00001');
    expect(unblocked.export_blocked).toBe(false);
    expect(unblocked.pdf_key).not.toBeNull();
  });

  test('reprocessReExportsDocsAndKeepsUnchangedCopies', async () => {
    const sourceId = await publishedSource();
    await syncNow(sourceId);
    const before = await row(DOC);
    const fetches = drive.fetchCount(DOC);
    const puts = storage.putCount();

    let r = await call('POST', '/v1/staff/drive/reprocess?kind=DOC', await staff());
    expect(r.status).toBe(200);
    expect(r.json.files).toBe(1);
    expect(r.json.sources).toBe(1);
    expect((await call('POST', '/v1/staff/drive/reprocess?kind=PDF', await staff())).status).toBe(400);
    expect((await call('POST', '/v1/staff/drive/reprocess', await student())).status).toBe(403);
    await svc().trigger.idle();
    expect(drive.fetchCount(DOC)).toBeGreaterThan(fetches);
    const after = await row(DOC);
    expect(after.content_modified_at).not.toBeNull();
    expect(after.content_fingerprint).toBe(before.content_fingerprint);
    expect(storage.putCount()).toBe(puts);
  });

  test('academicYears', async () => {
    drive.folder('folder-parc-2019', 'Parciales 2019', ROOT, ALUMNO)
      .file('pdf-parcial-0001', "Parcial 1C'21.pdf", 'application/pdf', 'folder-parc-2019', ALUMNO, pdf('parcial'))
      .file('pdf-viejo-000001', 'Viejo.pdf', 'application/pdf', 'folder-parc-2019', ALUMNO, pdf('viejo'));
    drive.setCreated(PDF, '2018-05-01T12:00:00Z');
    const sourceId = await publishedSource();

    let tr = await tree(sourceId);
    expect(item(tr, 'Resumen cinemática').academicYear).toBe(2025);
    expect(item(tr, 'Resumen cinemática').academicYearSource).toBe('DRIVE');
    expect(item(tr, 'Resumen cinemática').ownAcademicYear).toBeNull();
    expect(item(tr, 'TP1.pdf').academicYear).toBe(2018);
    expect(item(tr, "Parcial 1C'21.pdf").academicYear).toBe(2021);
    expect(item(tr, "Parcial 1C'21.pdf").academicYearSource).toBe('NAME');
    expect(item(tr, 'Viejo.pdf').academicYear).toBe(2019);
    expect(item(tr, 'Viejo.pdf').academicYearSource).toBe('NAME');

    let r = await call('PATCH', `/v1/me/drive/files/${await fileId(FIS)}`, await student(), { academicYear: 2020 });
    expect(r.json.academicYear).toBe(2020);
    expect(r.json.academicYearSource).toBe('USER');
    expect(r.json.ownAcademicYear).toBe(2020);
    expect((await call('PATCH', `/v1/me/drive/files/${await fileId(DOC)}`, await student(), { academicYear: 2022 })).status).toBe(200);
    await syncNow(sourceId);
    tr = await tree(sourceId);
    expect(item(tr, 'TP1.pdf').academicYear).toBe(2020);
    expect(item(tr, 'TP1.pdf').academicYearSource).toBe('INHERITED');
    expect(item(tr, 'TP1.pdf').ownAcademicYear).toBeNull();
    expect(item(tr, 'Resumen cinemática').academicYear).toBe(2022);
    expect(item(tr, 'Resumen cinemática').academicYearSource).toBe('USER');

    expect((await call('PATCH', `/v1/me/drive/files/${await fileId(DOC)}`, await student(), { hidden: false })).json.academicYear).toBe(2022);
    r = await call('PATCH', `/v1/me/drive/files/${await fileId(FIS)}`, await student(), { academicYear: null });
    expect(r.json.ownAcademicYear).toBeNull();
    expect(item(await tree(sourceId), 'TP1.pdf').academicYearSource).toBe('DRIVE');
    expect((await call('PATCH', `/v1/me/drive/files/${await fileId(DOC)}`, await student(), { academicYear: 2099 })).status).toBe(400);

    r = await call('GET', `/v1/wiki/files/${await fileId(PDF)}`, await reader(1));
    expect(r.json.academicYear).toBe(2018);
    expect(r.json.academicYearSource).toBe('DRIVE');
    expect((await call('GET', '/v1/wiki/subjects/93.41/files', await reader(1))).json.groups[0].files[0].academicYear).toBeDefined();
  });

  test('planAwareSuggestionsAndMySubjects', async () => {
    await t.sql`INSERT INTO public.careers (id, name, updated_at) VALUES ('LAES', 'Analítica', now())`;
    await t.sql`INSERT INTO public.plan (id, career_id, name, updated_at) VALUES ('A22', 'LAES', 'Plan 2022', now())`;
    await t.sql`INSERT INTO public.subject (id, name, credits, updated_at) VALUES ('82.15', 'Matemática Aplicada', 6, now()),
                ('93.16', 'Matemática Discreta', 6, now()), ('93.24', 'Probabilidad y Estadística', 6, now()), ('71.98', 'Sociología', 3, now()),
                ('71.97', 'Visualización de Datos', 3, now()), ('71.96', 'Análisis de Redes', 3, now())`;
    await t.sql`INSERT INTO public.plan_subject (subject_id, plan_id, section, year, semester, credits_required, dependencies) VALUES
                ('71.98', 'A22', 'Electivas Social', 0, 0, 0, '{}'), ('71.97', 'A22', 'Electivas Analytics', 0, 0, 0, '{}'),
                ('71.96', 'A22', 'Electivas Analytics', 0, 0, 0, '{}'), ('82.15', 'A22', 'Ciclo', 1, 2, 0, '{}'),
                ('93.16', 'A22', 'Ciclo', 2, 1, 0, '{}'), ('93.24', 'A22', 'Ciclo', 2, 2, 0, '{}')`;
    await copyPlanSubjectsToEntries(t.sql);
    drive.folder('folder-mate-00001', 'Resumen Mate', ROOT, ALUMNO)
      .doc('doc-discreta-0001', 'Teoría Matemática Discreta full', 'folder-mate-00001', ALUMNO, '<p>grafos</p>')
      .doc('doc-mate-guia-001', 'Guía 1', 'folder-mate-00001', ALUMNO, '<p>funciones</p>')
      .doc('doc-estad-000001', 'Resumen estadistica', ROOT, ALUMNO, '<p>varianza</p>');

    const sourceId = await register(ROOT, await student());
    let tr = await tree(sourceId);
    expect(item(tr, 'Resumen estadistica').suggestedSubjectId).toBeNull();
    expect(item(tr, 'Física I').suggestedInMyPlan).toBe(false);
    expect((await call('GET', '/v1/wiki/apuntes/subjects?mine=true', await student())).json).toEqual([]);

    await t.sql`UPDATE public."user" SET plan = 'A22' WHERE email = ${ALUMNO}`;
    let r = await call('POST', `/v1/me/drive/sources/${sourceId}/recompute-suggestions`, await student());
    expect(r.status).toBe(200);
    tr = r.json;
    const mate = item(tr, 'Resumen Mate');
    expect(mate.suggestedSubjectId).toBe('82.15');
    expect(mate.suggestedInMyPlan).toBe(true);
    expect(item(tr, 'Guía 1').suggestedSubjectId).toBeNull();
    expect(item(tr, 'Teoría Matemática Discreta full').suggestedSubjectId).toBe('93.16');
    expect(item(tr, 'Resumen estadistica').suggestedSubjectId).toBe('93.24');
    expect(item(tr, 'Física I').suggestedSubjectId).toBe('93.41');
    expect(item(tr, 'Física I').suggestedInMyPlan).toBe(false);

    expect((await call('POST', `/v1/me/drive/sources/${sourceId}/accept-suggestions`, await student())).json.applied).toBe(4);
    tr = await tree(sourceId);
    expect(item(tr, 'Guía 1').effectiveSubjectId).toBe('82.15');
    expect(item(tr, 'Guía 1').effectiveInMyPlan).toBe(true);
    expect(item(tr, 'Teoría Matemática Discreta full').effectiveSubjectId).toBe('93.16');

    expect((await call('POST', `/v1/staff/drive/sources/${sourceId}/approve`, await staff())).status).toBe(200);
    let mine = (await call('GET', '/v1/wiki/apuntes/subjects?mine=true', await student())).json;
    expect(mine).toHaveLength(6);
    expect(mine.map((m: { subjectId: string }) => m.subjectId)).toEqual(['82.15', '93.16', '93.24', '71.96', '71.97', '71.98']);
    expect(mine[0].year).toBe(1);
    expect(mine[0].semester).toBe(2);
    expect(mine[0].section).toBe('Ciclo');
    expect(mine[3].year).toBeNull();
    expect(mine[3].semester).toBeNull();
    expect(mine[3].section).toBe('Electivas Analytics');
    expect(mine[5].section).toBe('Electivas Social');
    expect(mine[0].fileCount).toBe(1);
    expect(mine[1].subjectId).toBe('93.16');
    expect(mine[2].fileCount).toBe(1);
    expect(mine[0].hasWiki).toBe(false);
    await t.sql`INSERT INTO wiki.kb_page (subject_id, slug, type, title, summary, markdown, generator, generated_at, status)
                VALUES ('93.16', 'index', 'INDEX', 'Discreta', 's', 'm', 'manual', now(), 'PUBLISHED'),
                       ('82.15', 'index', 'INDEX', 'Aplicada', 's', 'm', 'manual', now(), 'HIDDEN')`;
    mine = (await call('GET', '/v1/wiki/apuntes/subjects?mine=true', await student())).json;
    expect(mine[0].hasWiki).toBe(false);
    expect(mine[1].hasWiki).toBe(true);
    r = await call('GET', '/v1/wiki/apuntes/subjects', await reader(1));
    expect(r.json[0].year).toBeNull();
  });

  test('renameMoveEditRemoveAndRevoke', async () => {
    const sourceId = await publishedSource();
    const docId = await fileId(DOC);
    const pdfId = await fileId(PDF);
    expect(docId).toBeDefined();
    const docFetches = drive.fetchCount(DOC);
    const pdfFetches = drive.fetchCount(PDF);
    const docRow = await row(DOC);
    const docFingerprint = docRow.content_fingerprint;
    const docKeys = keysOf(docRow);
    const puts = storage.putCount();
    expect(docFetches).toBe(2); // zip + pdf
    expect(pdfFetches).toBe(1);

    drive.rename(DOC, 'Resumen cinemática v2');
    expect(await syncNow(sourceId)).toBe('SYNCED');
    const renamed = await row(DOC);
    expect(renamed.name).toBe('Resumen cinemática v2');
    expect(renamed.content_fingerprint).toBe(docFingerprint);
    expect(keysOf(renamed)).toEqual(docKeys);
    expect(drive.fetchCount(DOC)).toBe(docFetches + 1);
    expect(storage.putCount()).toBe(puts);

    drive.rename(PDF, 'TP1 resuelto.pdf');
    await syncNow(sourceId);
    expect((await row(PDF)).name).toBe('TP1 resuelto.pdf');
    expect(drive.fetchCount(PDF)).toBe(pdfFetches);

    drive.move(PDF, MISC);
    await syncNow(sourceId);
    const moved = item(await tree(sourceId), 'TP1 resuelto.pdf');
    expect(moved.id).toBe(pdfId);
    expect(moved.parentId).toBe(await fileId(MISC));
    expect(moved.effectiveSubjectId).toBeNull();
    expect(moved.publication).toBe('PRIVATE');
    expect(drive.fetchCount(PDF)).toBe(pdfFetches);
    expect((await call('PATCH', `/v1/me/drive/files/${pdfId}`, await student(), { subjectId: '93.42' })).json.publication).toBe('PUBLISHED');
    const detail = (await call('GET', `/v1/wiki/files/${pdfId}`, await reader(1))).json;
    expect(detail.path).toBe('Varios');
    expect(detail.subjectId).toBe('93.42');

    drive.updateDoc(DOC, '<html><body><p>MRUV acelerado</p></body></html>');
    await syncNow(sourceId);
    const edited = await row(DOC);
    expect(edited.content_fingerprint).not.toBe(docFingerprint);
    expect(edited.text_content).toContain('MRUV acelerado');
    expect(edited.asset_names).toEqual([]);
    expect(drive.fetchCount(DOC)).toBe(docFetches + 3);
    for (const k of docKeys) expect(storage.keys()).not.toContain(k);
    for (const k of keysOf(edited)) expect(storage.keys()).toContain(k);

    drive.remove(IMG);
    await syncNow(sourceId);
    const removed = await row(IMG);
    expect(removed.publication).toBe('REMOVED');
    expect(removed.purge_after).not.toBeNull();

    drive.revoke(ROOT);
    expect(await syncNow(sourceId)).toBe('REVOKED');
    const [s] = await t.sql`SELECT status FROM wiki.drive_source WHERE id = ${sourceId}`;
    expect(s!.status).toBe('REVOKED');
    expect((await call('GET', '/v1/wiki/subjects/93.41/files', await reader(1))).json.groups).toEqual([]);
    expect((await call('GET', `/v1/wiki/files/${pdfId}`, await reader(1))).status).toBe(404);
  });

  test('crossSourceMoveKeepsTheRowWhicheverSourceSyncsFirst', async () => {
    const a = await publishedSource();
    drive.folder('root-alumno1-0002', 'Segunda carpeta', null, ALUMNO);
    const b = await register('root-alumno1-0002', await student());
    const [sb] = await t.sql`SELECT status FROM wiki.drive_source WHERE id = ${b}`;
    expect(sb!.status).toBe('ACTIVE');

    const pdfId = await fileId(PDF);
    expect((await call('PATCH', `/v1/me/drive/files/${pdfId}`, await student(), { subjectId: '93.42' })).status).toBe(200);
    const fetches = drive.fetchCount(PDF);

    drive.remove('shortcut-tp1-0001');
    drive.move(PDF, 'root-alumno1-0002');
    await syncNow(a);
    const byId = async (id: string) => (await t.sql`SELECT * FROM wiki.drive_file WHERE id = ${id}`)[0]!;
    expect((await byId(pdfId)).publication).toBe('REMOVED');
    await syncNow(b);
    const adopted = await byId(pdfId);
    expect(adopted.source_id).toBe(b);
    expect(adopted.subject_id).toBe('93.42');
    expect(adopted.publication).toBe('PUBLISHED');
    expect(adopted.parent_drive_id).toBeNull();

    drive.move(PDF, FIS);
    await syncNow(a);
    await syncNow(b);
    const back = await byId(pdfId);
    expect(back.source_id).toBe(a);
    expect(back.parent_drive_id).toBe(FIS);
    expect(back.subject_id).toBe('93.42');
    expect((await t.sql`SELECT id FROM wiki.drive_file WHERE drive_id = ${PDF}`).length).toBe(1);
    expect(drive.fetchCount(PDF)).toBe(fetches);
    for (const k of keysOf(back)) expect(storage.keys()).toContain(k);
  });

  test('registrationErrors', async () => {
    const post = async (url: string, consent: string) => call('POST', '/v1/me/drive/sources', await student(),
      { folderUrl: url, consentVersion: consent, anonymous: false });
    let r = await post('https://example.com/x', '2026-10');
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('DRIVE_INVALID_FOLDER_URL');
    r = await post('not-shared-folder-01', '2026-10');
    expect(r.status).toBe(422);
    expect(r.json.error).toBe('DRIVE_FOLDER_NOT_SHARED');
    drive.folder('someone-elses-0001', 'Ajena', null, 'otro@itba.edu.ar');
    r = await post('someone-elses-0001', '2026-10');
    expect(r.status).toBe(403);
    expect(r.json.error).toBe('DRIVE_FOLDER_NOT_OWNED');
    r = await post(DOC, '2026-10');
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('DRIVE_INVALID_FOLDER_URL');
    expect((await post(ROOT, '2020-01')).status).toBe(400);

    const sourceId = await register(ROOT, await student());
    r = await post(ROOT, '2026-10');
    expect(r.status).toBe(409);
    expect(r.json.error).toBe('DRIVE_SOURCE_EXISTS');
    r = await call('POST', `/v1/me/drive/sources/${sourceId}/sync`, await student());
    expect(r.status).toBe(429);
    expect(r.json.error).toBe('DRIVE_SYNC_RATE_LIMITED');
    expect(r.headers.get('retry-after')).not.toBeNull();
    expect((await call('GET', `/v1/me/drive/sources/${sourceId}/tree`, await reader(1))).status).toBe(404);

    drive.folder('unclaimed-folder-01', 'Sin registrar', null, 'otro@itba.edu.ar');
    await svc().sync.runAll();
    r = await call('GET', '/v1/staff/drive/unclaimed', await staff());
    expect(r.json.filter((u: { name: string }) => u.name === 'Sin registrar').map((u: { ownerEmail: string }) => u.ownerEmail)).toEqual(['otro@itba.edu.ar']);
    expect(r.json.filter((u: { name: string }) => u.name === 'Apuntes de Alumno')).toEqual([]);
    expect((await call('GET', '/v1/staff/drive/unclaimed', await student())).status).toBe(403);

    expect(storage.keys().length).toBeGreaterThan(0);
    expect((await call('DELETE', `/v1/me/drive/sources/${sourceId}`, await student())).status).toBe(204);
    expect((await t.sql`SELECT id FROM wiki.drive_file WHERE source_id = ${sourceId}`).length).toBe(0);
    expect(storage.keys()).toEqual([]);
    expect((await call('GET', '/v1/me/drive/sources', await student())).json).toEqual([]);
    await register(ROOT, await student());
  });

  test('threeReportsHideAFileUntilStaffRestoresIt', async () => {
    await publishedSource();
    const pdfId = await fileId(PDF);
    const report = { reason: 'COPYRIGHT', comment: 'es del libro' };
    expect((await call('PUT', `/v1/wiki/files/${pdfId}/report`, await reader(1), report)).status).toBe(204);
    expect((await call('PUT', `/v1/wiki/files/${pdfId}/report`, await reader(1), report)).status).toBe(204);
    expect((await call('PUT', `/v1/wiki/files/${pdfId}/report`, await reader(2), { reason: 'SPAM' })).status).toBe(204);
    expect((await call('GET', `/v1/wiki/files/${pdfId}`, await reader(1))).json.reportedByMe).toBe(true);
    expect((await row(PDF)).publication).toBe('PUBLISHED');
    expect((await call('PUT', `/v1/wiki/files/${pdfId}/report`, await reader(3), { reason: 'BOGUS' })).status).toBe(400);

    expect((await call('PUT', `/v1/wiki/files/${pdfId}/report`, await reader(3), { reason: 'OTHER' })).status).toBe(204);
    expect((await row(PDF)).publication).toBe('HIDDEN_REPORTED');
    expect((await call('GET', `/v1/wiki/files/${pdfId}`, await reader(4))).status).toBe(404);
    expect((await call('GET', '/v1/wiki/subjects/93.41/files', await reader(4))).json.groups[0].files).toHaveLength(1);

    let r = await call('GET', '/v1/staff/drive/files?publication=HIDDEN_REPORTED', await staff());
    expect(r.json.total).toBe(1);
    expect(r.json.items[0].reportCount).toBe(3);
    expect(r.json.items[0].reports).toHaveLength(3);
    r = await call('POST', `/v1/staff/drive/files/${pdfId}/restore`, await staff());
    expect(r.json.publication).toBe('PUBLISHED');
    expect(r.json.reportCount).toBe(0);
    expect((await call('POST', `/v1/staff/drive/files/${pdfId}/remove`, await staff())).json.publication).toBe('REMOVED_BY_STAFF');
    expect((await call('GET', `/v1/wiki/files/${pdfId}`, await reader(4))).status).toBe(404);
  });

  test('accountDeletionRemovesSourcesCopiesAndReports', async () => {
    await publishedSource();
    const pdfId = await fileId(PDF);
    for (let n = 1; n <= 3; n++) expect((await call('PUT', `/v1/wiki/files/${pdfId}/report`, await reader(n), { reason: 'SPAM' })).status).toBe(204);
    expect((await row(PDF)).publication).toBe('HIDDEN_REPORTED');

    expect((await call('DELETE', '/v1/me', await reader(1))).status).toBeLessThan(300);
    const after = await row(PDF);
    expect(after.report_count).toBe(2);
    expect(after.publication).toBe('PUBLISHED');

    expect(storage.keys().length).toBeGreaterThan(0);
    expect((await call('DELETE', '/v1/me', await student())).status).toBeLessThan(300);
    expect((await t.sql`SELECT id FROM wiki.drive_source`).length).toBe(0);
    expect((await t.sql`SELECT id FROM wiki.drive_file`).length).toBe(0);
    expect(storage.keys()).toEqual([]);
  });
});
