// Port of apps/api/src/test/java/org/ceitba/api/web/kb/pipeline/KbAdminEvalIT.java
// #catalogForecastAndStageCost and the black-box half of
// #modelSyncTakesPricesFromDoCatalogWithoutClobberingProbesOrManualFields (the unreachable-catalog
// fallback: the jar's FakeDoModelCatalog has no items, so POST /models/sync reads the fake
// inference /v1/models). The half that scripts the DO catalog items is in-process:
// test/kb-admin/model-sync.test.ts. Plus the catalog endpoints no IT covers (create, update,
// probe, stage-cost validation), byte-level where the shape matters.
import { beforeEach, describe, expect, test } from 'bun:test';
import { bearer, mintJwt, seedStaff, seedUser, useServer } from '../support';

const api = useServer();
const FIN = '61.12';
const CONT = '81.07';
const STAFF = 'staff@itba.edu.ar';

const text = (tag: string) => Array.from({ length: 80 }, (_, i) => `${tag}palabra${i}`).join(' ');
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
  await seedUser(api.db, STAFF, { name: 'Staff' });
  await seedStaff(api.db, STAFF);
}

const staff = async () => bearer(await mintJwt({ email: STAFF, name: 'Staff' }));

async function call(method: 'get' | 'put' | 'post', path: string, body: unknown, expected: number) {
  const r = await api[method](path, { as: await staff(), body: body === null ? undefined : body });
  if (r.status !== expected) throw new Error(`${method.toUpperCase()} ${path} -> ${r.status} (expected ${expected}): ${r.text}`);
  return r;
}

const ISO_Z = /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?Z$/;
const ISO_ART = /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?-03:00$/;

describe('KbAdminEvalIT', () => {
  beforeEach(seed);

  test('catalogForecastAndStageCost', async () => {
    const models = (await call('get', '/v1/staff/kb/models', null, 200)).json as any[];
    const haiku = models.find((m) => m.id === 'anthropic-claude-haiku-4.5');
    const glm = models.find((m) => m.id === 'glm-5.3');
    expect(typeof haiku.effectivePrices.batch).toBe('object');
    expect(haiku.effectivePrices.batch).not.toBeNull();
    expect(glm.effectivePrices.batch).toBeNull();
    expect(glm.supportsReasoningEffort).toBe(true);
    expect('emptyToolCallRate' in glm).toBe(true);

    const forecast = (await call('get', '/v1/staff/kb/costs/forecast', null, 200)).json;
    expect(forecast.nextRun.dirtySubjects).toBe(2);
    expect(forecast.nextRun.perStage.WRITE.mode).toBe('sync');
    expect(forecast.weekly.basis).toBe('corpus');
    // Nothing changed in Drive recently, but two subjects are pending: the week includes them.
    expect(forecast.weekly.includesBacklog).toBe(true);
    expect(Number(forecast.weekly.expectedUsd)).toBe(Number(forecast.nextRun.totalUsd));
    expect(Number(forecast.monthly.expectedUsd)).toBeGreaterThanOrEqual(Number(forecast.nextRun.totalUsd));
    expect('expectedUsd' in forecast.monthly).toBe(true);
    expect(forecast.settingsHash.trim()).not.toBe('');

    const proposed = (await call('post', '/v1/staff/kb/costs/forecast', { modelWrite: 'anthropic-claude-haiku-4.5' }, 200)).json;
    expect(proposed.nextRun.perStage.WRITE.mode).toBe('batch');
    expect(proposed.discountIsEstimate).toBe(true);

    const stage = (await call('get', '/v1/staff/kb/models/anthropic-claude-haiku-4.5/stage-cost?stage=WRITE', null, 200)).json;
    expect(stage.stage).toBe('write');
    expect(stage.mode).toBe('batch');
    expect('expectedWeeklyUsd' in stage && 'low' in stage && 'high' in stage && 'basis' in stage).toBe(true);
  });

  test('modelSyncTakesPricesFromDoCatalogWithoutClobberingProbesOrManualFields', async () => {
    // Unreachable catalog: falls back to /v1/models ids (the fake inference lists glm-5.3,
    // glm-5.3-flash and anthropic-claude-haiku-4.5, all already in the catalog).
    const fallback = await call('post', '/v1/staff/kb/models/sync', null, 200);
    expect(fallback.json.source).toBe('inference-models');
    expect(fallback.json.updated).toEqual([]);
    expect(fallback.json.added).toEqual([]);
    expect(fallback.json.unchanged).toBe(3);
    expect(fallback.json.notInCatalog).toContain('openai-gpt-oss-120b');
    expect(fallback.json.fetchedAt).toMatch(ISO_ART);
    expect(Object.keys(fallback.json)).toEqual(['updated', 'added', 'unchanged', 'notInCatalog', 'source', 'fetchedAt']);
    const sorted = [...fallback.json.notInCatalog].sort();
    expect(fallback.json.notInCatalog).toEqual(sorted);
  });
});

describe('KbModelCatalog endpoints', () => {
  beforeEach(seed);

  test('forecastShapeAndQueryForm', async () => {
    const r = await call('get', '/v1/staff/kb/costs/forecast', null, 200);
    const f = r.json;
    expect(Object.keys(f)).toEqual(['settingsHash', 'nextRun', 'weekly', 'monthly', 'fullRebuild', 'savings', 'limits', 'discountIsEstimate']);
    expect(Object.keys(f.nextRun.perStage)).toEqual(['DIGEST', 'PLAN', 'WRITE', 'RETRY']);
    expect(Object.keys(f.nextRun.perStage.PLAN)).toEqual(['model', 'mode', 'inputTokens', 'cachedInputTokens', 'outputTokens', 'costUsd']);
    expect(f.settingsHash).toMatch(/^[0-9a-f]{16}$/);
    expect(r.text).toMatch(/"limits":\{"weeklyCostLimitUsd":null,"exceedsLimit":false\}/);
    // Money is BigDecimal with scale 4.
    expect(r.text).toMatch(/"totalUsd":\d+\.\d{4}\}/);
    const viaQuery = await call('get', `/v1/staff/kb/costs/forecast?settings=${encodeURIComponent('{"modelWrite":"anthropic-claude-haiku-4.5"}')}`, null, 200);
    expect(viaQuery.json.nextRun.perStage.WRITE.mode).toBe('batch');
    expect(viaQuery.json.settingsHash).not.toBe(f.settingsHash);
    const bad = await call('get', '/v1/staff/kb/costs/forecast?settings=%7Bnope', null, 400);
    expect(bad.json.message).toBe("Validation failed for field 'settings' with value '{nope': not valid JSON");
    // No body: the current settings.
    const empty = await api.post('/v1/staff/kb/costs/forecast', { as: await staff() });
    expect(empty.status).toBe(200);
    expect(empty.json.settingsHash).toBe(f.settingsHash);
    const stage = await call('get', '/v1/staff/kb/models/glm-5.3/stage-cost?stage=plan', null, 200);
    expect(Object.keys(stage.json)).toEqual(['stage', 'model', 'mode', 'expectedWeeklyUsd', 'low', 'high', 'basis']);
    expect(stage.json.mode).toBe('sync');
    const badStage = await call('get', '/v1/staff/kb/models/glm-5.3/stage-cost?stage=link', null, 400);
    expect(badStage.json.message).toBe("Validation failed for field 'stage' with value 'link': must be digest, plan, write or retry");
    const missing = await call('get', '/v1/staff/kb/models/glm-5.3/stage-cost', null, 400);
    expect(missing.json.error).toBe('BadRequest');
    expect(missing.json.message).toBe("Required request parameter 'stage' for method parameter type String is not present");
  });

  test('weeklyHistoryIsTheMedianRunRepricedTimesTheCronFiresPerWeek', async () => {
    // Three completed scheduled runs (plus noise the history ignores), each with usage rows.
    const runs: [string, string, string, number][] = [
      ['00000000-0000-0000-0000-0000000000a1', 'SUCCEEDED', 'SCHEDULED', 1000],
      ['00000000-0000-0000-0000-0000000000a2', 'PARTIAL', 'SCHEDULED', 3000],
      ['00000000-0000-0000-0000-0000000000a3', 'SUCCEEDED', 'SCHEDULED', 2000],
      ['00000000-0000-0000-0000-0000000000a4', 'FAILED', 'SCHEDULED', 9000],
      ['00000000-0000-0000-0000-0000000000a5', 'SUCCEEDED', 'MANUAL', 9000],
    ];
    let day = 1;
    for (const [id, status, trigger, tokens] of runs) {
      await api.db`INSERT INTO wiki.kb_run (id, status, trigger, started_at) VALUES (${id}, ${status}, ${trigger}, now() - make_interval(days => ${day++}))`;
      await api.db`INSERT INTO wiki.kb_llm_usage (id, created_at, run_id, model, mode, stage, subject_id, input_tokens, cached_input_tokens, output_tokens, cost_usd)
                   VALUES (gen_random_uuid(), now() - interval '40 days', ${id}, 'glm-5.3', 'SYNC', 'WRITE', '61.12', ${tokens * 100}, 0, ${tokens}, 0)`;
    }
    const weekly = async (cron: string) => {
      const r = await call('post', '/v1/staff/kb/costs/forecast', { cron }, 200);
      return r.json.weekly;
    };
    const daily = await weekly('0 0 3 * * *');
    expect(daily.basis).toBe('history');
    expect(daily.runsUsed).toBe(3);
    const once = await weekly('0 0 3 * * SUN');
    expect(Number(daily.expectedUsd)).toBeCloseTo(Number(once.expectedUsd) * 7, 3);
    const weekdays = await weekly('0 0 3 * * MON-FRI');
    expect(Number(weekdays.expectedUsd)).toBeCloseTo(Number(once.expectedUsd) * 5, 3);
    // Spring matches day-of-month AND day-of-week: Mondays only, not every day.
    const both = await weekly('0 0 3 1-31 * MON');
    expect(both.expectedUsd).toBe(once.expectedUsd);
    const invalid = await weekly('nope');
    expect(invalid.expectedUsd).toBe(once.expectedUsd);
    const f = await call('get', '/v1/staff/kb/costs/forecast', null, 200);
    expect(Object.keys(f.json.savings)).toEqual(['batchUsd', 'cacheUsd']);
    expect(Object.keys(f.json.fullRebuild)).toEqual(['inputTokens', 'outputTokens', 'costUsd']);
  });

  test('modelListShape', async () => {
    const r = await call('get', '/v1/staff/kb/models', null, 200);
    const ids = (r.json as any[]).map((m) => m.id);
    expect(ids).toEqual([...ids].sort());
    const haiku = (r.json as any[]).find((m) => m.id === 'anthropic-claude-haiku-4.5');
    expect(Object.keys(haiku)).toEqual(['id', 'displayName', 'provider', 'batchSupported', 'batchSource', 'batchVerifiedAt',
      'batchDiscountVerified', 'toolCalling', 'supportsReasoningEffort', 'enabled', 'inputPerM', 'outputPerM', 'cacheReadPerM',
      'batchDiscount', 'effectivePrices', 'contextWindow', 'maxOutputTokens', 'notes', 'pricesUpdatedAt', 'priceSource',
      'lastProbe', 'selectable', 'emptyToolCallRate', 'batchModelId', 'effectiveBatchModelId', 'remoteModelId']);
    expect(haiku.effectiveBatchModelId).toBe('claude-haiku-4.5');
    expect(haiku.selectable).toBe(false);
    const raw = r.text.slice(r.text.indexOf('{"id":"anthropic-claude-haiku-4.5"'));
    expect(raw).toMatch(/^\{"id":"anthropic-claude-haiku-4.5","displayName":"[^"]+","provider":"anthropic","batchSupported":true,"batchSource":"rule","batchVerifiedAt":null,"batchDiscountVerified":false,"toolCalling":"[a-z]+","supportsReasoningEffort":(true|false),"enabled":true,"inputPerM":\d+\.\d{4},"outputPerM":\d+\.\d{4},"cacheReadPerM":(null|\d+\.\d{4}),"batchDiscount":0\.500,"effectivePrices":\{"batch":\{"inputPerM":/);
  });

  test('createUpdateAndValidate', async () => {
    // Prices on create: Java saves the price-history rows before the model (FK violation, 409).
    const withPrices = await call('post', '/v1/staff/kb/models', { id: 'kimi-k2.6', inputPerM: 0.6, outputPerM: 2.5 }, 409);
    expect(withPrices.json.error).toBe('DataIntegrityViolation');
    expect(((await call('get', '/v1/staff/kb/models', null, 200)).json as any[]).some((m) => m.id === 'kimi-k2.6')).toBe(false);
    const fresh = await call('post', '/v1/staff/kb/models', { id: 'kimi-k2.6', notes: 'nuevo', contextWindow: 1000 }, 200);
    expect(fresh.json.priceSource).toBeNull();
    expect(fresh.json.pricesUpdatedAt).toBeNull();
    expect(fresh.json.notes).toBe('nuevo');
    expect(fresh.text).toContain('"inputPerM":null,"outputPerM":null,"cacheReadPerM":null,"batchDiscount":0.5,');
    const created = await call('put', '/v1/staff/kb/models/kimi-k2.6', { inputPerM: 0.6, outputPerM: 2.5 }, 200);
    expect(created.json.displayName).toBe('kimi-k2.6');
    expect(created.json.provider).toBe('do');
    expect(created.json.enabled).toBe(true);
    expect(created.json.priceSource).toBe('manual');
    expect(created.json.pricesUpdatedAt).toMatch(ISO_ART);
    expect(created.text).toContain('"inputPerM":0.6,"outputPerM":2.5,"cacheReadPerM":null,"batchDiscount":0.500,');
    expect(created.text).toContain('"effectivePrices":{"batch":null,"sync":{"inputPerM":0.6,"outputPerM":2.5,"cacheReadPerM":null}}');
    const listed = ((await call('get', '/v1/staff/kb/models', null, 200)).json as any[]).find((m) => m.id === 'kimi-k2.6');
    expect(listed.pricesUpdatedAt).toMatch(ISO_Z);
    const listedText = (await call('get', '/v1/staff/kb/models', null, 200)).text;
    expect(listedText).toContain('"id":"kimi-k2.6","displayName":"kimi-k2.6","provider":"do","batchSupported":false,"batchSource":"rule","batchVerifiedAt":null,"batchDiscountVerified":false,"toolCalling":"unknown","supportsReasoningEffort":false,"enabled":true,"inputPerM":0.6000,"outputPerM":2.5000,"cacheReadPerM":null,"batchDiscount":0.500,');
    const [hist] = await api.db`SELECT count(*)::int AS n FROM wiki.kb_model_price_history WHERE model_id = 'kimi-k2.6' AND source = 'manual'`;
    expect(hist!.n).toBe(2);

    const dup = await call('post', '/v1/staff/kb/models', { id: 'kimi-k2.6' }, 409);
    expect(dup.json.message).toBe("KbModel with identifier 'kimi-k2.6' already exists");
    expect((await call('post', '/v1/staff/kb/models', { id: '' }, 400)).json.message)
      .toBe("Validation failed for field 'id' with value '': required (max 128 chars)");
    expect((await call('post', '/v1/staff/kb/models', { id: 'a/b' }, 400)).json.message)
      .toBe("Validation failed for field 'id' with value 'a/b': only letters, digits and . _ : - (it goes in URL paths)");
    expect((await call('post', '/v1/staff/kb/models', { id: 'custom:x:y' }, 400)).json.message)
      .toBe("Validation failed for field 'id' with value 'custom:x:y': custom:* ids are created by discovering an endpoint's models");
    expect((await call('post', '/v1/staff/kb/models', { id: 'glm-9' }, 200)).json.supportsReasoningEffort).toBe(true);
    const oai = (await call('post', '/v1/staff/kb/models', { id: 'openai-gpt-9', displayName: 'GPT 9' }, 200)).json;
    expect(oai.provider).toBe('openai');
    expect(oai.batchSupported).toBe(true);
    expect(oai.effectiveBatchModelId).toBe('gpt-9');

    const upd = await call('put', '/v1/staff/kb/models/kimi-k2.6', {
      displayName: 'Kimi', batchDiscount: 0.4, batchDiscountVerified: true, toolCalling: 'YES', contextWindow: 128000,
      batchModelId: '  kimi  ', enabled: false,
    }, 200);
    expect(upd.json.displayName).toBe('Kimi');
    expect(upd.json.toolCalling).toBe('yes');
    expect(upd.json.batchModelId).toBe('kimi');
    expect(upd.json.effectiveBatchModelId).toBeNull();
    expect(upd.text).toContain('"inputPerM":0.6000,"outputPerM":2.5000,"cacheReadPerM":null,"batchDiscount":0.4,');
    expect(upd.json.priceSource).toBe('manual');
    expect((await call('put', '/v1/staff/kb/models/kimi-k2.6', { toolCalling: 'maybe' }, 400)).json.message)
      .toBe("Validation failed for field 'toolCalling' with value 'maybe': must be unknown, yes or no");
    expect((await call('put', '/v1/staff/kb/models/kimi-k2.6', { batchDiscount: 2 }, 400)).json.message)
      .toBe("Validation failed for field 'batchDiscount' with value '2': must be between 0 and 1");
    expect((await call('put', '/v1/staff/kb/models/kimi-k2.6', { inputPerM: 'x' }, 400)).json.message)
      .toBe("Validation failed for field 'inputPerM' with value '\"x\"': must be a number");
    expect((await call('put', '/v1/staff/kb/models/kimi-k2.6', { inputPerM: -1 }, 400)).json.message)
      .toBe("Validation failed for field 'inputPerM' with value '-1': must be >= 0");
    expect((await call('put', '/v1/staff/kb/models/nope', {}, 404)).json.message)
      .toBe("KbModel with identifier 'nope' not found");
    const batchOff = await call('put', '/v1/staff/kb/models/anthropic-claude-haiku-4.5', { batchSupported: false }, 200);
    expect(batchOff.json.batchSupported).toBe(false);
    expect(batchOff.json.effectivePrices.batch).toBeNull();
  });

  test('probeRecordsTheResultInTheCatalog', async () => {
    // The jar's fake sync client has no scripted answer: the probe fails, and says so.
    const r = await call('post', '/v1/staff/kb/models/glm-5.3/probe', null, 200);
    const p = r.json.lastProbe;
    expect(p.ok).toBe(false);
    expect(p.mode).toBe('sync');
    expect(p.sync.mode).toBe('sync');
    expect(typeof p.latencyMs).toBe('number');
    expect(p.at).toMatch(ISO_ART);
    expect(r.json.selectable).toBe(false);
    expect((await call('post', '/v1/staff/kb/models/glm-5.3/probe?mode=turbo', null, 400)).json.message)
      .toBe("Validation failed for field 'mode' with value 'turbo': must be batch or sync");
    expect((await call('post', '/v1/staff/kb/models/glm-5.3/probe?mode=batch', null, 400)).json.message)
      .toBe("Validation failed for field 'mode' with value 'batch': DO batches only take anthropic-*/openai-* models");
    expect((await call('post', '/v1/staff/kb/models/nope/probe', null, 404)).json.error).toBe('ResourceNotFound');
    expect((await call('post', '/v1/staff/kb/pipeline/probe', {}, 400)).json.message)
      .toBe("Validation failed for field 'model' with value 'null': required");
    const viaPipeline = await call('post', '/v1/staff/kb/pipeline/probe', { model: 'glm-5.3-flash', mode: 'sync' }, 200);
    expect(viaPipeline.json.id).toBe('glm-5.3-flash');
    expect(viaPipeline.json.lastProbe.mode).toBe('sync');
  });
});
