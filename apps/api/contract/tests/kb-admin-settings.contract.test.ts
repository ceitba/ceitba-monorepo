// Port of apps/api/src/test/java/org/ceitba/api/web/kb/pipeline/KbAdminEvalIT.java
// #settingsAreValidatedVersionedAndRestorable (with KbPipelineAcceptanceIT's @BeforeEach seed),
// plus shapes of the settings endpoints (docs/SUBJECT-WIKI-ADMIN.md §1) the IT reads through
// jsonPath only: GET/PUT/preview/history/restore envelopes, byte-level.
import { beforeEach, describe, expect, test } from 'bun:test';
import { bearer, mintJwt, seedStaff, seedUser, useServer } from '../support';

const api = useServer();
const FIN = '61.12';
const CONT = '81.07';
const STAFF = 'staff@itba.edu.ar';

const text = (tag: string) => Array.from({ length: 80 }, (_, i) => `${tag}palabra${i}`).join(' ');
// String.hashCode, for the fingerprints the IT computes ("fp-" + text.hashCode()).
const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0; return h; };

async function seed() {
  await api.db`TRUNCATE wiki.kb_page, wiki.kb_subject_relation, wiki.drive_file, wiki.drive_source, wiki.kb_run CASCADE`;
  await api.db`TRUNCATE wiki.kb_file_digest, wiki.kb_subject_state, wiki.kb_llm_usage, wiki.kb_pipeline_settings, wiki.kb_pipeline_settings_history CASCADE`;
  await api.db`TRUNCATE public."user", public.plan_subject, public.plan_entry, public.subject, public.plan, public.careers CASCADE`;
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
  // MockMvc's jwt() with name "Staff" and ROLE_STAFF: a real staff row for a user named Staff.
  await seedUser(api.db, STAFF, { name: 'Staff' });
  await seedStaff(api.db, STAFF);
}

async function staff() {
  return bearer(await mintJwt({ email: STAFF, name: 'Staff' }));
}

async function call(method: 'get' | 'put' | 'post', path: string, body: unknown, expected: number) {
  const r = await api[method](path, { as: await staff(), body: body === null ? undefined : body });
  if (r.status !== expected) throw new Error(`${method.toUpperCase()} ${path} -> ${r.status} (expected ${expected}): ${r.text}`);
  return r;
}

async function probed(...models: string[]) {
  for (const m of models) {
    await api.db`UPDATE wiki.kb_model SET last_probe = '{"ok":true,"mode":"sync","toolCalling":"yes"}'::jsonb WHERE id = ${m}`;
  }
}

const ISO_Z = /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?Z$/;
const ISO_ART = /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?-03:00$/;

describe('KbAdminEvalIT', () => {
  beforeEach(seed);

  test('settingsAreValidatedVersionedAndRestorable', async () => {
    await api.db`UPDATE wiki.kb_model SET last_probe = NULL`;
    const err = await call('put', '/v1/staff/kb/settings', { modelPlan: 'anthropic-claude-haiku-4.5' }, 400);
    expect(err.text).toContain('probe');
    await call('put', '/v1/staff/kb/settings', { modelPlan: 'no-such-model' }, 400);
    // gpt-oss has no batch support: batch mode is rejected.
    await probed('openai-gpt-oss-120b', 'anthropic-claude-haiku-4.5', 'glm-5.3', 'glm-5.3-flash');
    await call('put', '/v1/staff/kb/settings', { executionMode: 'batch', modelWrite: 'openai-gpt-oss-120b' }, 400);

    const updated = (await call('put', '/v1/staff/kb/settings',
      { modelPlan: 'anthropic-claude-haiku-4.5', reasoningEffort: { digest: 'low', plan: null, write: 'high', retry: 'high' } }, 200)).json;
    expect(updated.costImpact.previous.basis).toBe('corpus');
    expect('includesBacklog' in updated.costImpact.projected).toBe(true);
    expect('projectedWeeklyAvgUsd' in updated.costImpact).toBe(false);
    expect(updated.updatedByName).toBe('Staff');
    expect((await call('get', '/v1/staff/kb/settings', null, 200)).json.costImpact).toBeNull();
    // Standard 5-field cron is accepted and returned as Spring's 6 fields.
    const cron = (await call('put', '/v1/staff/kb/settings', { cron: '0 3 * * SUN' }, 200)).json;
    expect(cron.settings.cron).toBe('0 0 3 * * SUN');
    await call('put', '/v1/staff/kb/settings', { cron: 'every sunday' }, 400);
    const settings = await call('get', '/v1/staff/kb/settings', null, 200);
    expect(settings.text).toContain('anthropic-claude-haiku-4.5');

    const preview = (await call('post', '/v1/staff/kb/settings/preview', { modelWrite: 'no-such-model' }, 200)).json;
    expect(preview.errors.length).toBeGreaterThan(0);
    expect('previous' in preview.costImpact).toBe(true);

    // History holds each saved version; restoring the first brings haiku back.
    await call('put', '/v1/staff/kb/settings', { modelPlan: 'glm-5.3' }, 200);
    expect((await call('get', '/v1/staff/kb/settings', null, 200)).json.settings.modelPlan).toBe('glm-5.3');
    const history = (await call('get', '/v1/staff/kb/settings/history', null, 200)).json;
    expect(history).toHaveLength(3);
    expect(history[0].changedByName).toBe('Staff');
    const oldest = history[history.length - 1].id;
    await call('post', `/v1/staff/kb/settings/history/${oldest}/restore`, null, 200);
    expect((await call('get', '/v1/staff/kb/settings', null, 200)).json.settings.modelPlan).toBe('anthropic-claude-haiku-4.5');
    expect((await call('get', '/v1/staff/kb/settings/history', null, 200)).json).toHaveLength(4);
  });
});

describe('KbSettings shapes', () => {
  beforeEach(seed);

  test('getWithoutRowIsEnvDefaults', async () => {
    const r = await call('get', '/v1/staff/kb/settings', null, 200);
    expect(r.text).toBe(
      '{"settings":{"modelDigest":"glm-5.3-flash","modelPlan":"glm-5.3","modelWrite":"glm-5.3","modelRetry":"glm-5.3",'
      + '"executionMode":"auto","enabled":false,"cron":"0 0 3 * * SUN","runTokenBudget":3000000,"runCostBudgetUsd":5.00,'
      + '"weeklyCostLimitUsd":null,"retryRejected":true,"subjectOverrides":{},'
      + '"reasoningEffort":{"digest":"low","plan":"low","write":"medium","retry":"medium"},'
      + '"maxTokens":{"digest":4000,"plan":6000,"write":12000,"retry":12000},"autoRefreshPrices":true},'
      + '"source":{"modelDigest":"env","modelPlan":"env","modelWrite":"env","modelRetry":"env","executionMode":"env",'
      + '"enabled":"env","cron":"env","runTokenBudget":"env","runCostBudgetUsd":"env","weeklyCostLimitUsd":"env",'
      + '"retryRejected":"env","subjectOverrides":"env","reasoningEffort":"env","maxTokens":"env","autoRefreshPrices":"env"},'
      + '"updatedAt":null,"updatedBy":null,"updatedByName":null,"costImpact":null}');
    expect((await call('get', '/v1/staff/kb/settings/history', null, 200)).text).toBe('[]');
  });

  test('putKeepsDoubleLexemesAndTimestampsFollowTheirOrigin', async () => {
    const put = await call('put', '/v1/staff/kb/settings', { note: 'n1' }, 200);
    // Nothing changed: no field is stored, the row and a history entry exist anyway.
    expect(put.json.source.modelPlan).toBe('env');
    expect(put.json.updatedAt).toMatch(ISO_ART);   // OffsetDateTime.now(clock) on the saved entity
    const raw = await api.put('/v1/staff/kb/settings', {
      as: await staff(), contentType: 'application/json',
      body: '{"runCostBudgetUsd": 7.0, "weeklyCostLimitUsd": 12.50, "runTokenBudget": 1000, "maxTokens": {"plan": 8000}, "subjectOverrides": {"61.12": {"paused": true}}}',
    });
    expect(raw.status).toBe(200);
    expect(raw.text).toContain('"runCostBudgetUsd":7.0,');
    expect(raw.text).toContain('"weeklyCostLimitUsd":12.5,');
    expect(raw.text).toContain('"maxTokens":{"digest":4000,"plan":8000,"write":12000,"retry":12000}');
    expect(raw.text).toContain('"subjectOverrides":{"61.12":{"paused":true}}');
    const get = await call('get', '/v1/staff/kb/settings', null, 200);
    expect(get.text).toContain('"runCostBudgetUsd":7.0,');
    expect(get.json.updatedAt).toMatch(ISO_Z);   // read back from the database
    expect(get.json.source.runCostBudgetUsd).toBe('db');
    expect(get.json.source.modelRetry).toBe('env');
    const history = await call('get', '/v1/staff/kb/settings/history?limit=1', null, 200);
    expect(history.json).toHaveLength(1);
    expect(history.json[0].changedAt).toMatch(ISO_Z);
    expect(history.json[0].note).toBeNull();
    expect(Object.keys(history.json[0])).toEqual(['id', 'settings', 'changedBy', 'changedByName', 'changedAt', 'note']);
    expect(history.text).toContain('"runCostBudgetUsd":7.0');
    const all = (await call('get', '/v1/staff/kb/settings/history', null, 200)).json;
    expect(all[1].note).toBe('n1');
    expect(all[1].settings).toEqual({});
  });

  test('validationErrorsNameTheField', async () => {
    const cases: [unknown, string][] = [
      [{ enabled: 'yes' }, "Validation failed for field 'enabled' with value '\"yes\"': must be true or false"],
      [{ runTokenBudget: '25' }, "Validation failed for field 'runTokenBudget' with value '\"25\"': must be a whole number"],
      [{ runTokenBudget: 0 }, "Validation failed for field 'runTokenBudget' with value '0': must be positive"],
      [{ runTokenBudget: 60000000 }, "Validation failed for field 'runTokenBudget' with value '60000000': must be at most 50000000 (KB_RUN_TOKEN_BUDGET_MAX)"],
      [{ runCostBudgetUsd: 0.01 }, "Validation failed for field 'runCostBudgetUsd' with value '0.01': must be between 0.10 and 100 (US$)"],
      [{ weeklyCostLimitUsd: -1 }, "Validation failed for field 'weeklyCostLimitUsd' with value '-1': must be >= 0"],
      [{ maxTokens: { write: 100 } }, "Validation failed for field 'maxTokens.write' with value '100': must be between 256 and 32000"],
      [{ reasoningEffort: { plan: 'max' } }, "Validation failed for field 'reasoningEffort.plan' with value '\"max\"': must be low, medium, high or null"],
      [{ executionMode: 'turbo' }, "Validation failed for field 'executionMode' with value 'turbo': must be auto, batch or sync"],
      [{ subjectOverrides: [] }, "Validation failed for field 'subjectOverrides' with value '[]': must be an object"],
      [{ modelPlan: 'no-such-model' }, "Validation failed for field 'modelPlan' with value 'no-such-model': not in the model catalog"],
      [{ cron: 'every sunday' }, "Validation failed for field 'cron' with value 'every sunday': not a valid cron expression (Spring 6 fields with seconds, or standard 5 fields)"],
    ];
    for (const [body, message] of cases) {
      const r = await call('put', '/v1/staff/kb/settings', body, 400);
      expect(r.json.error).toBe('ValidationError');
      expect(r.json.message).toBe(message);
    }
    const preview = await call('post', '/v1/staff/kb/settings/preview', { enabled: 'yes' }, 200);
    expect(preview.json.errors).toEqual(["Validation failed for field 'enabled' with value '\"yes\"': must be true or false"]);
    expect(Object.keys(preview.json)).toEqual(['costImpact', 'errors']);
    expect(Object.keys(preview.json.costImpact)).toEqual(['previous', 'projected']);
    expect(Object.keys(preview.json.costImpact.previous)).toEqual(['expectedUsd', 'low', 'high', 'basis', 'runsUsed', 'includesBacklog']);
  });

  test('restoreUnknownHistoryIs404AndBadIdIs400', async () => {
    const r = await call('post', `/v1/staff/kb/settings/history/${crypto.randomUUID()}/restore`, null, 404);
    expect(r.json.error).toBe('ResourceNotFound');
    const bad = await call('post', '/v1/staff/kb/settings/history/nope/restore', null, 400);
    expect(bad.json.error).toBe('ValidationError');
    expect(bad.json.message).toBe("id: invalid UUID 'nope'");
    const limit = await call('get', '/v1/staff/kb/settings/history?limit=x', null, 400);
    expect(limit.json.message).toBe("limit: invalid int 'x'");
  });

  test('cronsSpringAcceptsAndRejects', async () => {
    for (const ok of ['0 0 3 * * SUN', '0 */15 * * * *', '@weekly', '0 0 3 ? * MON-FRI', '0 0 0 L * ?', '0 0 9 * * 1#2']) {
      const r = await call('put', '/v1/staff/kb/settings', { cron: ok }, 200);
      expect(r.json.settings.cron).toBe(ok);
    }
    for (const bad of ['0 0 3 * *  * *', '61 0 3 * * SUN', '0 0 25 * * *', 'x y z a b c', '0 0 3 * * SUNDAY']) {
      await call('put', '/v1/staff/kb/settings', { cron: bad }, 400);
    }
  });

  test('anonymousAndNonStaffAreRejected', async () => {
    expect((await api.get('/v1/staff/kb/settings')).status).toBe(401);
    expect((await api.get('/v1/staff/kb/settings', { as: bearer(await mintJwt({ email: 'alumno@itba.edu.ar' })) })).status).toBe(403);
  });
});
