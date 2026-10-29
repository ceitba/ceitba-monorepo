// Ports apps/api/src/test/java/org/ceitba/api/web/kb/SubjectWikiIT.java (KbController
// + KbImportService/KbModerationService behind StaffKbController + Drive's takedown).
// The IT spans three agents' routes: the reader endpoints (kb-reader), the staff kb
// import/pages/hide/restore (StaffKbController, kb-admin) and the staff drive
// remove/block endpoints (drive). Each test is skipped on ts until every route it
// uses has a TS handler; on java they all run. The TS import/validation logic is
// also covered in process by test/kb-reader/import.test.ts.
// Deviation: the IT's @BeforeEach calls KbRelationService.refresh(); here the same
// three statements of KbRelationRepository.refreshFromPlans run as SQL.
import { beforeEach, describe, expect, test } from 'bun:test';
import { bearer, copyPlanSubjectsToEntries, mintJwt, supports, useServer, type As } from '../support';

const api = useServer();

const FIN = '61.12';
const CONT = '81.07';
const STAFF = 'staff@itba.edu.ar';
const SOURCE_TEXT = Array.from({ length: 120 }, (_, i) => `palabra${i}`).join(' ');

const IMPORT = `POST /v1/staff/kb/subjects/${FIN}/import`;
const READ = `GET /v1/wiki/subjects/${FIN}/kb`;
const PAGE = `GET /v1/wiki/subjects/${FIN}/kb/vtd`;
const anyId = '00000000-0000-4000-8000-000000000000';
const importRoutes = await supports(IMPORT, PAGE);
const flowRoutes = await supports(IMPORT, READ, PAGE, `GET /v1/wiki/subjects/${FIN}/kb/graph`, 'GET /v1/staff/kb/pages',
  `POST /v1/staff/kb/pages/${anyId}/restore`, `POST /v1/staff/drive/files/${anyId}/remove`, `POST /v1/staff/drive/sources/${anyId}/block`);
const reportRoutes = await supports(IMPORT, READ, 'GET /v1/staff/kb/pages', `PUT /v1/wiki/kb/pages/${anyId}/report`,
  `POST /v1/staff/kb/pages/${anyId}/restore`, `POST /v1/staff/kb/pages/${anyId}/hide`);

let f1 = '';
let f2 = '';
let fCont = '';
let fOther = '';

async function file(source: string, name: string, subject: string): Promise<string> {
  const id = crypto.randomUUID();
  await api.db`INSERT INTO wiki.drive_file (id, source_id, drive_id, name, mime_type, kind, owned_by_sharer,
      subject_id, effective_subject_id, publication, text_content, content_fingerprint)
    VALUES (${id}, ${source}, ${`d-${id}`}, ${name}, 'application/pdf', 'PDF', true, ${subject}, ${subject}, 'PUBLISHED', ${SOURCE_TEXT}, 'x')`;
  return id;
}

async function refreshRelations() {
  await api.db`DELETE FROM wiki.kb_subject_relation WHERE reason IN ('PREREQUISITE', 'DEPENDENT')`;
  await api.db`INSERT INTO wiki.kb_subject_relation (subject_id, related_id, reason, weight)
    SELECT ps.subject_id, d.dep, 'PREREQUISITE', count(DISTINCT ps.plan_id)
    FROM public.plan_entry_effective ps
    CROSS JOIN LATERAL unnest(ps.dependencies) AS d(dep)
    JOIN public.subject s1 ON s1.id = ps.subject_id
    JOIN public.subject s2 ON s2.id = d.dep
    WHERE d.dep <> ps.subject_id
    GROUP BY ps.subject_id, d.dep`;
  await api.db`INSERT INTO wiki.kb_subject_relation (subject_id, related_id, reason, weight)
    SELECT related_id, subject_id, 'DEPENDENT', weight FROM wiki.kb_subject_relation WHERE reason = 'PREREQUISITE'`;
}

const as = async (email: string): Promise<As> => bearer(await mintJwt({ email, name: email }));
const staff = () => as(STAFF);
const reader = (n: number) => as(`lector${n}@itba.edu.ar`);

function md(subject: string, type: string, title: string, sources: string[], body: string): string {
  return `---\ntitle: ${title}\nsubject: "${subject}"\ntype: ${type}\nsummary: Sobre ${title}.\naliases: []\nsources: [${sources.join(', ')}]\ngenerator: claude-opus-5.5/manual\ngenerated_at: 2026-10-02\n---\n${body}`;
}

async function importPages(subject: string, replace: boolean, pages: Record<string, string>): Promise<any> {
  const r = await api.post(`/v1/staff/kb/subjects/${subject}/import`, {
    as: await staff(),
    body: { replace, pages: Object.entries(pages).map(([path, content]) => ({ path, content })) },
  });
  expect(r.status).toBe(200);
  return r.json;
}

const finIndex = () => md(FIN, 'index', 'Matemática Financiera', [f1],
  `Bienvenida. Ver [[vtd]], [[81.07/balance|el balance]] y [[81.07]].\n\n## Temas\nInterés compuesto [[file:${f1}]].\n`);

const vtd = (extra: string) => md(FIN, 'concept', 'Valor tiempo del dinero', [f1, f2],
  `## Idea\nUn peso hoy vale más que mañana [[file:${f1}]].${extra}\n\n## Tasa\nVer [[index]] y [[file:${f2}|resumen]].\n`);

function link(page: any, raw: string): any {
  const l = (page.links as any[]).find((x) => x.raw === raw);
  if (!l) throw new Error(`no link ${raw} in ${JSON.stringify(page.links)}`);
  return l;
}

const sorted = (xs: string[]) => [...xs].sort();

describe('SubjectWikiIT', () => {
  beforeEach(async () => {
    await api.db`TRUNCATE wiki.kb_page, wiki.kb_subject_relation, wiki.drive_file, wiki.drive_source,
      public."user", public.plan_subject, public.plan_entry, public.subject, public.plan, public.careers CASCADE`;
    await api.db`INSERT INTO public.capability_settings (capability, enabled_for_all) VALUES ('apuntes', true)
      ON CONFLICT (capability) DO UPDATE SET enabled_for_all = true`;
    await api.db`INSERT INTO public.subject (id, name, credits, updated_at) VALUES
      ('61.12', 'Matemática Financiera', 3, now()), ('81.07', 'Contabilidad', 3, now()), ('93.26', 'Análisis Matemático I', 6, now())`;
    await api.db`INSERT INTO public.careers (id, name, updated_at) VALUES ('X', 'Carrera', now())`;
    await api.db`INSERT INTO public.plan (id, career_id, name, updated_at) VALUES ('P1', 'X', 'Plan', now())`;
    // 61.12 requires 81.07.
    await api.db`INSERT INTO public.plan_subject (subject_id, plan_id, section, year, semester, credits_required, dependencies)
      VALUES ('61.12', 'P1', 'Ciclo', 2, 1, 0, ARRAY['81.07']), ('81.07', 'P1', 'Ciclo', 1, 2, 0, ARRAY[]::varchar[])`;
    await copyPlanSubjectsToEntries(api.db);
    await refreshRelations();

    const owner = crypto.randomUUID();
    await api.db`INSERT INTO public."user" (id, email, name, created_at, updated_at) VALUES (${owner}, 'alumna@itba.edu.ar', 'Alumna', now(), now())`;
    const staffId = crypto.randomUUID();
    await api.db`INSERT INTO public."user" (id, email, name, created_at, updated_at) VALUES (${staffId}, ${STAFF}, 'Staff', now(), now())`;
    await api.db`INSERT INTO public.ceitba_staff (user_id, branch, role, start, "end")
      VALUES (${staffId}, 'IT', 'MEMBER', now() - interval '1 day', '9999-12-31')`;
    const source = crypto.randomUUID();
    await api.db`INSERT INTO wiki.drive_source (id, user_id, root_folder_id, root_name, status, consent_version, consented_at, approved_at)
      VALUES (${source}, ${owner}, 'root', 'Apuntes', 'ACTIVE', '2026-10', now(), now())`;
    f1 = await file(source, 'Guía VTD.pdf', FIN);
    f2 = await file(source, 'Resumen TIR.pdf', FIN);
    fCont = await file(source, 'Balance.pdf', CONT);
    fOther = await file(source, 'Otro.pdf', CONT);
  });

  test.skipIf(!flowRoutes)('importReadLinkTakedownAndReport', async () => {
    const copied = Array.from({ length: 47 }, (_, i) => `palabra${i + 3}`).join(' ');
    let res = await importPages(FIN, true, {
      'index.md': finIndex(),
      'vtd.md': vtd(''),
      'ajeno.md': md(FIN, 'concept', 'Ajeno', [fOther], `## A\n[[file:${fOther}]]\n`),
      'copia.md': md(FIN, 'concept', 'Copia', [f1], `## A\n${copied} [[file:${f1}]]\n`),
      'sin-cita.md': md(FIN, 'topic', 'Sin cita', [], '## A\nnada\n'),
    });
    expect(sorted(res.accepted)).toEqual(['index', 'vtd']);
    expect(res.rejected).toHaveLength(3);
    for (const r of res.rejected) {
      const errors = JSON.stringify(r.errors);
      switch (r.slug) {
        case 'ajeno': expect(errors).toContain('is not a file of subject 61.12'); break;
        case 'copia': expect(errors).toContain('copies 40+ consecutive words'); break;
        case 'sin-cita': expect(errors).toContain('has no [[file:'); break;
        default: throw new Error(JSON.stringify(r));
      }
    }
    // Unknown subject.
    expect((await api.post('/v1/staff/kb/subjects/99.99/import', { as: await staff(), body: '{"pages":[],"replace":false}' })).status).toBe(404);
    expect((await api.post(`/v1/staff/kb/subjects/${FIN}/import`, { as: await reader(1), body: '{"pages":[],"replace":false}' })).status).toBe(403);

    // Read: index + pages + related (prerequisite from the plan).
    let r = await api.get(`/v1/wiki/subjects/${FIN}/kb`, { as: await reader(1) });
    expect(r.status).toBe(200);
    let kb = r.json;
    expect(kb.subjectName).toBe('Matemática Financiera');
    expect(kb.index.slug).toBe('index');
    expect(kb.pages.map((p: any) => p.slug)).toEqual(['index', 'vtd']);
    expect(kb.pages[1].type).toBe('concept');
    expect(kb.related).toHaveLength(1);
    expect(kb.related[0].subjectId).toBe(CONT);
    expect(kb.related[0].reason).toBe('PREREQUISITE');
    expect(kb.related[0].hasWiki).toBe(false);

    let index = kb.index;
    expect(index.markdown.startsWith('Bienvenida')).toBe(true);
    expect(index.markdown).not.toContain('generator:');
    expect(index.links).toHaveLength(3);
    expect(link(index, 'vtd').resolved).toBe(true);
    expect(link(index, 'vtd').title).toBe('Valor tiempo del dinero');
    expect(link(index, '81.07/balance').resolved).toBe(false);
    expect(link(index, '81.07').slug).toBe('index');

    r = await api.get(`/v1/wiki/subjects/${FIN}/kb/vtd`, { as: await reader(1) });
    expect(r.status).toBe(200);
    let page = r.json;
    expect(page.revision).toBe(1);
    expect(page.sources).toHaveLength(2);
    expect(page.sources[0].name).toBe('Guía VTD.pdf');
    expect(page.sources[1].name).toBe('Resumen TIR.pdf');
    expect(page.sources[0].author.name).toBe('Alumna');
    expect(page.backlinks).toHaveLength(1);
    expect(page.backlinks[0].slug).toBe('index');
    expect((await api.get(`/v1/wiki/subjects/${FIN}/kb/ajeno`, { as: await reader(1) })).status).toBe(404);

    // The second subject arrives: the cross-subject links resolve.
    await importPages(CONT, false, {
      'index.md': md(CONT, 'index', 'Contabilidad', [fCont], `## Temas\n[[balance]] [[file:${fCont}]]\n`),
      'balance.md': md(CONT, 'concept', 'Balance', [fCont], `## Qué es\nVuelve a [[61.12/vtd]] [[file:${fCont}]]\n`),
    });
    index = (await api.get(`/v1/wiki/subjects/${FIN}/kb/index`, { as: await reader(1) })).json;
    expect(link(index, '81.07/balance').resolved).toBe(true);
    expect(link(index, '81.07/balance').title).toBe('Balance');
    expect(link(index, '81.07').resolved).toBe(true);
    page = (await api.get(`/v1/wiki/subjects/${FIN}/kb/vtd`, { as: await reader(1) })).json;
    expect(page.backlinks.map((b: any) => b.subjectId)).toContain(CONT);
    kb = (await api.get(`/v1/wiki/subjects/${FIN}/kb`, { as: await reader(1) })).json;
    expect(kb.related[0].hasWiki).toBe(true);
    // 81.07 sees 61.12 as a dependent.
    const cont = (await api.get(`/v1/wiki/subjects/${CONT}/kb`, { as: await reader(1) })).json;
    expect(cont.related[0].reason).toBe('DEPENDENT');

    r = await api.get(`/v1/wiki/subjects/${FIN}/kb/graph`, { as: await reader(1) });
    expect(r.status).toBe(200);
    const graph = r.json;
    expect(graph.nodes).toHaveLength(4);
    expect(graph.nodes.map((n: any) => String(n.external))).toEqual(['false', 'false', 'true', 'true']);
    expect(graph.edges.length).toBeGreaterThanOrEqual(4);

    // Re-import: changed page gets a new revision; unchanged keeps it;
    // replace drops pages missing from the payload.
    res = await importPages(FIN, true, { 'vtd.md': vtd(' Nuevo párrafo.') });
    expect(res.removed).toEqual(['index']);
    page = (await api.get(`/v1/wiki/subjects/${FIN}/kb/vtd`, { as: await reader(1) })).json;
    expect(page.revision).toBe(2);
    expect(Number((await api.db`SELECT count(*)::int AS n FROM wiki.kb_page_revision`)[0]!.n)).toBe(1);
    expect((await api.get(`/v1/wiki/subjects/${FIN}/kb/index`, { as: await reader(1) })).status).toBe(404);
    await importPages(FIN, false, { 'index.md': finIndex(), 'vtd.md': vtd(' Nuevo párrafo.') });
    page = (await api.get(`/v1/wiki/subjects/${FIN}/kb/vtd`, { as: await reader(1) })).json;
    expect(page.revision).toBe(2);
    expect((await api.get(`/v1/wiki/subjects/${FIN}/kb/index`, { as: await reader(1) })).status).toBe(200);

    // Takedown: staff remove a cited file -> pages citing it are hidden.
    expect((await api.post(`/v1/staff/drive/files/${f2}/remove`, { as: await staff() })).status).toBe(200);
    expect((await api.get(`/v1/wiki/subjects/${FIN}/kb/vtd`, { as: await reader(1) })).status).toBe(404);
    expect((await api.get(`/v1/wiki/subjects/${FIN}/kb/index`, { as: await reader(1) })).status).toBe(200);
    expect((await api.get(`/v1/wiki/subjects/${FIN}/kb/vtd`, { as: await staff() })).json.status).toBe('HIDDEN');
    r = await api.get('/v1/staff/kb/pages', { as: await staff(), query: { status: 'HIDDEN' } });
    expect(r.status).toBe(200);
    const hidden = r.json;
    expect(hidden.total).toBe(1);
    const vtdId = hidden.items[0].id;
    expect(hidden.items[0].subjectId).toBe(FIN);
    // A re-import (now without the removed file) keeps it hidden until staff restore it.
    const reimport = await importPages(FIN, false, {
      'vtd.md': md(FIN, 'concept', 'Valor tiempo del dinero', [f1], `## Idea\nUn peso hoy [[file:${f1}]].\n`),
    });
    expect(reimport.accepted).toEqual(['vtd']);
    expect((await api.get(`/v1/wiki/subjects/${FIN}/kb/vtd`, { as: await reader(1) })).status).toBe(404);
    expect((await api.post(`/v1/staff/kb/pages/${vtdId}/restore`, { as: await staff() })).json.status).toBe('PUBLISHED');
    expect((await api.get(`/v1/wiki/subjects/${FIN}/kb/vtd`, { as: await reader(1) })).status).toBe(200);

    // Blocking the source hides every page citing its files.
    const [src] = await api.db`SELECT source_id FROM wiki.drive_file WHERE id = ${fCont}`;
    expect((await api.post(`/v1/staff/drive/sources/${src!.source_id}/block`, { as: await staff() })).status).toBe(200);
    expect((await api.get(`/v1/wiki/subjects/${CONT}/kb/balance`, { as: await reader(1) })).status).toBe(404);
  });

  test.skipIf(!reportRoutes)('threeReportsHideAPage', async () => {
    await importPages(FIN, false, { 'index.md': finIndex() });
    const id = (await api.get(`/v1/wiki/subjects/${FIN}/kb`, { as: await reader(1) })).json.index.id;
    const body = '{"reason":"CONTENT_ERROR","comment":"la fórmula está mal"}';
    expect((await api.put(`/v1/wiki/kb/pages/${id}/report`, { as: await reader(1), body })).status).toBe(204);
    expect((await api.put(`/v1/wiki/kb/pages/${id}/report`, { as: await reader(1), body })).status).toBe(204);
    expect((await api.put(`/v1/wiki/kb/pages/${id}/report`, { as: await reader(2), body: '{"reason":"SPAM"}' })).status).toBe(204);
    expect((await api.put(`/v1/wiki/kb/pages/${id}/report`, { as: await reader(3), body: '{"reason":"NOPE"}' })).status).toBe(400);
    expect((await api.get(`/v1/wiki/subjects/${FIN}/kb/index`, { as: await reader(1) })).json.reportedByMe).toBe(true);
    expect((await api.get(`/v1/wiki/subjects/${FIN}/kb/index`, { as: await reader(3) })).json.reportedByMe).toBe(false);

    expect((await api.put(`/v1/wiki/kb/pages/${id}/report`, { as: await reader(3), body: '{"reason":"OTHER"}' })).status).toBe(204);
    expect((await api.get(`/v1/wiki/subjects/${FIN}/kb/index`, { as: await reader(4) })).status).toBe(404);
    const kb = (await api.get(`/v1/wiki/subjects/${FIN}/kb`, { as: await reader(4) })).json;
    expect(kb.index ?? undefined).toBeUndefined();
    expect(kb.pages).toEqual([]);
    expect((await api.get('/v1/staff/kb/pages', { as: await staff() })).json.items[0].reportCount).toBe(3);
    expect((await api.post(`/v1/staff/kb/pages/${id}/restore`, { as: await staff() })).json.status).toBe('PUBLISHED');
    expect((await api.post(`/v1/staff/kb/pages/${id}/hide`, { as: await staff() })).json.status).toBe('HIDDEN');
  });

  test.skipIf(!importRoutes)('sectionAnchorsAreValidatedAgainstExistingTargets', async () => {
    await importPages(FIN, false, { 'index.md': finIndex(), 'vtd.md': vtd('') });
    const res = await importPages(FIN, false, {
      'ok.md': md(FIN, 'concept', 'Ok', [f1], `## Uno\nVer [[vtd#Idea]], [[#Uno|acá]] y [[81.07/balance#cualquiera]] [[file:${f1}]]\n`),
      'mal.md': md(FIN, 'concept', 'Mal', [f1], `## Uno\nVer [[vtd#no-existe]] [[file:${f1}]]\n`),
    });
    expect(res.accepted).toEqual(['ok']);
    expect(res.rejected[0].errors[0]).toBe("link [[vtd#no-existe]]: no heading '#no-existe' in 61.12/vtd");
    const r = await api.get(`/v1/wiki/subjects/${FIN}/kb/ok`, { as: await reader(1) });
    expect(r.status).toBe(200);
    const ok = r.json;
    expect(link(ok, 'vtd#Idea').anchor).toBe('idea');
    expect(link(ok, 'vtd#Idea').slug).toBe('vtd');
    expect(link(ok, 'vtd#Idea').resolved).toBe(true);
    expect(link(ok, '#Uno').slug).toBe('ok');
    // The target subject has no pages yet: unresolved, not rejected.
    expect(link(ok, '81.07/balance#cualquiera').resolved).toBe(false);
    expect(link(ok, '81.07/balance#cualquiera').anchor).toBe('cualquiera');
    // A same-page anchor is not a backlink or a graph self-loop.
    expect(ok.backlinks).toEqual([]);
  });

  test.skipIf(!importRoutes)('sourceYearsAndStaleness', async () => {
    const now = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric' }).format(new Date()));
    await api.db`UPDATE wiki.drive_file SET academic_year = ${now - 10}, academic_year_source = 'NAME' WHERE id = ${f1}`;
    await api.db`UPDATE wiki.drive_file SET academic_year = ${now - 8}, academic_year_source = 'DRIVE' WHERE id = ${f2}`;
    await importPages(FIN, false, { 'index.md': finIndex(), 'vtd.md': vtd('') });
    let r = await api.get(`/v1/wiki/subjects/${FIN}/kb/vtd`, { as: await reader(1) });
    expect(r.status).toBe(200);
    let v = r.json;
    expect(v.sources[0].academicYear).toBe(now - 10);
    expect(v.sources[0].academicYearSource).toBe('NAME');
    expect(v.sourceYears.min).toBe(now - 10);
    expect(v.sourceYears.max).toBe(now - 8);
    expect(v.stale).toBe(true);

    await api.db`UPDATE wiki.drive_file SET academic_year = ${now - 3} WHERE id = ${f2}`;
    r = await api.get(`/v1/wiki/subjects/${FIN}/kb/vtd`, { as: await reader(1) });
    v = r.json;
    expect(v.stale).toBe(false);
  });
});
