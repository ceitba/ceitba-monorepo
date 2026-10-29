// Evaluation endpoints that do not need the engine to advance:
// apps/api/src/main/java/org/ceitba/api/web/kb/admin/StaffKbEvalController.java and
// StaffKbPipelineController#compare (docs/SUBJECT-WIKI-ADMIN.md §4, §6). No Java IT drives
// these without advancing an eval (KbAdminEvalIT#evalUsesFrozenInputs... and
// #cancellingAnEvalCascades are in-process: test/kb-admin/evals.test.ts); this file pins the
// sets, estimate, list, leaderboard, a just-created eval, its cancel, and the validation
// messages, black-box (KB_PIPELINE_BACKGROUND=false: a created eval stays at DETECT).
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { bearer, mintJwt, seedStaff, seedUser, useServer } from '../support';

// A path-style S3 endpoint in the test process (PUT/GET/DELETE /<bucket>/<key>): sets freeze
// file texts into storage, so the servers need one.
const objects = new Map<string, Uint8Array>();
const s3 = Bun.serve({
  port: 0,
  async fetch(req) {
    const key = decodeURIComponent(new URL(req.url).pathname.replace(/^\/[^/]+\//, ''));
    if (req.method === 'PUT') {
      const raw = new Uint8Array(await req.arrayBuffer());
      objects.set(key, (req.headers.get('x-amz-content-sha256') ?? '').startsWith('STREAMING-') ? unchunk(raw) : raw);
      return new Response(null, { status: 200, headers: { ETag: '"x"' } });
    }
    if (req.method === 'DELETE') {
      objects.delete(key);
      return new Response(null, { status: 204 });
    }
    const v = objects.get(key);
    if (!v) return new Response('<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchKey</Code><Message>no</Message></Error>', { status: 404, headers: { 'Content-Type': 'application/xml' } });
    if (req.method === 'HEAD') return new Response(null, { status: 200, headers: { 'Content-Length': String(v.byteLength) } });
    return new Response(Buffer.from(v), { status: 200, headers: { "Content-Type": "application/octet-stream" } });
  },
});
afterAll(() => s3.stop(true));

/** aws-chunked body: `<hex size>;chunk-signature=...\r\n<data>\r\n` ... `0;...`. */
function unchunk(b: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  let i = 0;
  while (i < b.length) {
    let j = i;
    while (j < b.length && !(b[j] === 13 && b[j + 1] === 10)) j++;
    const size = parseInt(new TextDecoder().decode(b.subarray(i, j)).split(';')[0]!, 16);
    if (!size) break;
    parts.push(b.subarray(j + 2, j + 2 + size));
    i = j + 2 + size + 2;
  }
  return Buffer.concat(parts);
}

const api = useServer({
  env: {
    STORAGE_ENDPOINT: `http://127.0.0.1:${s3.port}`, STORAGE_BUCKET: 'kb', STORAGE_ACCESS_KEY_ID: 'AKIDTEST',
    STORAGE_SECRET_ACCESS_KEY: 'secret', STORAGE_PUBLIC_URL: 'https://media.test',
  },
});
const FIN = '61.12';
const CONT = '81.07';
const STAFF = 'staff@itba.edu.ar';
const DUMP = process.env.KB_DUMP === '1';

const text = (tag: string) => Array.from({ length: 80 }, (_, i) => `${tag}palabra${i}`).join(' ');
const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0; return h; };
const files: Record<string, string> = {};

async function seed() {
  await api.db`TRUNCATE wiki.kb_eval_set, wiki.kb_page, wiki.kb_subject_relation, wiki.drive_file, wiki.drive_source, wiki.kb_run CASCADE`;
  await api.db`TRUNCATE wiki.kb_file_digest, wiki.kb_subject_state, wiki.kb_llm_usage, wiki.kb_pipeline_settings, wiki.kb_pipeline_settings_history CASCADE`;
  await api.db`TRUNCATE public."user", public.plan_subject, public.plan_entry, public.subject, public.plan, public.careers CASCADE`;
  await api.db`INSERT INTO public.subject (id, name, credits, updated_at) VALUES ('61.12', 'Matemática Financiera', 3, now()), ('81.07', 'Contabilidad', 3, now())`;
  const owner = await seedUser(api.db, 'alumna@itba.edu.ar', { name: 'Alumna' });
  const source = crypto.randomUUID();
  await api.db`INSERT INTO wiki.drive_source (id, user_id, root_folder_id, root_name, status, consent_version, consented_at, approved_at)
               VALUES (${source}, ${owner}, 'root', 'Apuntes', 'ACTIVE', '2026-10', now(), now())`;
  for (const [name, subject, tag] of [['Guía VTD.pdf', FIN, 'alfa'], ['Resumen TIR.pdf', FIN, 'beta'], ['Balance.pdf', CONT, 'gamma']] as const) {
    const id = crypto.randomUUID();
    files[tag] = id;
    const t = text(tag);
    await api.db`INSERT INTO wiki.drive_file (id, source_id, drive_id, name, mime_type, kind, owned_by_sharer, subject_id, effective_subject_id, publication, text_content, content_fingerprint, academic_year)
                 VALUES (${id}, ${source}, ${'d-' + id}, ${name}, 'application/pdf', 'PDF', true, ${subject}, ${subject}, 'PUBLISHED', ${t}, ${'fp-' + hash(t)}, ${tag === 'alfa' ? 2024 : null})`;
  }
  await seedUser(api.db, STAFF, { name: 'Staff' });
  await seedStaff(api.db, STAFF);
}

const staff = async () => bearer(await mintJwt({ email: STAFF, name: 'Staff' }));

async function call(method: 'get' | 'put' | 'post', path: string, body: unknown, expected: number) {
  const r = await api[method](path, { as: await staff(), body: body === null ? undefined : body });
  if (DUMP) console.log(method, path, r.status, r.text);
  if (r.status !== expected) throw new Error(`${method.toUpperCase()} ${path} -> ${r.status} (expected ${expected}): ${r.text}`);
  return r;
}

async function probed(...models: string[]) {
  for (const m of models) {
    await api.db`UPDATE wiki.kb_model SET last_probe = '{"ok":true,"mode":"sync","toolCalling":"yes"}'::jsonb WHERE id = ${m}`;
  }
}

const ISO_Z = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/;
const ISO_ART = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?-03:00$/;
// Java's bytes for the finished eval below (set / file ids normalized).
const EXPECTED_HEAD = "{\"id\":\"00000000-0000-0000-0000-0000000000e1\",\"setId\":\"<set>\",\"setName\":\"Hecho\",\"status\":\"SUCCEEDED\",\"stage\":\"DONE\",\"note\":\"hecho\",\"createdAt\":\"2026-10-01T03:00:00Z\",\"finishedAt\":\"2026-10-01T03:10:00.5Z\",\"durationSec\":600,\"tokensIn\":2120,\"tokensOut\":1040,\"costUsd\":0.0512,\"simulated\":true,\"error\":null,\"sharedDigest\":{\"costUsd\":0.0012,\"requests\":2,\"inputTokens\":120,\"outputTokens\":40},\"configs\":[{\"configKey\":\"glm-5.3|glm-5.3\",\"plan\":\"glm-5.3\",\"write\":\"glm-5.3\",\"reasoningEffort\":null,\"status\":\"SUCCEEDED\",\"metrics\":{\"anchors\":1,\"costUsd\":0.02,\"avgWords\":110,\"crossLinks\":3,\"validPages\":2,\"durationSec\":40,\"inputTokens\":1000,\"outputTokens\":500,\"pagesPlanned\":2,\"pagesWritten\":2,\"claimsChecked\":4,\"rejectReasons\":{\"copy\":2,\"uncited\":1},\"copyViolations\":2,\"finalValidRate\":1,\"citationDensity\":1.25,\"uncitedSections\":1,\"costPerValidPage\":null,\"emptyToolCallRate\":0.1,\"coverageViolations\":0,\"firstPassValidRate\":0.5,\"groundingIsHeuristic\":true,\"unsupportedClaimsRate\":0.25},\"perSubject\":[{\"subjectId\":\"61.12\",\"subjectName\":\"Matemática Financiera\",\"status\":\"done\",\"pagesPlanned\":2,\"pagesWritten\":2,\"pagesValid\":2,\"metrics\":{\"anchors\":1,\"costUsd\":0.01,\"avgWords\":100,\"crossLinks\":3,\"validPages\":2,\"durationSec\":30,\"inputTokens\":1000,\"outputTokens\":500,\"pagesPlanned\":2,\"pagesWritten\":2,\"claimsChecked\":4,\"rejectReasons\":{\"copy\":2,\"uncited\":1},\"copyViolations\":2,\"finalValidRate\":1,\"citationDensity\":1.25,\"uncitedSections\":1,\"costPerValidPage\":null,\"emptyToolCallRate\":0.1,\"coverageViolations\":0,\"firstPassValidRate\":0.5,\"groundingIsHeuristic\":true,\"unsupportedClaimsRate\":0.25},\"pages\":[{\"slug\":\"tir\",\"title\":\"TIR\",\"valid\":true,\"firstPassValid\":true,\"errors\":[]},{\"slug\":\"vtd\",\"title\":\"Valor tiempo\",\"valid\":true,\"firstPassValid\":false,\"errors\":[]}]},{\"subjectId\":\"81.07\",\"subjectName\":\"Contabilidad\",\"status\":\"done\",\"pagesPlanned\":0,\"pagesWritten\":0,\"pagesValid\":0,\"metrics\":null,\"pages\":[]}],\"progress\":{\"done\":0,\"total\":0,\"percent\":100.0,\"stage\":\"DONE\"}},{\"configKey\":\"glm-5.3@low|glm-5.3@high\",\"plan\":\"glm-5.3\",\"write\":\"glm-5.3\",\"reasoningEffort\":{\"plan\":\"low\",\"write\":\"high\"},\"status\":\"SUCCEEDED\",\"metrics\":{\"anchors\":1,\"costUsd\":0.03,\"avgWords\":90,\"crossLinks\":3,\"validPages\":1,\"durationSec\":41,\"inputTokens\":1000,\"outputTokens\":500,\"pagesPlanned\":2,\"pagesWritten\":2,\"claimsChecked\":4,\"rejectReasons\":{\"copy\":2,\"uncited\":1},\"copyViolations\":2,\"finalValidRate\":0.5,\"citationDensity\":1.25,\"uncitedSections\":1,\"costPerValidPage\":null,\"emptyToolCallRate\":0.1,\"coverageViolations\":0,\"firstPassValidRate\":0.5,\"groundingIsHeuristic\":true,\"unsupportedClaimsRate\":0.25},\"perSubject\":[{\"subjectId\":\"61.12\",\"subjectName\":\"Matemática Financiera\",\"status\":\"done\",\"pagesPlanned\":2,\"pagesWritten\":2,\"pagesValid\":1,\"metrics\":{\"anchors\":1,\"costUsd\":0.01,\"avgWords\":100,\"crossLinks\":3,\"validPages\":1,\"durationSec\":30,\"inputTokens\":1000,\"outputTokens\":500,\"pagesPlanned\":2,\"pagesWritten\":2,\"claimsChecked\":4,\"rejectReasons\":{\"copy\":2,\"uncited\":1},\"copyViolations\":2,\"finalValidRate\":0.5,\"citationDensity\":1.25,\"uncitedSections\":1,\"costPerValidPage\":null,\"emptyToolCallRate\":0.1,\"coverageViolations\":0,\"firstPassValidRate\":0.5,\"groundingIsHeuristic\":true,\"unsupportedClaimsRate\":0.25},\"pages\":[{\"slug\":\"tir\",\"title\":\"TIR\",\"valid\":false,\"firstPassValid\":false,\"errors\":[\"sin citas\"]},{\"slug\":\"vtd\",\"title\":\"Valor tiempo\",\"valid\":true,\"firstPassValid\":false,\"errors\":[]}]},{\"subjectId\":\"81.07\",\"subjectName\":\"Contabilidad\",\"status\":\"done\",\"pagesPlanned\":0,\"pagesWritten\":0,\"pagesValid\":0,\"metrics\":null,\"pages\":[]}],\"progress\":{\"done\":0,\"total\":0,\"percent\":100.0,\"stage\":\"DONE\"}}]";
const EXPECTED_RP = "{\"totalPairs\":2,\"reviewedByMe\":0,\"reviewedByAnyone\":2,\"remainingForMe\":2,\"perSubject\":[{\"subjectId\":\"61.12\",\"subjectName\":\"Matemática Financiera\",\"totalPairs\":2,\"reviewedByMe\":0,\"reviewedByAnyone\":2}],\"ratingsPerConfig\":[{\"configKey\":\"glm-5.3|glm-5.3\",\"plan\":\"glm-5.3\",\"write\":\"glm-5.3\",\"ratings\":2},{\"configKey\":\"glm-5.3@low|glm-5.3@high\",\"plan\":\"glm-5.3\",\"write\":\"glm-5.3\",\"ratings\":2}],\"minRatingsForConfidence\":20,\"confident\":false}";
const EXPECTED_BOARD = "{\"setId\":\"<set>\",\"setName\":\"Hecho\",\"entries\":[{\"configKey\":\"glm-5.3|glm-5.3\",\"plan\":\"glm-5.3\",\"write\":\"glm-5.3\",\"reasoningEffort\":null,\"evals\":1,\"ratings\":2,\"wins\":1,\"losses\":0,\"ties\":1,\"winRate\":0.75,\"avgScores\":{\"accuracy\":3.5,\"clarity\":5.0,\"usefulness\":4.0},\"metrics\":{\"pagesPlanned\":2,\"pagesWritten\":2,\"validPages\":2,\"firstPassValidRate\":0.5,\"finalValidRate\":1.0,\"rejectReasons\":{\"copy\":2,\"uncited\":1},\"citationDensity\":1.25,\"uncitedSections\":1,\"coverageViolations\":0,\"copyViolations\":2,\"unsupportedClaimsRate\":0.25,\"claimsChecked\":4,\"groundingIsHeuristic\":true,\"avgWords\":110,\"crossLinks\":3,\"anchors\":1,\"inputTokens\":1000,\"outputTokens\":500,\"costUsd\":0.0200,\"costPerValidPage\":0.0100,\"emptyToolCallRate\":0.1,\"durationSec\":40},\"costUsd\":0.0200,\"costPerValidPage\":0.0100,\"smallSample\":true},{\"configKey\":\"glm-5.3@low|glm-5.3@high\",\"plan\":\"glm-5.3\",\"write\":\"glm-5.3\",\"reasoningEffort\":{\"plan\":\"low\",\"write\":\"high\"},\"evals\":1,\"ratings\":2,\"wins\":0,\"losses\":1,\"ties\":1,\"winRate\":0.25,\"avgScores\":{\"accuracy\":3.5,\"clarity\":3.5,\"usefulness\":5.0},\"metrics\":{\"pagesPlanned\":2,\"pagesWritten\":2,\"validPages\":1,\"firstPassValidRate\":0.5,\"finalValidRate\":0.5,\"rejectReasons\":{\"copy\":2,\"uncited\":1},\"citationDensity\":1.25,\"uncitedSections\":1,\"coverageViolations\":0,\"copyViolations\":2,\"unsupportedClaimsRate\":0.25,\"claimsChecked\":4,\"groundingIsHeuristic\":true,\"avgWords\":90,\"crossLinks\":3,\"anchors\":1,\"inputTokens\":1000,\"outputTokens\":500,\"costUsd\":0.0300,\"costPerValidPage\":0.0300,\"emptyToolCallRate\":0.1,\"durationSec\":41},\"costUsd\":0.0300,\"costPerValidPage\":0.0300,\"smallSample\":true}]}";
const EXPECTED_PAGE = "{\"title\":\"Valor tiempo\",\"markdown\":\"## Resumen\\n\\nEl valor tiempo del dinero [[file:<alfa>]] y [[tir|la TIR]] y [[81.07/balance#activo|Balance]].\",\"sources\":[{\"id\":\"<alfa>\",\"name\":\"Guía VTD.pdf\",\"kind\":\"PDF\",\"author\":{\"name\":\"Alumna\",\"anonymous\":false,\"community\":false},\"academicYear\":2024,\"academicYearSource\":null},{\"id\":\"00000000-0000-0000-0000-00000000dead\",\"name\":null,\"kind\":null,\"author\":null,\"academicYear\":null,\"academicYearSource\":null}],\"links\":[{\"raw\":\"tir\",\"subjectId\":\"61.12\",\"slug\":\"tir\",\"anchor\":null,\"resolved\":true,\"title\":\"TIR\"},{\"raw\":\"81.07/balance#activo\",\"subjectId\":\"81.07\",\"slug\":\"balance\",\"anchor\":\"activo\",\"resolved\":false,\"title\":null}]}";
const MODELS = [{ plan: 'glm-5.3', write: 'glm-5.3', reasoningEffort: { plan: 'low', write: 'medium' } }, { plan: 'anthropic-claude-haiku-4.5', write: 'anthropic-claude-haiku-4.5' }];

describe('StaffKbEvalController', () => {
  beforeEach(seed);

  test('setsAreFrozenOnCreateAndBasicoIsCreatedOnFirstUse', async () => {
    const sets = await call('get', '/v1/staff/kb/evals/sets', null, 200);
    expect(sets.json).toHaveLength(1);
    const basico = sets.json[0];
    expect(Object.keys(basico)).toEqual(['id', 'name', 'subjectIds', 'createdBy', 'createdAt', 'frozenAt', 'frozen']);
    expect(basico.name).toBe('Básico');
    expect(basico.subjectIds).toEqual([CONT]);
    expect(basico.createdBy).toBeNull();
    expect(basico.createdAt).toMatch(ISO_Z);
    expect(basico.frozenAt).toMatch(ISO_Z);
    expect(basico.frozen).toEqual([{ subjectId: CONT, subjectName: 'Contabilidad', files: 1, chars: text('gamma').length, digestsMissing: 1 }]);

    const created = await call('post', '/v1/staff/kb/evals/sets', { name: ' Prueba ', subjectIds: [FIN, CONT, FIN] }, 201);
    const set = created.json;
    expect(set.name).toBe('Prueba');
    expect(set.subjectIds).toEqual([FIN, CONT]);
    expect(set.createdAt).toMatch(ISO_Z);
    expect(set.frozenAt).toMatch(ISO_ART);
    expect(set.frozen.map((f: any) => [f.subjectId, f.files, f.digestsMissing])).toEqual([[FIN, 2, 2], [CONT, 1, 1]]);
    const [row] = await api.db`SELECT frozen_inputs::text AS f FROM wiki.kb_eval_set WHERE id = ${set.id}`;
    const frozen = JSON.parse(String(row!.f));
    const alfa = frozen[FIN].find((x: any) => x.fileId === files.alfa);
    expect(Object.keys(alfa).sort()).toEqual(['academicYear', 'chars', 'digestId', 'fileId', 'fingerprint', 'name', 'textKey'].sort());
    expect(alfa.academicYear).toBe(2024);
    expect(alfa.digestId).toBeNull();
    expect(alfa.textKey).toBe(`kb/evals/sets/${set.id}/${files.alfa}.txt`);
    expect(frozen[FIN].map((x: any) => x.fileId)).toEqual([files.alfa, files.beta].sort());
    expect(new TextDecoder().decode(objects.get(alfa.textKey))).toBe(text('alfa'));

    expect((await call('post', '/v1/staff/kb/evals/sets', { name: 'Prueba', subjectIds: [FIN] }, 409)).json.message)
      .toBe("KbEvalSet with identifier 'Prueba' already exists");
    expect((await call('post', '/v1/staff/kb/evals/sets', { subjectIds: [FIN] }, 400)).json.message)
      .toBe("Validation failed for field 'name' with value 'null': required");
    expect((await call('post', '/v1/staff/kb/evals/sets', { name: 'X', subjectIds: [] }, 400)).json.message)
      .toBe("Validation failed for field 'subjectIds' with value '[]': required");
    expect((await call('post', '/v1/staff/kb/evals/sets', { name: 'X', subjectIds: ['99.99'] }, 400)).json.message)
      .toBe("Validation failed for field 'subjectIds' with value '99.99': unknown subject");

    const again = await call('post', `/v1/staff/kb/evals/sets/${set.id}/refreeze`, null, 200);
    expect(again.json.id).toBe(set.id);
    expect(again.json.frozenAt).toMatch(ISO_ART);
    expect((await call('post', `/v1/staff/kb/evals/sets/${crypto.randomUUID()}/refreeze`, null, 404)).json.error).toBe('ResourceNotFound');
    expect((await call('post', '/v1/staff/kb/evals/sets/x/refreeze', null, 400)).json.message).toBe("id: invalid UUID 'x'");
    const all = (await call('get', '/v1/staff/kb/evals/sets', null, 200)).json;
    expect(all.map((s: any) => s.name)).toEqual(['Básico', 'Prueba']);
  });

  test('estimateListAndLeaderboardBeforeAnyEval', async () => {
    await probed('anthropic-claude-haiku-4.5', 'glm-5.3', 'glm-5.3-flash');
    const set = (await call('post', '/v1/staff/kb/evals/sets', { name: 'Prueba', subjectIds: [FIN, CONT] }, 201)).json;
    const est = await call('post', '/v1/staff/kb/evals/estimate', { setId: set.id, models: MODELS }, 200);
    expect(Object.keys(est.json)).toEqual(['estimatedInputTokens', 'estimatedOutputTokens', 'estimatedCostUsd']);
    expect(Number(est.json.estimatedCostUsd)).toBeGreaterThan(0);
    expect(est.text).toMatch(/"estimatedCostUsd":\d+\.\d{4}\}$/);
    expect((await call('post', '/v1/staff/kb/evals/estimate', { setId: 'x', models: MODELS }, 400)).json.message)
      .toBe("Validation failed for field 'setId' with value '\"x\"': required UUID");
    expect((await call('post', '/v1/staff/kb/evals/estimate', { models: MODELS }, 400)).json.message)
      .toBe("Validation failed for field 'setId' with value '': required UUID");
    expect((await call('post', '/v1/staff/kb/evals/estimate', { setId: set.id, models: [] }, 400)).json.message)
      .toBe("Validation failed for field 'models' with value '[]': at least one {plan, write}");
    expect((await call('post', '/v1/staff/kb/evals/estimate', { setId: set.id, models: [{ plan: 'nope', write: 'glm-5.3' }] }, 400)).json.message)
      .toBe("Validation failed for field 'models' with value 'nope': not in the model catalog");
    expect((await call('post', '/v1/staff/kb/evals/estimate', { setId: set.id, models: [{ plan: 'glm-5.3', reasoningEffort: 5 }] }, 400)).json.message)
      .toBe("Validation failed for field 'reasoningEffort' with value '5': must be an object {plan, write} or a string for both stages");
    expect((await call('post', '/v1/staff/kb/evals/estimate', { setId: set.id, models: [{ plan: 'glm-5.3', reasoningEffort: 'max' }] }, 400)).json.message)
      .toBe("Validation failed for field 'reasoningEffort' with value 'max': must be low, medium or high");
    expect((await call('post', '/v1/staff/kb/evals/estimate', { setId: crypto.randomUUID(), models: MODELS }, 404)).json.error).toBe('ResourceNotFound');

    expect((await call('get', '/v1/staff/kb/evals', null, 200)).text).toBe('[]');
    expect((await call('get', `/v1/staff/kb/evals?setId=${set.id}&limit=5`, null, 200)).text).toBe('[]');
    const board = await call('get', `/v1/staff/kb/evals/leaderboard?setId=${set.id}`, null, 200);
    expect(board.text).toBe(`{"setId":"${set.id}","setName":"Prueba","entries":[]}`);
    const basico = await call('get', '/v1/staff/kb/evals/leaderboard', null, 200);
    expect(basico.json.setName).toBe('Básico');
    expect((await call('get', `/v1/staff/kb/evals/leaderboard?setId=${crypto.randomUUID()}`, null, 404)).json.error).toBe('ResourceNotFound');
  });

  test('createGetCancelOfAnEvalThatHasNotAdvanced', async () => {
    await probed('anthropic-claude-haiku-4.5', 'glm-5.3', 'glm-5.3-flash');
    const set = (await call('post', '/v1/staff/kb/evals/sets', { name: 'Prueba', subjectIds: [FIN, CONT] }, 201)).json;
    const created = await call('post', '/v1/staff/kb/evals', { setId: set.id, models: MODELS, note: 'n' }, 202);
    const e = created.json;
    expect(Object.keys(e)).toEqual(['id', 'setId', 'setName', 'status', 'stage', 'note', 'createdAt', 'finishedAt', 'durationSec',
      'tokensIn', 'tokensOut', 'costUsd', 'simulated', 'error', 'sharedDigest', 'configs', 'progress', 'reviewSummary']);
    expect(e.status).toBe('RUNNING');
    expect(e.stage).toBe('DETECT');
    expect(e.note).toBe('n');
    expect(e.setName).toBe('Prueba');
    expect(e.createdAt).toMatch(ISO_Z);
    expect(e.finishedAt).toBeNull();
    expect(e.durationSec).toBeNull();
    expect(e.sharedDigest).toBeNull();
    expect(e.reviewSummary).toBeNull();
    expect(created.text).toContain('"tokensIn":0,"tokensOut":0,"costUsd":0.0000,"simulated":false,"error":null,"sharedDigest":null,');
    expect(e.configs.map((c: any) => c.configKey)).toEqual(['glm-5.3@low|glm-5.3@medium', 'anthropic-claude-haiku-4.5|anthropic-claude-haiku-4.5']);
    expect(Object.keys(e.configs[0])).toEqual(['configKey', 'plan', 'write', 'reasoningEffort', 'status', 'metrics', 'perSubject', 'progress']);
    expect(e.configs[0].reasoningEffort).toEqual({ plan: 'low', write: 'medium' });
    expect(e.configs[1].reasoningEffort).toBeNull();
    expect(e.configs[0].status).toBe('RUNNING');
    expect(e.configs[0].metrics).toBeNull();
    expect(e.configs[0].perSubject).toEqual([]);
    expect(Object.keys(e.configs[0].progress)).toEqual(['done', 'total', 'percent', 'stage']);
    expect(e.progress.stages).toHaveLength(7);
    const [run] = await api.db`SELECT trigger, status, stage, model, prompt_version, dry_run FROM wiki.kb_run WHERE id = ${e.id}`;
    expect(run).toMatchObject({ trigger: 'EVAL', status: 'RUNNING', stage: 'DETECT', model: 'glm-5.3@low|glm-5.3@medium,anthropic-claude-haiku-4.5|anthropic-claude-haiku-4.5', dry_run: false });
    const [ev] = await api.db`SELECT configs::text AS c, results::text AS r, note FROM wiki.kb_eval WHERE id = ${e.id}`;
    expect(String(ev!.c)).toBe('[{"plan": "glm-5.3", "write": "glm-5.3", "configKey": "glm-5.3@low|glm-5.3@medium", "reasoningEffort": {"plan": "low", "write": "medium"}}, {"plan": "anthropic-claude-haiku-4.5", "write": "anthropic-claude-haiku-4.5", "configKey": "anthropic-claude-haiku-4.5|anthropic-claude-haiku-4.5"}]');
    expect(String(ev!.r)).toBe('{"configs": {}}');

    const busy = await call('post', '/v1/staff/kb/evals', { setId: set.id, models: MODELS }, 409);
    expect(busy.json.error).toBe('KB_EVAL_ACTIVE');
    expect(busy.json.message).toBe('An eval is already running');

    const list = (await call('get', '/v1/staff/kb/evals', null, 200)).json;
    expect(list).toHaveLength(1);
    expect(list[0].progress).toBeNull();
    expect(list[0].configs[0].perSubject).toEqual([]);
    expect(list[0].configs[0].progress).toBeNull();
    const got = (await call('get', `/v1/staff/kb/evals/${e.id}`, null, 200)).json;
    expect(got.id).toBe(e.id);
    const progress = await call('get', `/v1/staff/kb/evals/${e.id}/progress`, null, 200);
    expect(progress.json.stages.map((s: any) => s.stage)).toEqual(['DIGEST', 'PLAN', 'WRITE', 'RETRY', 'LINK', 'VALIDATE', 'PUBLISH']);
    const rp = await call('get', `/v1/staff/kb/evals/${e.id}/review/progress`, null, 200);
    expect(rp.text).toBe('{"totalPairs":0,"reviewedByMe":0,"reviewedByAnyone":0,"remainingForMe":0,"perSubject":[],'
      + '"ratingsPerConfig":[{"configKey":"glm-5.3@low|glm-5.3@medium","plan":"glm-5.3","write":"glm-5.3","ratings":0},'
      + '{"configKey":"anthropic-claude-haiku-4.5|anthropic-claude-haiku-4.5","plan":"anthropic-claude-haiku-4.5","write":"anthropic-claude-haiku-4.5","ratings":0}],'
      + '"minRatingsForConfidence":20,"confident":false}');
    const next = await api.get(`/v1/staff/kb/evals/${e.id}/review/next`, { as: await staff() });
    expect(next.status).toBe(204);
    expect(next.text).toBe('');
    const page = await call('get', `/v1/staff/kb/evals/${e.id}/pages?configKey=x&subjectId=${FIN}&slug=y`, null, 404);
    expect(page.json.message).toBe(`KbEval page with identifier 'x/${FIN}/y' not found`);
    const review = await call('post', `/v1/staff/kb/evals/${e.id}/review`, { subjectId: FIN, slug: 'y', winner: 'A' }, 404);
    expect(review.json.error).toBe('KB_NO_PAIRS');
    expect(review.json.message).toBe('No pending pair for this page; call review/next first');
    expect((await call('post', `/v1/staff/kb/evals/${e.id}/review`, { winner: 'C' }, 400)).json.message)
      .toBe("Validation failed for field 'winner' with value 'C': must be A, B or tie");
    expect((await call('post', `/v1/staff/kb/evals/${e.id}/review`, { winner: 'tie', scoresA: { accuracy: 9 } }, 400)).json.message)
      .toBe("Validation failed for field 'scoresA.accuracy' with value '9': must be 1-5");
    expect((await call('post', `/v1/staff/kb/evals/${e.id}/promote`, { configKey: 'nope' }, 400)).json.message)
      .toBe("Validation failed for field 'configKey' with value 'nope': not a configuration of this eval");

    const cancelled = await call('post', `/v1/staff/kb/evals/${e.id}/cancel`, null, 200);
    expect(cancelled.json.status).toBe('CANCELLED');
    expect(cancelled.json.finishedAt).toMatch(ISO_Z);
    expect(typeof cancelled.json.durationSec).toBe('number');
    expect(cancelled.json.configs.map((c: any) => c.status)).toEqual(['CANCELLED', 'CANCELLED']);
    const again = await call('post', `/v1/staff/kb/evals/${e.id}/cancel`, null, 409);
    expect(again.json.error).toBe('KB_RUN_NOT_ACTIVE');
    expect((await call('get', `/v1/staff/kb/evals/${e.id}/progress`, null, 200)).json.current).toBe('Cancelado');
  });

  test('missingEvalsAre404AndBadIdsAre400', async () => {
    const id = crypto.randomUUID();
    for (const [m, p] of [['get', `/v1/staff/kb/evals/${id}`], ['get', `/v1/staff/kb/evals/${id}/progress`], ['get', `/v1/staff/kb/evals/${id}/review/progress`],
      ['get', `/v1/staff/kb/evals/${id}/review/next`], ['post', `/v1/staff/kb/evals/${id}/cancel`], ['get', `/v1/staff/kb/evals/${id}/pages?configKey=a&subjectId=b&slug=c`]] as const) {
      const r = await call(m, p, null, 404);
      expect(r.json.message).toBe(`KbEval with identifier '${id}' not found`);
    }
    expect((await call('post', `/v1/staff/kb/evals/${id}/promote`, { configKey: 'x' }, 404)).json.error).toBe('ResourceNotFound');
    expect((await call('post', `/v1/staff/kb/evals/${id}/review`, { subjectId: 'a', slug: 'b', winner: 'A' }, 404)).json.error).toBe('ResourceNotFound');
    expect((await call('get', '/v1/staff/kb/evals/nope', null, 400)).json.message).toBe("id: invalid UUID 'nope'");
    expect((await call('get', '/v1/staff/kb/evals?limit=x', null, 400)).json.message).toBe("limit: invalid int 'x'");
    expect((await call('get', '/v1/staff/kb/evals?setId=x', null, 400)).json.message).toBe("setId: invalid UUID 'x'");
    const missingParam = await call('get', `/v1/staff/kb/evals/${id}/pages?configKey=a`, null, 400);
    expect(missingParam.json.error).toBe('BadRequest');
  });

  test('createValidatesModelsAndTheSet', async () => {
    const set = (await call('post', '/v1/staff/kb/evals/sets', { name: 'Prueba', subjectIds: [FIN] }, 201)).json;
    expect((await call('post', '/v1/staff/kb/evals', { setId: crypto.randomUUID(), models: [{ plan: 'glm-5.3', write: 'glm-5.3' }] }, 404)).json.message)
      .toMatch(/^KbEvalSet with identifier '.+' not found$/);
    await api.db`UPDATE wiki.kb_model SET enabled = false WHERE id = 'glm-5.3-flash'`;
    expect((await call('post', '/v1/staff/kb/evals', { setId: set.id, models: [{ plan: 'glm-5.3-flash' }] }, 400)).json.message)
      .toBe("Validation failed for field 'models' with value 'glm-5.3-flash': is disabled in the catalog");
    expect((await call('post', '/v1/staff/kb/evals', { setId: set.id, models: 'glm' }, 400)).json.message)
      .toBe("Validation failed for field 'models' with value '\"glm\"': at least one {plan, write}");
    // A string config is both stages.
    const e = (await call('post', '/v1/staff/kb/evals', { setId: set.id, models: ['glm-5.3'] }, 202)).json;
    expect(e.configs[0].configKey).toBe('glm-5.3|glm-5.3');
    await call('post', `/v1/staff/kb/evals/${e.id}/cancel`, null, 200);
  });

  test('compareIsAnEvalOfOneSubject', async () => {
    expect((await call('post', '/v1/staff/kb/pipeline/compare', { subjectId: FIN, models: [] }, 400)).json.message)
      .toBe("Validation failed for field 'models' with value '[]': at least one {plan, write}");
    const r = await call('post', '/v1/staff/kb/pipeline/compare', { subjectId: FIN, models: [{ plan: 'glm-5.3', write: 'glm-5.3' }] }, 202);
    expect(r.json.note).toBe('compare');
    expect(r.json.setName).toStartWith(`compare ${FIN} `);
    expect(r.json.setName).toMatch(/-03:00$/);
    await call('post', `/v1/staff/kb/evals/${r.json.id}/cancel`, null, 200);
  });

  test('aFinishedEvalReadsBackForReviewAndTheLeaderboard', async () => {
    // A SUCCEEDED eval as REPORT leaves it: two configurations x two subjects (81.07 planned
    // nothing: no metrics), pages in storage, one pair already rated by another reviewer.
    const set = (await call('post', '/v1/staff/kb/evals/sets', { name: 'Hecho', subjectIds: [FIN, CONT] }, 201)).json;
    const id = '00000000-0000-0000-0000-0000000000e1';
    const A = 'glm-5.3|glm-5.3';
    const B = 'glm-5.3@low|glm-5.3@high';
    const keyOf = (k: string, slug: string) => `kb/evals/${id}/${k.replaceAll('|', '__').replaceAll('@', '_at_')}/${FIN}/${slug}.md`;
    const page = (title: string, extra: string) => `---\ntitle: ${title}\nsubject: '${FIN}'\ntype: concept\nsources:\n  - ${files.alfa}\n  - 00000000-0000-0000-0000-00000000dead\n---\n`
      + `## Resumen\n\nEl valor tiempo del dinero [[file:${files.alfa}]] y [[tir|la TIR]] y [[${CONT}/balance#activo|Balance]].${extra}\n`;
    for (const k of [A, B]) {
      objects.set(keyOf(k, 'vtd'), new TextEncoder().encode(page('Valor tiempo', k === A ? '' : ' Más.')));
      objects.set(keyOf(k, 'tir'), new TextEncoder().encode(page('TIR', '')));
    }
    const metrics = (cost: string, valid: number, words: number, dur: number) =>
      `{"pagesPlanned": 2, "pagesWritten": 2, "validPages": ${valid}, "firstPassValidRate": 0.5, "finalValidRate": ${valid / 2}, "rejectReasons": {"uncited": 1, "copy": 2},`
      + ` "citationDensity": 1.25, "uncitedSections": 1, "coverageViolations": 0, "copyViolations": 2, "unsupportedClaimsRate": 0.25, "claimsChecked": 4,`
      + ` "groundingIsHeuristic": true, "avgWords": ${words}, "crossLinks": 3, "anchors": 1, "inputTokens": 1000, "outputTokens": 500, "costUsd": ${cost},`
      + ` "costPerValidPage": null, "emptyToolCallRate": 0.1, "durationSec": ${dur}}`;
    const subj = (k: string, valid: boolean) => `{"operations": [{"slug": "vtd", "title": "Valor tiempo"}, {"slug": "tir", "title": "TIR"}], "metrics": ${metrics('0.0100', valid ? 2 : 1, 100, 30)},`
      + ` "pages": {"vtd": {"title": "Valor tiempo", "valid": true, "firstPassValid": false, "errors": [], "key": "${keyOf(k, 'vtd')}"},`
      + ` "tir": {"title": "TIR", "valid": ${valid}, "firstPassValid": ${valid}, "errors": ${valid ? '[]' : '["sin citas"]'}, "key": "${keyOf(k, 'tir')}"}}}`;
    const results = `{"configs": {"${A}": {"status": "SUCCEEDED", "metrics": ${metrics('0.0200', 2, 110, 40)}, "subjects": {"${FIN}": ${subj(A, true)}, "${CONT}": {"operations": [], "pages": {}}}},`
      + ` "${B}": {"status": "SUCCEEDED", "metrics": ${metrics('0.0300', 1, 90, 41)}, "subjects": {"${FIN}": ${subj(B, false)}, "${CONT}": {"operations": [], "pages": {}}}}},`
      + ` "sharedDigest": {"requests": 2, "inputTokens": 120, "outputTokens": 40, "costUsd": 0.0012}}`;
    const configs = `[{"configKey": "${A}", "plan": "glm-5.3", "write": "glm-5.3"}, {"configKey": "${B}", "plan": "glm-5.3", "write": "glm-5.3", "reasoningEffort": {"plan": "low", "write": "high"}}]`;
    await api.db`INSERT INTO wiki.kb_run (id, status, trigger, stage, started_at, finished_at, model, prompt_version, tokens_in, tokens_out, cost_estimate, simulated)
                 VALUES (${id}, 'SUCCEEDED', 'EVAL', 'DONE', '2026-10-01T03:00:00Z', '2026-10-01T03:10:00Z', ${A + ',' + B}, 'v2', 2120, 1040, 0.0512, true)`;
    await api.db`INSERT INTO wiki.kb_eval (id, set_id, configs, note, results, created_by, created_at, finished_at)
                 VALUES (${id}, ${set.id}, ${configs}::text::jsonb, 'hecho', ${results}::text::jsonb, NULL, '2026-10-01T03:00:00Z', '2026-10-01T03:10:00.5Z')`;
    const other = crypto.randomUUID();
    await api.db`INSERT INTO wiki.kb_eval_rating (id, eval_id, subject_id, slug, config_a, config_b, reviewer_id, winner, accuracy_a, clarity_a, usefulness_a, accuracy_b, clarity_b, usefulness_b, comment, assigned_at, rated_at)
                 VALUES (gen_random_uuid(), ${id}, ${FIN}, 'vtd', ${B}, ${A}, ${other}, ${A}, 4, 3, NULL, 5, 5, 4, 'x', now(), now()),
                        (gen_random_uuid(), ${id}, ${FIN}, 'tir', ${A}, ${B}, ${other}, 'tie', 2, NULL, NULL, 3, 4, 5, NULL, now(), now())`;

    const detail = await call('get', `/v1/staff/kb/evals/${id}`, null, 200);
    const d = detail.json;
    expect(d.durationSec).toBe(600);
    expect(d.finishedAt).toBe('2026-10-01T03:10:00.5Z');
    const head = detail.text.slice(0, detail.text.indexOf(',"progress":{"stages"'));
    const rp = await call('get', `/v1/staff/kb/evals/${id}/review/progress`, null, 200);
    const board = await call('get', `/v1/staff/kb/evals/leaderboard?setId=${set.id}`, null, 200);
    const pg = await call('get', `/v1/staff/kb/evals/${id}/pages?configKey=${encodeURIComponent(A)}&subjectId=${FIN}&slug=vtd`, null, 200);
    const norm = (t: string) => t.replaceAll(set.id, '<set>').replaceAll(files.alfa, '<alfa>');
    if (process.env.KB_PRINT === '1') {
      console.log('HEAD=' + JSON.stringify(norm(head)));
      console.log('RP=' + JSON.stringify(norm(rp.text)));
      console.log('BOARD=' + JSON.stringify(norm(board.text)));
      console.log('PAGE=' + JSON.stringify(norm(pg.text)));
    }
    expect(norm(head)).toBe(EXPECTED_HEAD);
    expect(norm(rp.text)).toBe(EXPECTED_RP);
    expect(norm(board.text)).toBe(EXPECTED_BOARD);
    expect(norm(pg.text)).toBe(EXPECTED_PAGE);

    const next = await call('get', `/v1/staff/kb/evals/${id}/review/next`, null, 200);
    expect(Object.keys(next.json)).toEqual(['subjectId', 'slug', 'remaining', 'reviewedByMe', 'totalPairs', 'a', 'b']);
    expect(next.json.remaining).toBe(2);
    expect(next.json.reviewedByMe).toBe(0);
    expect(next.json.totalPairs).toBe(2);
    expect(Object.keys(next.json.a)).toEqual(['title', 'markdown', 'sources', 'links']);
    const again = await call('get', `/v1/staff/kb/evals/${id}/review/next`, null, 200);
    expect([again.json.subjectId, again.json.slug]).toEqual([next.json.subjectId, next.json.slug]); // the pending pair, again
    const filtered = await call('get', `/v1/staff/kb/evals/${id}/review/next?subjectId=${FIN}&slug=${next.json.slug}`, null, 200);
    expect(filtered.json.reviewedByMe).toBe(0);
    const rated = await call('post', `/v1/staff/kb/evals/${id}/review`, { subjectId: next.json.subjectId, slug: next.json.slug, winner: 'tie', scoresA: { accuracy: 2 } }, 200);
    expect(Object.keys(rated.json.revealed)).toEqual(['A', 'B']);
    expect(Object.keys(rated.json.revealed.A)).toEqual(['configKey', 'plan', 'write']);
    expect([rated.json.revealed.A.configKey, rated.json.revealed.B.configKey].sort()).toEqual([A, B].sort());
    expect((await call('get', `/v1/staff/kb/evals/${id}/review/progress`, null, 200)).json.reviewedByMe).toBe(1);

    const promoted = await call('post', `/v1/staff/kb/evals/${id}/promote`, { configKey: B }, 200);
    expect(promoted.json.settings.reasoningEffort).toEqual({ digest: 'low', plan: 'low', write: 'high', retry: 'high' });
    expect(promoted.json.settings.modelRetry).toBe('glm-5.3');
    const [h] = await api.db`SELECT note FROM wiki.kb_pipeline_settings_history ORDER BY changed_at DESC LIMIT 1`;
    expect(h!.note).toBe(`promoted from eval ${id} (${B})`);
  });
});
