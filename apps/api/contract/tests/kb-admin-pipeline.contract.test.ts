// apps/api/src/main/java/org/ceitba/api/web/kb/admin/StaffKbPipelineController.java, black-box: the
// routes kb-admin registers over kb-pipeline's KbPipelineService. The Java ITs that advance runs
// (KbPipelineAcceptanceIT and its subclasses) are in-process ports (test/kb-pipeline,
// test/kb-admin); this file pins what a run looks like before it advances
// (KB_PIPELINE_BACKGROUND=false), cancel / approve-cost, baseline, preview and the parameter
// errors of KbAdminExceptionHandler.
import { beforeEach, describe, expect, test } from 'bun:test';
import { bearer, mintJwt, seedStaff, seedUser, useServer } from '../support';

const api = useServer();
const FIN = '61.12';
const CONT = '81.07';
const STAFF = 'staff@itba.edu.ar';
const DUMP = process.env.KB_DUMP === '1';

const text = (tag: string) => Array.from({ length: 80 }, (_, i) => `${tag}palabra${i}`).join(' ');
const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0; return h; };

async function seed() {
  await api.db`TRUNCATE wiki.kb_page, wiki.kb_subject_relation, wiki.drive_file, wiki.drive_source, wiki.kb_run CASCADE`;
  await api.db`TRUNCATE wiki.kb_file_digest, wiki.kb_subject_state, wiki.kb_llm_usage, wiki.kb_pipeline_settings, wiki.kb_pipeline_settings_history CASCADE`;
  await api.db`TRUNCATE public."user", public.plan_subject, public.subject, public.plan, public.careers CASCADE`;
  await api.db`INSERT INTO public.subject (id, name, credits, updated_at) VALUES ('61.12', 'Matemática Financiera', 3, now()), ('81.07', 'Contabilidad', 3, now())`;
  const owner = await seedUser(api.db, 'alumna@itba.edu.ar', { name: 'Alumna' });
  const source = crypto.randomUUID();
  await api.db`INSERT INTO wiki.drive_source (id, user_id, root_folder_id, root_name, status, consent_version, consented_at, approved_at)
               VALUES (${source}, ${owner}, 'root', 'Apuntes', 'ACTIVE', '2026-10', now(), now())`;
  for (const [name, subject, tag] of [['Guía VTD.pdf', FIN, 'alfa'], ['Resumen TIR.pdf', FIN, 'beta'], ['Balance.pdf', CONT, 'gamma']] as const) {
    const id = crypto.randomUUID();
    const t = text(tag);
    await api.db`INSERT INTO wiki.drive_file (id, source_id, drive_id, name, mime_type, kind, owned_by_sharer, subject_id, effective_subject_id, publication, text_content, content_fingerprint)
                 VALUES (${id}, ${source}, ${'d-' + id}, ${name}, 'application/pdf', 'PDF', true, ${subject}, ${subject}, 'PUBLISHED', ${t}, ${'fp-' + hash(t)})`;
  }
  await seedUser(api.db, STAFF, { name: 'Staff' });
  await seedStaff(api.db, STAFF);
}

const staff = async () => bearer(await mintJwt({ email: STAFF, name: 'Staff' }));

async function call(method: 'get' | 'post', path: string, body: unknown, expected: number) {
  const r = await api[method](path, { as: await staff(), body: body === null ? undefined : body });
  if (DUMP) console.log(method, path, r.status, r.text);
  if (r.status !== expected) throw new Error(`${method.toUpperCase()} ${path} -> ${r.status} (expected ${expected}): ${r.text}`);
  return r;
}

describe('StaffKbPipelineController', () => {
  beforeEach(seed);

  test('aRunBeforeItAdvancesAndItsCancel', async () => {
    const preview = await call('get', '/v1/staff/kb/pipeline/preview', null, 200);
    expect(preview.text).toContain(FIN);
    expect(preview.text).toContain(CONT);
    const started = await call('post', '/v1/staff/kb/pipeline/runs', null, 202);
    const run = started.json;
    expect(run.status).toBe('RUNNING');
    expect(run.trigger).toBe('MANUAL');
    expect(run.dryRun).toBe(false);
    const busy = await call('post', '/v1/staff/kb/pipeline/runs?dryRun=true', null, 409);
    expect(busy.json.error).toBe('KB_RUN_ACTIVE');
    const list = await call('get', '/v1/staff/kb/pipeline/runs?limit=5', null, 200);
    expect(list.json.map((r: any) => r.id)).toEqual([run.id]);
    const one = await call('get', `/v1/staff/kb/pipeline/runs/${run.id}`, null, 200);
    expect(Object.keys(one.json)).toEqual(Object.keys(run));
    const progress = await call('get', `/v1/staff/kb/pipeline/runs/${run.id}/progress`, null, 200);
    expect(progress.json.stages.map((s: any) => s.stage)).toEqual(['DIGEST', 'PLAN', 'WRITE', 'RETRY', 'LINK', 'VALIDATE', 'PUBLISH']);
    const notBlocked = await call('post', `/v1/staff/kb/pipeline/runs/${run.id}/approve-cost`, null, 409);
    expect(notBlocked.json.error).toBe('KB_RUN_NOT_BLOCKED');
    const cancelled = await call('post', `/v1/staff/kb/pipeline/runs/${run.id}/cancel`, null, 200);
    expect(cancelled.json.status).toBe('CANCELLED');
    expect((await call('post', `/v1/staff/kb/pipeline/runs/${run.id}/cancel`, null, 409)).json.error).toBe('KB_RUN_NOT_ACTIVE');
    expect((await call('get', `/v1/staff/kb/pipeline/runs/${run.id}/progress`, null, 200)).json.current).toBe('Cancelado');
  });

  test('baselineWithoutDigestsRecordsNothingAndSendsNoRequest', async () => {
    // Subjects whose files were never digested are not baselined (they still need a run).
    const base = await call('post', '/v1/staff/kb/pipeline/baseline', null, 200);
    expect(base.text).toBe('{"subjects":[]}');
    const [n] = await api.db`SELECT count(*)::int AS n FROM wiki.kb_run_request`;
    expect(n!.n).toBe(0);
    const preview = await call('get', '/v1/staff/kb/pipeline/preview', null, 200);
    expect(preview.text).toContain(FIN);
  });

  test('missingRunsAre404AndBadParametersAre400', async () => {
    const id = crypto.randomUUID();
    for (const [m, p] of [['get', `/v1/staff/kb/pipeline/runs/${id}`], ['get', `/v1/staff/kb/pipeline/runs/${id}/progress`],
      ['post', `/v1/staff/kb/pipeline/runs/${id}/cancel`], ['post', `/v1/staff/kb/pipeline/runs/${id}/approve-cost`]] as const) {
      const r = await call(m, p, null, 404);
      expect(r.json.error).toBe('ResourceNotFound');
    }
    expect((await call('get', '/v1/staff/kb/pipeline/runs/x', null, 400)).json.message).toBe("id: invalid UUID 'x'");
    expect((await call('get', '/v1/staff/kb/pipeline/runs?limit=abc', null, 400)).json.message).toBe("limit: invalid int 'abc'");
    expect((await call('post', '/v1/staff/kb/pipeline/runs?dryRun=maybe', null, 400)).json.message).toBe("dryRun: invalid boolean 'maybe'");
    expect((await call('get', '/v1/staff/kb/pipeline/runs', null, 200)).text).toBe('[]');
  });
});
