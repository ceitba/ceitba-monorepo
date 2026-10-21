// Contract checks of web/kb/KbController (KbReaderService, KbViews, KbSearchService)
// over rows seeded with SQL, so every operation is exercised on both servers without
// the staff import (StaffKbController) that SubjectWikiIT goes through. Not a port of
// one Java IT: it pins the JSON bytes and the edge cases SubjectWikiIT/KbEmbeddingIT
// leave implicit (related reasons/order, link resolution of hidden and missing pages,
// author kinds, private sources, HIDDEN visibility for staff vs a scoped API key,
// 404 messages, binding before the capability check, report rules, search clamps).
import { beforeEach, describe, expect, test } from 'bun:test';
import { apiKey, bearer, mintJwt, seedApiKey, useServer, type As } from '../support';

const api = useServer();

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const P = { index: u(1), vtd: u(2), tir: u(3), oculta: u(4), balance: u(5), viejo: u(6), limites: u(7) };
const F = { f1: u(11), privado: u(12), comunidad: u(13), anonimo: u(14), missing: u(15) };
const S = { student: u(21), community: u(22), anonymous: u(23) };
const OWNER = u(31);
const STAFF = 'staff@itba.edu.ar';

const reader = async (n = 1): Promise<As> => bearer(await mintJwt({ email: `lector${n}@itba.edu.ar`, name: `Lector ${n}` }));
const staff = async (): Promise<As> => bearer(await mintJwt({ email: STAFF, name: 'Staff' }));

async function page(id: string, subject: string, slug: string, type: string, title: string, sources: string[], markdown: string, status = 'PUBLISHED', hidden: string | null = null) {
  await api.db`INSERT INTO wiki.kb_page (id, subject_id, slug, type, title, summary, aliases, markdown, sources, revision, generator,
      generated_at, status, hidden_reason, report_count)
    VALUES (${id}, ${subject}, ${slug}, ${type}, ${title}, ${`Sobre ${title}.`}, ${['alias uno']}, ${markdown}, ${sources}::uuid[], 1, 'claude-opus-5.5/manual',
      '2026-10-02T00:00:00Z', ${status}, ${hidden}, 0)`;
}

async function link(from: string, raw: string, subject: string, slug: string, to: string | null) {
  await api.db`INSERT INTO wiki.kb_link (id, from_page_id, raw, to_subject_id, to_slug, to_page_id)
    VALUES (${crypto.randomUUID()}, ${from}, ${raw}, ${subject}, ${slug}, ${to})`;
}

async function file(id: string, source: string, name: string, subject: string, publication: string, year: number | null) {
  await api.db`INSERT INTO wiki.drive_file (id, source_id, drive_id, name, mime_type, kind, owned_by_sharer, subject_id,
      effective_subject_id, publication, text_content, content_fingerprint, academic_year, academic_year_source)
    VALUES (${id}, ${source}, ${`d-${id}`}, ${name}, 'application/pdf', 'PDF', true, ${subject}, ${subject}, ${publication}, 'texto', 'x',
      ${year}, ${year == null ? null : 'NAME'})`;
}

describe('KbControllerContract', () => {
  beforeEach(async () => {
    await api.db`TRUNCATE wiki.kb_page, wiki.kb_subject_relation, wiki.drive_file, wiki.drive_source,
      public."user", public.plan_subject, public.subject, public.plan, public.careers CASCADE`;
    await api.db`INSERT INTO public.capability_settings (capability, enabled_for_all) VALUES ('apuntes', true)
      ON CONFLICT (capability) DO UPDATE SET enabled_for_all = true`;
    await api.db`INSERT INTO public.subject (id, name, credits, updated_at) VALUES
      ('61.12', 'Matemática Financiera', 3, now()), ('81.07', 'Contabilidad', 3, now()), ('93.26', 'Análisis Matemático I', 6, now()),
      ('72.01', 'Sin wiki', 3, now())`;
    await api.db`INSERT INTO wiki.kb_subject_relation (subject_id, related_id, reason, weight) VALUES
      ('61.12', '81.07', 'PREREQUISITE', 2), ('81.07', '61.12', 'DEPENDENT', 2), ('61.12', '72.01', 'DEPENDENT', 1),
      ('72.01', '61.12', 'PREREQUISITE', 1)`;

    await api.db`INSERT INTO public."user" (id, email, name, created_at, updated_at) VALUES (${OWNER}, 'alumna@itba.edu.ar', 'Alumna', now(), now())`;
    const staffId = crypto.randomUUID();
    await api.db`INSERT INTO public."user" (id, email, name, created_at, updated_at) VALUES (${staffId}, ${STAFF}, 'Staff', now(), now())`;
    await api.db`INSERT INTO public.ceitba_staff (user_id, branch, role, start, "end") VALUES (${staffId}, 'IT', 'MEMBER', now() - interval '1 day', '9999-12-31')`;
    await api.db`INSERT INTO wiki.drive_source (id, user_id, root_folder_id, root_name, status, consent_version, consented_at, approved_at, kind, anonymous)
      VALUES (${S.student}, ${OWNER}, 'root', 'Apuntes', 'ACTIVE', '2026-10', now(), now(), 'STUDENT', false),
             (${S.anonymous}, ${OWNER}, 'root2', 'Anon', 'ACTIVE', '2026-10', now(), now(), 'STUDENT', true),
             (${S.community}, NULL, 'root3', 'Archivo', 'ACTIVE', '2026-10', now(), now(), 'COMMUNITY_ROOT', false)`;
    await file(F.f1, S.student, 'Guía VTD.pdf', '61.12', 'PUBLISHED', 2019);
    await file(F.privado, S.student, 'Privado.pdf', '61.12', 'PRIVATE', 2026);
    await file(F.comunidad, S.community, 'Comunidad.pdf', '61.12', 'PUBLISHED', null);
    await file(F.anonimo, S.anonymous, 'Anónimo.pdf', '61.12', 'PUBLISHED', 2021);

    await page(P.index, '61.12', 'index', 'INDEX', 'Matemática Financiera', [F.f1], 'Bienvenida.\n\n## Temas\nVer [[vtd]].\n');
    await page(P.vtd, '61.12', 'vtd', 'CONCEPT', 'Valor tiempo del dinero', [F.anonimo, F.privado, F.f1, F.missing, F.comunidad], '## Idea\nUn peso.\n');
    await page(P.tir, '61.12', 'tir', 'CONCEPT', 'tasa interna', [], '## Tasa\nTIR.\n');
    await page(P.oculta, '61.12', 'oculta', 'TOPIC', 'Oculta', [], '## X\nY.\n', 'HIDDEN', 'STAFF');
    await page(P.balance, '81.07', 'balance', 'CONCEPT', 'Balance', [], '## Qué es\nVer [[61.12/vtd]].\n');
    await page(P.viejo, '81.07', 'viejo', 'CONCEPT', 'Viejo', [], '## V\nW.\n', 'REMOVED');
    await page(P.limites, '93.26', 'limites', 'CONCEPT', 'Límites', [], '## L\n[[61.12]]\n');

    await link(P.index, 'vtd', '61.12', 'vtd', P.vtd);
    await link(P.index, 'vtd#Idea', '61.12', 'vtd', P.vtd);
    await link(P.index, 'oculta', '61.12', 'oculta', P.oculta);
    await link(P.index, '81.07/balance', '81.07', 'balance', P.balance);
    await link(P.index, '81.07', '81.07', 'index', null);
    await link(P.index, 'Zeta', '61.12', 'zeta', null);
    await link(P.vtd, 'index', '61.12', 'index', P.index);
    await link(P.vtd, '#Idea', '61.12', 'vtd', P.vtd);
    await link(P.oculta, 'vtd', '61.12', 'vtd', P.vtd);
    await link(P.balance, '61.12/vtd', '61.12', 'vtd', P.vtd);
    await link(P.viejo, '61.12/tir', '61.12', 'tir', P.tir);
    await link(P.limites, '61.12', '61.12', 'index', P.index);
  });

  test('subjectListsVisiblePagesInOrderWithRelated', async () => {
    const r = await api.get('/v1/wiki/subjects/61.12/kb', { as: await reader() });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/json');
    expect(r.json.pages.map((p: any) => p.slug)).toEqual(['index', 'tir', 'vtd']);
    expect(JSON.stringify(r.json.pages[1])).toBe(`{"id":"${P.tir}","slug":"tir","title":"tasa interna","type":"concept","summary":"Sobre tasa interna.","aliases":["alias uno"]}`);
    expect(JSON.stringify(r.json.related)).toBe('[{"subjectId":"81.07","subjectName":"Contabilidad","reason":"PREREQUISITE","hasWiki":true},'
      + '{"subjectId":"72.01","subjectName":"Sin wiki","reason":"DEPENDENT","hasWiki":false},'
      + '{"subjectId":"93.26","subjectName":"Análisis Matemático I","reason":"LINKED","hasWiki":true}]');
    expect(r.json.index.id).toBe(P.index);

    const staffView = await api.get('/v1/wiki/subjects/61.12/kb', { as: await staff() });
    expect(staffView.json.pages.map((p: any) => p.slug)).toEqual(['index', 'oculta', 'tir', 'vtd']);

    const empty = await api.get('/v1/wiki/subjects/72.01/kb', { as: await reader() });
    expect(empty.text).toBe('{"subjectId":"72.01","subjectName":"Sin wiki","index":null,"pages":[],'
      + '"related":[{"subjectId":"61.12","subjectName":"Matemática Financiera","reason":"PREREQUISITE","hasWiki":true}]}');
  });

  test('pageResolvesLinksBacklinksAndSources', async () => {
    const r = await api.get('/v1/wiki/subjects/61.12/kb/index', { as: await reader() });
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.json.links)).toBe('['
      + '{"raw":"81.07","subjectId":"81.07","slug":"index","anchor":null,"resolved":false,"title":null},'
      + '{"raw":"81.07/balance","subjectId":"81.07","slug":"balance","anchor":null,"resolved":true,"title":"Balance"},'
      + '{"raw":"Zeta","subjectId":"61.12","slug":"zeta","anchor":null,"resolved":false,"title":null},'
      + '{"raw":"oculta","subjectId":"61.12","slug":"oculta","anchor":null,"resolved":false,"title":null},'
      + '{"raw":"vtd","subjectId":"61.12","slug":"vtd","anchor":null,"resolved":true,"title":"Valor tiempo del dinero"},'
      + '{"raw":"vtd#Idea","subjectId":"61.12","slug":"vtd","anchor":"idea","resolved":true,"title":"Valor tiempo del dinero"}]');
    expect(JSON.stringify(r.json.backlinks)).toBe('[{"subjectId":"93.26","subjectName":"Análisis Matemático I","slug":"limites","title":"Límites"},'
      + '{"subjectId":"61.12","subjectName":"Matemática Financiera","slug":"vtd","title":"Valor tiempo del dinero"}]');

    const v = await api.get('/v1/wiki/subjects/61.12/kb/vtd', { as: await reader() });
    expect(v.status).toBe(200);
    expect(v.text).toBe(`{"id":"${P.vtd}","slug":"vtd","title":"Valor tiempo del dinero","type":"concept","summary":"Sobre Valor tiempo del dinero.",`
      + `"aliases":["alias uno"],"subjectId":"61.12","subjectName":"Matemática Financiera","markdown":"## Idea\\nUn peso.\\n","sources":[`
      + `{"id":"${F.anonimo}","name":"Anónimo.pdf","kind":"PDF","author":{"name":null,"anonymous":true,"community":false},"academicYear":2021,"academicYearSource":"NAME"},`
      + `{"id":"${F.f1}","name":"Guía VTD.pdf","kind":"PDF","author":{"name":"Alumna","anonymous":false,"community":false},"academicYear":2019,"academicYearSource":"NAME"},`
      + `{"id":"${F.comunidad}","name":"Comunidad.pdf","kind":"PDF","author":{"name":"Comunidad","anonymous":false,"community":true},"academicYear":null,"academicYearSource":null}],`
      + `"sourceYears":{"min":2019,"max":2021},"stale":true,"links":[{"raw":"#Idea","subjectId":"61.12","slug":"vtd","anchor":"idea","resolved":true,"title":"Valor tiempo del dinero"},`
      + `{"raw":"index","subjectId":"61.12","slug":"index","anchor":null,"resolved":true,"title":"Matemática Financiera"}],`
      + `"backlinks":[{"subjectId":"61.12","subjectName":"Matemática Financiera","slug":"index","title":"Matemática Financiera"},`
      + `{"subjectId":"81.07","subjectName":"Contabilidad","slug":"balance","title":"Balance"}],`
      + `"generator":"claude-opus-5.5/manual","generatedAt":"2026-10-02T00:00:00Z","revision":1,"reportedByMe":false,"status":"PUBLISHED"}`);

    // Staff also get private sources and see the hidden page and its link.
    const s = await api.get('/v1/wiki/subjects/61.12/kb/vtd', { as: await staff() });
    expect(s.json.sources.map((x: any) => x.name)).toEqual(['Anónimo.pdf', 'Privado.pdf', 'Guía VTD.pdf', 'Comunidad.pdf']);
    expect(s.json.sourceYears).toEqual({ min: 2019, max: 2026 });
    expect(s.json.stale).toBe(false);
    expect(s.json.backlinks.map((b: any) => b.slug)).toEqual(['index', 'oculta', 'balance']);
  });

  test('hiddenPagesAreForStaffOnlyAndNotForAKeyWithoutStaffScope', async () => {
    expect((await api.get('/v1/wiki/subjects/61.12/kb/oculta', { as: await reader() })).status).toBe(404);
    const r = await api.get('/v1/wiki/subjects/61.12/kb/oculta', { as: await staff() });
    expect(r.status).toBe(200);
    expect(r.json.status).toBe('HIDDEN');
    expect((await api.get('/v1/wiki/subjects/81.07/kb/viejo', { as: await staff() })).status).toBe(404);

    const [row] = await api.db`SELECT id FROM public."user" WHERE email = ${STAFF}`;
    const readKey = await seedApiKey(api.db, row!.id, ['read']);
    expect((await api.get('/v1/wiki/subjects/61.12/kb/oculta', { as: apiKey(readKey.key) })).status).toBe(404);
    const staffKey = await seedApiKey(api.db, row!.id, ['staff']);
    expect((await api.get('/v1/wiki/subjects/61.12/kb/oculta', { as: apiKey(staffKey.key) })).status).toBe(200);
  });

  test('graphHasOwnPagesThenExternalOnesAndDistinctEdges', async () => {
    const r = await api.get('/v1/wiki/subjects/61.12/kb/graph', { as: await reader() });
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.json.nodes)).toBe('['
      + `{"id":"${P.index}","subjectId":"61.12","slug":"index","title":"Matemática Financiera","type":"index","external":false},`
      + `{"id":"${P.tir}","subjectId":"61.12","slug":"tir","title":"tasa interna","type":"concept","external":false},`
      + `{"id":"${P.vtd}","subjectId":"61.12","slug":"vtd","title":"Valor tiempo del dinero","type":"concept","external":false},`
      + `{"id":"${P.balance}","subjectId":"81.07","slug":"balance","title":"Balance","type":"concept","external":true},`
      + `{"id":"${P.limites}","subjectId":"93.26","slug":"limites","title":"Límites","type":"concept","external":true}]`);
    const edges = (r.json.edges as any[]).map((e) => `${e.from}>${e.to}`).sort();
    expect(edges).toEqual([
      `${P.balance}>${P.vtd}`, `${P.index}>${P.balance}`, `${P.index}>${P.vtd}`, `${P.limites}>${P.index}`, `${P.vtd}>${P.index}`,
    ].sort());
    expect(Object.keys(r.json.edges[0])).toEqual(['from', 'to']);

    const empty = await api.get('/v1/wiki/subjects/72.01/kb/graph', { as: await reader() });
    expect(empty.text).toBe('{"nodes":[],"edges":[]}');
  });

  test('unknownSubjectsAndPagesAre404', async () => {
    let r = await api.get('/v1/wiki/subjects/99.99/kb', { as: await reader() });
    expect(r.status).toBe(404);
    expect(r.json.error).toBe('ResourceNotFound');
    expect(r.json.message).toBe("Subject with identifier '99.99' not found");
    r = await api.get('/v1/wiki/subjects/99.99/kb/graph', { as: await reader() });
    expect(r.status).toBe(404);
    expect(r.json.message).toBe("Subject with identifier '99.99' not found");
    r = await api.get('/v1/wiki/subjects/61.12/kb/nada', { as: await reader() });
    expect(r.status).toBe(404);
    expect(r.json.message).toBe("KbPage with identifier '61.12/nada' not found");
    r = await api.put(`/v1/wiki/kb/pages/${u(99)}/report`, { as: await reader(), body: { reason: 'SPAM' } });
    expect(r.status).toBe(404);
    expect(r.json.message).toBe(`KbPage with identifier '${u(99)}' not found`);
    r = await api.put('/v1/wiki/kb/pages/not-a-uuid/report', { as: await reader(), body: { reason: 'SPAM' } });
    expect(r.status).toBe(400);
  });

  test('bindingErrorsComeBeforeTheCapabilityCheck', async () => {
    await api.db`DELETE FROM public.capability_settings WHERE capability = 'apuntes'`;
    let r = await api.get('/v1/wiki/kb/search', { as: await reader() });
    expect(r.status).toBe(400);
    r = await api.put(`/v1/wiki/kb/pages/${P.vtd}/report`, { as: await reader(), body: { comment: 'x' } });
    expect(r.status).toBe(400);
    expect(r.json.message).toBe('reason: must not be null');
    r = await api.put(`/v1/wiki/kb/pages/${P.vtd}/report`, { as: await reader(), body: { reason: 'SPAM' } });
    expect(r.status).toBe(403);
    expect(r.json.error).toBe('CAPABILITY_REQUIRED');
    expect(r.json.message).toBe("This feature requires the 'apuntes' capability");
    for (const path of ['/v1/wiki/subjects/61.12/kb', '/v1/wiki/subjects/61.12/kb/graph', '/v1/wiki/subjects/61.12/kb/vtd']) {
      expect((await api.get(path, { as: await reader() })).status).toBe(403);
    }
    // Staff hold every capability.
    expect((await api.get('/v1/wiki/subjects/61.12/kb', { as: await staff() })).status).toBe(200);
    expect((await api.get('/v1/wiki/subjects/61.12/kb')).status).toBe(401);
  });

  test('reportRules', async () => {
    const long = 'x'.repeat(2001);
    let r = await api.put(`/v1/wiki/kb/pages/${P.vtd}/report`, { as: await reader(1), body: { reason: 'OTHER', comment: long } });
    expect(r.status).toBe(400);
    expect(r.json.message).toBe('comment: size must be between 0 and 2000');
    r = await api.put(`/v1/wiki/kb/pages/${P.vtd}/report`, { as: await reader(1), body: { reason: 'OTHER', comment: '  hola  ' } });
    expect(r.status).toBe(204);
    expect(r.text).toBe('');
    let [rep] = await api.db`SELECT reason, comment FROM wiki.kb_page_report WHERE page_id = ${P.vtd}`;
    expect(rep).toEqual({ reason: 'OTHER', comment: 'hola' });
    r = await api.put(`/v1/wiki/kb/pages/${P.vtd}/report`, { as: await reader(1), body: { reason: 'SPAM', comment: '   ' } });
    expect(r.status).toBe(204);
    [rep] = await api.db`SELECT reason, comment FROM wiki.kb_page_report WHERE page_id = ${P.vtd}`;
    expect(rep).toEqual({ reason: 'SPAM', comment: null });
    const [pg] = await api.db`SELECT report_count, status FROM wiki.kb_page WHERE id = ${P.vtd}`;
    expect(pg).toEqual({ report_count: 1, status: 'PUBLISHED' });

    // A HIDDEN page cannot be reported by someone new.
    r = await api.put(`/v1/wiki/kb/pages/${P.oculta}/report`, { as: await reader(1), body: { reason: 'SPAM' } });
    expect(r.status).toBe(404);
    // Three reports hide it; an existing reporter may still re-report the hidden page.
    await api.put(`/v1/wiki/kb/pages/${P.vtd}/report`, { as: await reader(2), body: { reason: 'SPAM' } });
    await api.put(`/v1/wiki/kb/pages/${P.vtd}/report`, { as: await reader(3), body: { reason: 'COPYRIGHT' } });
    const [hidden] = await api.db`SELECT report_count, status, hidden_reason FROM wiki.kb_page WHERE id = ${P.vtd}`;
    expect(hidden).toEqual({ report_count: 3, status: 'HIDDEN', hidden_reason: 'REPORTS' });
    expect((await api.put(`/v1/wiki/kb/pages/${P.vtd}/report`, { as: await reader(1), body: { reason: 'OTHER' } })).status).toBe(204);
    expect((await api.put(`/v1/wiki/kb/pages/${P.vtd}/report`, { as: await reader(4), body: { reason: 'OTHER' } })).status).toBe(404);
    expect((await api.get('/v1/wiki/subjects/61.12/kb/vtd', { as: await staff() })).json.reportedByMe).toBe(false);
  });

  test('searchValidatesAndClamps', async () => {
    let r = await api.get('/v1/wiki/kb/search', { as: await reader(), query: { q: 'x'.repeat(501) } });
    expect(r.status).toBe(400);
    expect(r.json.message).toBe("Validation failed for field 'q' with value '501 characters': must be at most 500 characters");
    r = await api.get('/v1/wiki/kb/search', { as: await reader(), query: { q: ' ' } });
    expect(r.status).toBe(400);
    expect(r.json.message).toBe("Validation failed for field 'q' with value ' ': is required");
    r = await api.get('/v1/wiki/kb/search', { as: await reader(), query: { q: 'tasa', limit: 'x' } });
    expect(r.status).toBe(400);
    // No chunks yet: an empty result, the query echoed stripped.
    r = await api.get('/v1/wiki/kb/search', { as: await reader(), query: { q: '  tasa  ', limit: 0, subjectId: ' ' } });
    expect(r.status).toBe(200);
    expect(r.text).toBe('{"query":"tasa","results":[]}');
  });
});
