// In-process run of apps/api/src/test/java/org/ceitba/api/web/kb/SubjectWikiIT.java on
// TS while StaffKbController (kb-admin) and the staff drive routes are not ported: the
// staff calls go straight to the services this feature owns (KbImportService,
// KbModerationService.hide/restore/list/hidePagesCiting); the reader calls go through
// HTTP. The black-box port is contract/tests/kb-reader-subject-wiki.contract.test.ts
// (runs on java now, on ts once those routes exist). Takedown: the IT goes through
// POST /v1/staff/drive/files/{id}/remove and /sources/{id}/block, whose DriveRecalculator
// calls hidePagesCiting; here hidePagesCiting is called with the same files.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { copyPlanSubjectsToEntries, mintJwt } from '../../contract/support/identity';
import { kbReader } from '../../src/features/kb-reader/services';
import { testApp, type TestApp } from '../support/app';

let t: TestApp;
beforeAll(async () => { t = await testApp(); }, 60_000);
afterAll(() => t?.close());

const FIN = '61.12';
const CONT = '81.07';
const STAFF = 'staff@itba.edu.ar';
const SOURCE_TEXT = Array.from({ length: 120 }, (_, i) => `palabra${i}`).join(' ');
let f1 = '';
let f2 = '';
let fCont = '';
let fOther = '';
let staffId = '';

const kb = () => kbReader(t.deps);
const hdr = async (email: string) => ({ Authorization: `Bearer ${await mintJwt({ email, name: email })}` });
const reader = (n: number) => hdr(`lector${n}@itba.edu.ar`);
const get = async (path: string, who: Record<string, string>) => t.request('GET', path, { headers: who });

async function file(source: string, name: string, subject: string): Promise<string> {
  const id = crypto.randomUUID();
  await t.sql`INSERT INTO wiki.drive_file (id, source_id, drive_id, name, mime_type, kind, owned_by_sharer,
      subject_id, effective_subject_id, publication, text_content, content_fingerprint)
    VALUES (${id}, ${source}, ${`d-${id}`}, ${name}, 'application/pdf', 'PDF', true, ${subject}, ${subject}, 'PUBLISHED', ${SOURCE_TEXT}, 'x')`;
  return id;
}

function md(subject: string, type: string, title: string, sources: string[], body: string): string {
  return `---\ntitle: ${title}\nsubject: "${subject}"\ntype: ${type}\nsummary: Sobre ${title}.\naliases: []\nsources: [${sources.join(', ')}]\ngenerator: claude-opus-5.5/manual\ngenerated_at: 2026-10-02\n---\n${body}`;
}

const importPages = (subject: string, replace: boolean, pages: Record<string, string>) =>
  kb().importer.importSubject(subject, { replace, pages: Object.entries(pages).map(([path, content]) => ({ path, content })) });

const finIndex = () => md(FIN, 'index', 'Matemática Financiera', [f1],
  `Bienvenida. Ver [[vtd]], [[81.07/balance|el balance]] y [[81.07]].\n\n## Temas\nInterés compuesto [[file:${f1}]].\n`);
const vtd = (extra: string) => md(FIN, 'concept', 'Valor tiempo del dinero', [f1, f2],
  `## Idea\nUn peso hoy vale más que mañana [[file:${f1}]].${extra}\n\n## Tasa\nVer [[index]] y [[file:${f2}|resumen]].\n`);

function link(page: any, raw: string): any {
  const l = (page.links as any[]).find((x) => x.raw === raw);
  if (!l) throw new Error(`no link ${raw}`);
  return l;
}

describe('SubjectWikiIT (in process, staff side through the services)', () => {
  beforeEach(async () => {
    await t.sql`TRUNCATE wiki.kb_page, wiki.kb_subject_relation, wiki.drive_file, wiki.drive_source,
      public."user", public.plan_subject, public.plan_entry, public.subject, public.plan, public.careers CASCADE`;
    await t.sql`INSERT INTO public.capability_settings (capability, enabled_for_all) VALUES ('apuntes', true)
      ON CONFLICT (capability) DO UPDATE SET enabled_for_all = true`;
    await t.sql`INSERT INTO public.subject (id, name, credits, updated_at) VALUES
      ('61.12', 'Matemática Financiera', 3, now()), ('81.07', 'Contabilidad', 3, now()), ('93.26', 'Análisis Matemático I', 6, now())`;
    await t.sql`INSERT INTO public.careers (id, name, updated_at) VALUES ('X', 'Carrera', now())`;
    await t.sql`INSERT INTO public.plan (id, career_id, name, updated_at) VALUES ('P1', 'X', 'Plan', now())`;
    await t.sql`INSERT INTO public.plan_subject (subject_id, plan_id, section, year, semester, credits_required, dependencies)
      VALUES ('61.12', 'P1', 'Ciclo', 2, 1, 0, ARRAY['81.07']), ('81.07', 'P1', 'Ciclo', 1, 2, 0, ARRAY[]::varchar[])`;
    await copyPlanSubjectsToEntries(t.sql);
    expect(await kb().relations.refresh()).toBe(1);

    const owner = crypto.randomUUID();
    await t.sql`INSERT INTO public."user" (id, email, name, created_at, updated_at) VALUES (${owner}, 'alumna@itba.edu.ar', 'Alumna', now(), now())`;
    staffId = crypto.randomUUID();
    await t.sql`INSERT INTO public."user" (id, email, name, created_at, updated_at) VALUES (${staffId}, ${STAFF}, 'Staff', now(), now())`;
    await t.sql`INSERT INTO public.ceitba_staff (user_id, branch, role, start, "end") VALUES (${staffId}, 'IT', 'MEMBER', now() - interval '1 day', '9999-12-31')`;
    const source = crypto.randomUUID();
    await t.sql`INSERT INTO wiki.drive_source (id, user_id, root_folder_id, root_name, status, consent_version, consented_at, approved_at)
      VALUES (${source}, ${owner}, 'root', 'Apuntes', 'ACTIVE', '2026-10', now(), now())`;
    f1 = await file(source, 'Guía VTD.pdf', FIN);
    f2 = await file(source, 'Resumen TIR.pdf', FIN);
    fCont = await file(source, 'Balance.pdf', CONT);
    fOther = await file(source, 'Otro.pdf', CONT);
  });

  test('importReadLinkTakedownAndReport', async () => {
    const copied = Array.from({ length: 47 }, (_, i) => `palabra${i + 3}`).join(' ');
    let res = await importPages(FIN, true, {
      'index.md': finIndex(),
      'vtd.md': vtd(''),
      'ajeno.md': md(FIN, 'concept', 'Ajeno', [fOther], `## A\n[[file:${fOther}]]\n`),
      'copia.md': md(FIN, 'concept', 'Copia', [f1], `## A\n${copied} [[file:${f1}]]\n`),
      'sin-cita.md': md(FIN, 'topic', 'Sin cita', [], '## A\nnada\n'),
    });
    expect([...res.accepted].sort()).toEqual(['index', 'vtd']);
    expect(res.rejected).toHaveLength(3);
    for (const r of res.rejected) {
      const errors = JSON.stringify(r.errors);
      if (r.slug === 'ajeno') expect(errors).toContain('is not a file of subject 61.12');
      else if (r.slug === 'copia') expect(errors).toContain('copies 40+ consecutive words');
      else if (r.slug === 'sin-cita') expect(errors).toContain('has no [[file:');
      else throw new Error(JSON.stringify(r));
    }
    // Unknown subject.
    await expect(importPages('99.99', false, {})).rejects.toMatchObject({ status: 404 });

    let kbr = (await get(`/v1/wiki/subjects/${FIN}/kb`, await reader(1))).json;
    expect(kbr.subjectName).toBe('Matemática Financiera');
    expect(kbr.index.slug).toBe('index');
    expect(kbr.pages.map((p: any) => p.slug)).toEqual(['index', 'vtd']);
    expect(kbr.pages[1].type).toBe('concept');
    expect(kbr.related).toEqual([{ subjectId: CONT, subjectName: 'Contabilidad', reason: 'PREREQUISITE', hasWiki: false }]);
    let index = kbr.index;
    expect(index.markdown.startsWith('Bienvenida')).toBe(true);
    expect(index.markdown).not.toContain('generator:');
    expect(index.generatedAt).toBe('2026-10-02T00:00:00Z');
    expect(index.links).toHaveLength(3);
    expect(link(index, 'vtd').resolved).toBe(true);
    expect(link(index, 'vtd').title).toBe('Valor tiempo del dinero');
    expect(link(index, '81.07/balance').resolved).toBe(false);
    expect(link(index, '81.07').slug).toBe('index');

    let page = (await get(`/v1/wiki/subjects/${FIN}/kb/vtd`, await reader(1))).json;
    expect(page.revision).toBe(1);
    expect(page.sources.map((s: any) => s.name)).toEqual(['Guía VTD.pdf', 'Resumen TIR.pdf']);
    expect(page.sources[0].author.name).toBe('Alumna');
    expect(page.backlinks.map((b: any) => b.slug)).toEqual(['index']);
    expect((await get(`/v1/wiki/subjects/${FIN}/kb/ajeno`, await reader(1))).status).toBe(404);

    await importPages(CONT, false, {
      'index.md': md(CONT, 'index', 'Contabilidad', [fCont], `## Temas\n[[balance]] [[file:${fCont}]]\n`),
      'balance.md': md(CONT, 'concept', 'Balance', [fCont], `## Qué es\nVuelve a [[61.12/vtd]] [[file:${fCont}]]\n`),
    });
    index = (await get(`/v1/wiki/subjects/${FIN}/kb/index`, await reader(1))).json;
    expect(link(index, '81.07/balance').resolved).toBe(true);
    expect(link(index, '81.07/balance').title).toBe('Balance');
    expect(link(index, '81.07').resolved).toBe(true);
    page = (await get(`/v1/wiki/subjects/${FIN}/kb/vtd`, await reader(1))).json;
    expect(page.backlinks.map((b: any) => b.subjectId)).toContain(CONT);
    kbr = (await get(`/v1/wiki/subjects/${FIN}/kb`, await reader(1))).json;
    expect(kbr.related[0].hasWiki).toBe(true);
    expect((await get(`/v1/wiki/subjects/${CONT}/kb`, await reader(1))).json.related[0].reason).toBe('DEPENDENT');

    const graph = (await get(`/v1/wiki/subjects/${FIN}/kb/graph`, await reader(1))).json;
    expect(graph.nodes).toHaveLength(4);
    expect(graph.nodes.map((n: any) => n.external)).toEqual([false, false, true, true]);
    expect(graph.edges.length).toBeGreaterThanOrEqual(4);

    res = await importPages(FIN, true, { 'vtd.md': vtd(' Nuevo párrafo.') });
    expect(res.removed).toEqual(['index']);
    page = (await get(`/v1/wiki/subjects/${FIN}/kb/vtd`, await reader(1))).json;
    expect(page.revision).toBe(2);
    expect(Number((await t.sql`SELECT count(*)::int AS n FROM wiki.kb_page_revision`)[0]!.n)).toBe(1);
    expect((await get(`/v1/wiki/subjects/${FIN}/kb/index`, await reader(1))).status).toBe(404);
    await importPages(FIN, false, { 'index.md': finIndex(), 'vtd.md': vtd(' Nuevo párrafo.') });
    page = (await get(`/v1/wiki/subjects/${FIN}/kb/vtd`, await reader(1))).json;
    expect(page.revision).toBe(2);
    expect((await get(`/v1/wiki/subjects/${FIN}/kb/index`, await reader(1))).status).toBe(200);

    // Takedown of f2 (DriveRecalculator -> hidePagesCiting).
    expect(await kb().moderation.hidePagesCiting([f2])).toBe(1);
    expect((await get(`/v1/wiki/subjects/${FIN}/kb/vtd`, await reader(1))).status).toBe(404);
    expect((await get(`/v1/wiki/subjects/${FIN}/kb/index`, await reader(1))).status).toBe(200);
    expect((await get(`/v1/wiki/subjects/${FIN}/kb/vtd`, await hdr(STAFF))).json.status).toBe('HIDDEN');
    const hidden = await kb().moderation.list('HIDDEN', 0, 20);
    expect(hidden.total).toBe(1);
    expect(hidden.items[0]!.subjectId).toBe(FIN);
    expect(hidden.items[0]!.hiddenReason).toBe('TAKEDOWN');
    const vtdId = hidden.items[0]!.id;
    const reimport = await importPages(FIN, false, {
      'vtd.md': md(FIN, 'concept', 'Valor tiempo del dinero', [f1], `## Idea\nUn peso hoy [[file:${f1}]].\n`),
    });
    expect(reimport.accepted).toEqual(['vtd']);
    expect((await get(`/v1/wiki/subjects/${FIN}/kb/vtd`, await reader(1))).status).toBe(404);
    expect((await kb().moderation.restore(staffId, vtdId)).status).toBe('PUBLISHED');
    expect((await get(`/v1/wiki/subjects/${FIN}/kb/vtd`, await reader(1))).status).toBe(200);

    // Blocking the source: every file of it leaves PUBLISHED.
    await kb().moderation.hidePagesCiting([f1, f2, fCont, fOther]);
    expect((await get(`/v1/wiki/subjects/${CONT}/kb/balance`, await reader(1))).status).toBe(404);
  });

  test('threeReportsHideAPage', async () => {
    await importPages(FIN, false, { 'index.md': finIndex() });
    const id = (await get(`/v1/wiki/subjects/${FIN}/kb`, await reader(1))).json.index.id;
    const put = async (n: number, body: string) => (await t.request('PUT', `/v1/wiki/kb/pages/${id}/report`, { headers: await reader(n), body })).status;
    const body = '{"reason":"CONTENT_ERROR","comment":"la fórmula está mal"}';
    expect(await put(1, body)).toBe(204);
    expect(await put(1, body)).toBe(204);
    expect(await put(2, '{"reason":"SPAM"}')).toBe(204);
    expect(await put(3, '{"reason":"NOPE"}')).toBe(400);
    expect((await get(`/v1/wiki/subjects/${FIN}/kb/index`, await reader(1))).json.reportedByMe).toBe(true);
    expect((await get(`/v1/wiki/subjects/${FIN}/kb/index`, await reader(3))).json.reportedByMe).toBe(false);
    expect(await put(3, '{"reason":"OTHER"}')).toBe(204);
    expect((await get(`/v1/wiki/subjects/${FIN}/kb/index`, await reader(4))).status).toBe(404);
    const kbr = (await get(`/v1/wiki/subjects/${FIN}/kb`, await reader(4))).json;
    expect(kbr.index).toBeNull();
    expect(kbr.pages).toEqual([]);
    expect((await kb().moderation.list(null, 0, 20)).items[0]!.reportCount).toBe(3);
    expect((await kb().moderation.restore(staffId, id)).status).toBe('PUBLISHED');
    expect(Number((await t.sql`SELECT count(*)::int AS n FROM wiki.kb_page_report WHERE page_id = ${id}`)[0]!.n)).toBe(0);
    expect((await kb().moderation.hide(staffId, id)).status).toBe('HIDDEN');
    await expect(kb().moderation.list('nope', 0, 20)).rejects.toMatchObject({ status: 400 });
  });

  test('sectionAnchorsAreValidatedAgainstExistingTargets', async () => {
    await importPages(FIN, false, { 'index.md': finIndex(), 'vtd.md': vtd('') });
    const res = await importPages(FIN, false, {
      'ok.md': md(FIN, 'concept', 'Ok', [f1], `## Uno\nVer [[vtd#Idea]], [[#Uno|acá]] y [[81.07/balance#cualquiera]] [[file:${f1}]]\n`),
      'mal.md': md(FIN, 'concept', 'Mal', [f1], `## Uno\nVer [[vtd#no-existe]] [[file:${f1}]]\n`),
    });
    expect(res.accepted).toEqual(['ok']);
    expect(res.rejected[0]!.errors[0]).toBe("link [[vtd#no-existe]]: no heading '#no-existe' in 61.12/vtd");
    const ok = (await get(`/v1/wiki/subjects/${FIN}/kb/ok`, await reader(1))).json;
    expect(link(ok, 'vtd#Idea').anchor).toBe('idea');
    expect(link(ok, 'vtd#Idea').slug).toBe('vtd');
    expect(link(ok, 'vtd#Idea').resolved).toBe(true);
    expect(link(ok, '#Uno').slug).toBe('ok');
    expect(link(ok, '81.07/balance#cualquiera').resolved).toBe(false);
    expect(link(ok, '81.07/balance#cualquiera').anchor).toBe('cualquiera');
    expect(ok.backlinks).toEqual([]);
  });

  test('sourceYearsAndStaleness', async () => {
    const now = Number(t.deps.clock.today().slice(0, 4));
    await t.sql`UPDATE wiki.drive_file SET academic_year = ${now - 10}, academic_year_source = 'NAME' WHERE id = ${f1}`;
    await t.sql`UPDATE wiki.drive_file SET academic_year = ${now - 8}, academic_year_source = 'DRIVE' WHERE id = ${f2}`;
    await importPages(FIN, false, { 'index.md': finIndex(), 'vtd.md': vtd('') });
    let v = (await get(`/v1/wiki/subjects/${FIN}/kb/vtd`, await reader(1))).json;
    expect(v.sources[0].academicYear).toBe(now - 10);
    expect(v.sources[0].academicYearSource).toBe('NAME');
    expect(v.sourceYears).toEqual({ min: now - 10, max: now - 8 });
    expect(v.stale).toBe(true);
    await t.sql`UPDATE wiki.drive_file SET academic_year = ${now - 3} WHERE id = ${f2}`;
    v = (await get(`/v1/wiki/subjects/${FIN}/kb/vtd`, await reader(1))).json;
    expect(v.stale).toBe(false);
  });

  test('unchangedReimportKeepsRevisionAndUpdatedAt', async () => {
    await importPages(FIN, false, { 'index.md': finIndex() });
    const [before] = await t.sql`SELECT revision, updated_at::text AS u FROM wiki.kb_page WHERE slug = 'index'`;
    await Bun.sleep(5);
    await importPages(FIN, false, { 'index.md': finIndex() });
    const [after] = await t.sql`SELECT revision, updated_at::text AS u FROM wiki.kb_page WHERE slug = 'index'`;
    expect(after).toEqual(before!);
    const v = await kb().importer.validate(FIN, [{ path: 'index.md', content: finIndex() }, { path: 'index.md', content: finIndex() }]);
    expect([...v.accepted.keys()]).toEqual(['index']);
    expect(v.rejected[0]!.errors[0]).toBe('duplicate slug in this import');
  });

  test('forgetFilesHidesCitingPagesAndDropsDigests', async () => {
    await importPages(FIN, false, { 'index.md': finIndex() });
    await t.sql`INSERT INTO wiki.kb_file_digest (file_id, content_fingerprint, prompt_version, model, digest) VALUES (${f1}, 'x', 'v1', 'm', '{}')`;
    await kb().moderation.forgetFiles([f1]);
    expect(Number((await t.sql`SELECT count(*)::int AS n FROM wiki.kb_file_digest`)[0]!.n)).toBe(0);
    expect((await t.sql`SELECT status, hidden_reason FROM wiki.kb_page WHERE slug = 'index'`)[0]).toEqual({ status: 'HIDDEN', hidden_reason: 'TAKEDOWN' });
  });
});
