// Port of apps/api/src/test/java/org/ceitba/api/web/kb/pipeline/KbAdminEvalIT.java (in process, see
// contract/IN-PROCESS.md): the tests that advance an eval with the fake executors
// (engine.advanceActive, a held batch), the half of the model sync that scripts DO's
// catalog items, and the KbPipelineAcceptanceIT tests it inherits (default env: auto
// mode, GLM models run sync). The black-box tests of the same IT are
// contract/tests/kb-admin-{settings,models,costs}.contract.test.ts. Requests go through the
// staff routes, like MockMvc with staff().

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mintJwt, seedStaff, seedUser } from '../../contract/support/identity';
import type { FakeDoModelCatalog } from '../../src/external/llm';
import { acceptanceTests } from '../kb-pipeline/acceptance';
import { Acceptance, CONT, FIN, text } from '../kb-pipeline/support';

const a = new Acceptance();
let staff: Record<string, string>;

beforeAll(async () => {
  await a.start();
  staff = { Authorization: `Bearer ${await mintJwt({ email: 'staff@itba.edu.ar', name: 'Staff' })}` };
}, 60_000);
afterAll(() => a.close());

async function call(method: string, path: string, body: unknown, expected: number): Promise<any> {
  const r = await a.t.request(method, path, { headers: staff, body: body ?? undefined });
  expect(r.status, `${method} ${path}: ${r.text}`).toBe(expected);
  return r.text === '' ? null : r.json;
}

async function probed(...models: string[]) {
  for (const m of models) {
    await a.sql`UPDATE wiki.kb_model SET last_probe = '{"ok":true,"mode":"sync","toolCalling":"yes"}'::jsonb WHERE id = ${m}`;
  }
}

describe('KbAdminEvalIT', () => {
  beforeEach(async () => {
    await a.seed();
    // MockMvc's jwt() named "Staff" with ROLE_STAFF: a real staff row (the seed truncates users).
    await seedUser(a.sql, 'staff@itba.edu.ar', { name: 'Staff' });
    await seedStaff(a.sql, 'staff@itba.edu.ar');
  });

  acceptanceTests(a, 'SYNC');

  test('modelSyncTakesPricesFromDoCatalogWithoutClobberingProbesOrManualFields', async () => {
    // The catalog rows are shared by every test of this app: restored afterwards.
    await a.sql`DROP TABLE IF EXISTS wiki.kb_model_backup`;
    await a.sql`CREATE TABLE wiki.kb_model_backup AS SELECT * FROM wiki.kb_model`;
    try {
      await syncScenario();
    } finally {
      await a.sql`DELETE FROM wiki.kb_model`;
      await a.sql`INSERT INTO wiki.kb_model SELECT * FROM wiki.kb_model_backup`;
      await a.sql`DROP TABLE wiki.kb_model_backup`;
      await a.sql`DELETE FROM wiki.kb_pipeline_settings`;
    }
  });

  async function syncScenario() {
    const fake = a.t.deps.llm.catalog as FakeDoModelCatalog;
    // Unreachable catalog: falls back to /v1/models ids.
    fake.items(null);
    expect((await call('POST', '/v1/staff/kb/models/sync', null, 200)).source).toBe('inference-models');

    const root = JSON.parse(readFileSync(join(import.meta.dir, '../kb/fixtures/do-model-catalog.json'), 'utf8'));
    fake.items(root.data);
    // Probe verdicts and manual fields that a sync must keep.
    await a.sql`UPDATE wiki.kb_model SET input_per_m = 9, batch_supported = false, batch_source = 'probe', batch_discount = 0.4,
      enabled = true, tool_calling = 'no', last_probe = '{"ok":false,"mode":"batch"}'::jsonb WHERE id = 'anthropic-claude-haiku-4.5'`;
    await call('PUT', '/v1/staff/kb/models/glm-5.3', { displayName: 'GLM grande' }, 200);
    await a.sql`UPDATE wiki.kb_model SET input_per_m = 2.0 WHERE id = 'glm-5.3'`;

    const res = await call('POST', '/v1/staff/kb/models/sync', null, 200);
    expect(res.source).toBe('do-catalog');
    expect(String(res.fetchedAt).trim()).not.toBe('');
    expect(JSON.stringify(res.added)).toContain('kimi-k2.6');
    expect(JSON.stringify(res.added)).not.toContain('dedicated-only-x');
    expect(JSON.stringify(res.added)).not.toContain('some-embedding');
    expect(JSON.stringify(res.notInCatalog)).toContain('anthropic-claude-sonnet-5.5');
    const glmUpdate = res.updated.find((u: any) => u.id === 'glm-5.3');
    expect(JSON.stringify(glmUpdate)).toContain('"field":"inputPerM"');
    expect(JSON.stringify(glmUpdate)).toContain('"old":"2"');
    expect(JSON.stringify(glmUpdate)).toContain('"new":"1.4"');

    const models = await call('GET', '/v1/staff/kb/models', null, 200);
    for (const m of models) {
      if (m.id === 'glm-5.3') {
        expect(Number(m.inputPerM)).toBe(1.4);
        expect(m.displayName).toBe('GLM grande'); // manual kept
        expect(m.priceSource).toBe('do-catalog');
        expect(m.maxOutputTokens).toBe(128000);
      } else if (m.id === 'anthropic-claude-haiku-4.5') {
        expect(Number(m.inputPerM)).toBe(1);
        expect(m.batchSupported).toBe(false);
        expect(m.batchSource).toBe('probe');
        expect(Number(m.batchDiscount)).toBe(0.4);
        expect(m.enabled).toBe(true);
        expect(m.toolCalling).toBe('no'); // probe wins over hints
      } else if (m.id === 'kimi-k2.6') {
        expect(m.enabled).toBe(false);
        expect(Number(m.outputPerM)).toBe(2.5);
        expect(m.batchSupported).toBe(false);
      }
    }
    const [h] = await a.sql`SELECT count(*)::int AS n FROM wiki.kb_model_price_history WHERE model_id = 'glm-5.3' AND field = 'inputPerM' AND source = 'do-catalog'`;
    expect(h!.n).toBe(1);
    // A second sync changes nothing.
    const again = await call('POST', '/v1/staff/kb/models/sync', null, 200);
    expect(again.updated).toEqual([]);
    expect(again.unchanged).toBeGreaterThan(0);
    // The weekly refresh is a setting.
    const s = await call('PUT', '/v1/staff/kb/settings', { autoRefreshPrices: false }, 200);
    expect(s.settings.autoRefreshPrices).toBe(false);
    expect(s.source.autoRefreshPrices).toBe('db');
  }

  test('cancellingAnEvalCascades', async () => {
    await probed('anthropic-claude-haiku-4.5', 'glm-5.3', 'glm-5.3-flash');
    const set = await call('POST', '/v1/staff/kb/evals/sets', { name: 'Cancelar', subjectIds: [FIN, CONT] }, 201);
    // The haiku config runs through a batch that stays in progress.
    a.fakeBatch().hold(true);
    const models = [{ plan: 'glm-5.3', write: 'glm-5.3' }, { plan: 'anthropic-claude-haiku-4.5', write: 'anthropic-claude-haiku-4.5' }];
    const ev = await call('POST', '/v1/staff/kb/evals', { setId: set.id, models }, 202);
    const id = ev.id;
    for (let i = 0; i < 3; i++) await a.kb().engine.advanceActive();
    const waiting = await call('GET', `/v1/staff/kb/evals/${id}`, null, 200);
    expect(waiting.status).toBe('WAITING');
    const progress = await call('GET', `/v1/staff/kb/evals/${id}/progress`, null, 200);
    expect(JSON.stringify(progress)).toContain('waiting_batch');

    const cancelled = await call('POST', `/v1/staff/kb/evals/${id}/cancel`, null, 200);
    expect(cancelled.status).toBe('CANCELLED');
    for (const c of cancelled.configs) {
      expect(c.status).toBe('CANCELLED');
      for (const s of c.perSubject) expect(s.status).toBe('cancelled');
    }
    expect(a.fakeBatch().cancelled().length).toBeGreaterThan(0); // DO cancel called for the open batch
    const sent = a.fakeBatch().submitted().length + a.fakeSync().received().length;
    a.fakeBatch().hold(false);
    a.fakeBatch().release();
    await a.kb().engine.advanceActive();
    expect(a.fakeBatch().submitted().length + a.fakeSync().received().length).toBe(sent);
    expect((await call('GET', `/v1/staff/kb/evals/${id}`, null, 200)).status).toBe('CANCELLED');
    expect((await call('GET', `/v1/staff/kb/evals/${id}/progress`, null, 200)).current).toBe('Cancelado');
  });

  test('evalUsesFrozenInputsNeverPublishesAndFeedsTheLeaderboard', async () => {
    await probed('anthropic-claude-haiku-4.5', 'glm-5.3', 'glm-5.3-flash');
    const set = await call('POST', '/v1/staff/kb/evals/sets', { name: 'Prueba', subjectIds: [FIN, CONT] }, 201);
    expect(set.frozenAt).not.toBeNull();
    const setId = set.id;
    // The live text changes after freezing: the eval still reads the frozen copy.
    await a.changeText(a.f1, text('omega'));

    const models = [{ plan: 'glm-5.3', write: 'glm-5.3', reasoningEffort: { plan: 'low', write: 'medium' } },
      { plan: 'anthropic-claude-haiku-4.5', write: 'anthropic-claude-haiku-4.5' }];
    const estimate = await call('POST', '/v1/staff/kb/evals/estimate', { setId, models }, 200);
    expect(Number(estimate.estimatedCostUsd)).toBeGreaterThan(0);

    const ev = await call('POST', '/v1/staff/kb/evals', { setId, models }, 202);
    const evalId = ev.id;
    const early = await call('GET', `/v1/staff/kb/evals/${evalId}/progress`, null, 200);
    expect(early.stages).toHaveLength(7);
    await call('POST', '/v1/staff/kb/evals', { setId, models }, 409);
    for (let i = 0; i < 5; i++) await a.kb().engine.advanceActive();

    const done = await call('GET', `/v1/staff/kb/evals/${evalId}`, null, 200);
    expect(done.status, JSON.stringify(done)).toBe('SUCCEEDED');
    expect(done.configs).toHaveLength(2);
    const keys = new Set<string>();
    for (const c of done.configs) {
      keys.add(c.configKey);
      expect(c.metrics.validPages, JSON.stringify(c)).toBe(2);
      expect('emptyToolCallRate' in c.metrics).toBe(true);
      expect('unsupportedClaimsRate' in c.metrics).toBe(true);
      expect(c.perSubject).toHaveLength(2);
    }
    for (const c of done.configs) {
      expect(c.progress.percent).toBe(100.0);
      for (const s of c.perSubject) {
        expect(s.status).toBe('done');
        expect(s.pagesPlanned).toBe(1);
        expect(s.pagesWritten).toBe(1);
        expect(s.pagesValid).toBe(1);
      }
    }
    expect(done.progress.overall.percent).toBe(100.0);
    expect(done.progress.current).toBe('Terminado');
    expect(done.reviewSummary.totalPairs).toBe(2);
    expect(done.reviewSummary.confident).toBe(false);
    expect(keys).toEqual(new Set(['glm-5.3@low|glm-5.3@medium', 'anthropic-claude-haiku-4.5|anthropic-claude-haiku-4.5']));
    // Never published; pages stored under kb/evals/<evalId>/.
    expect((await a.sql`SELECT count(*)::int AS n FROM wiki.kb_page`)[0]!.n).toBe(0);
    expect(a.storage.keys().some((k) => k.startsWith(`kb/evals/${evalId}/`) && k.endsWith('.md'))).toBe(true);
    // Frozen text, not the live one.
    const sent = a.llmRequests().map((r) => r.userText).join('');
    expect(sent).toContain('alfapalabra1 ');
    expect(sent).not.toContain('omegapalabra1 ');
    expect((await a.sql`SELECT DISTINCT stage FROM wiki.kb_llm_usage`).map((r) => r.stage)).toEqual(['EVAL']);
    const modes = (await a.sql`SELECT DISTINCT mode FROM wiki.kb_batch_job WHERE run_id = ${evalId}::uuid`).map((r) => r.mode);
    expect(modes).toContain('SYNC');
    expect(modes).toContain('BATCH');

    // Blind review: two pages (one per subject) written by both configs.
    let reviews = 0;
    while (true) {
      const res = await a.t.request('GET', `/v1/staff/kb/evals/${evalId}/review/next`, { headers: staff });
      if (res.status === 204) break;
      expect(res.status, res.text).toBe(200);
      const pair = res.json;
      expect(pair.totalPairs).toBe(2);
      expect(pair.reviewedByMe).toBe(reviews);
      expect(pair.a.markdown).toContain('[[file:');
      const src = pair.a.sources[0];
      expect(src.kind).toBe('PDF');
      expect('academicYear' in src && 'academicYearSource' in src && 'author' in src).toBe(true);
      expect(res.text).not.toContain('glm-5.3');
      expect(res.text).not.toContain('haiku');
      const rated = await call('POST', `/v1/staff/kb/evals/${evalId}/review`, {
        subjectId: pair.subjectId, slug: pair.slug, winner: 'A',
        scoresA: { accuracy: 5, clarity: 4, usefulness: 4 }, scoresB: { accuracy: 3, clarity: 3, usefulness: 2 }, comment: 'ok',
      }, 200);
      expect(keys.has(rated.revealed.A.configKey)).toBe(true);
      reviews++;
      expect(reviews).toBeLessThan(5);
    }
    expect(reviews).toBe(2);
    const rp = await call('GET', `/v1/staff/kb/evals/${evalId}/review/progress`, null, 200);
    expect(rp.totalPairs).toBe(2);
    expect(rp.reviewedByMe).toBe(2);
    expect(rp.reviewedByAnyone).toBe(2);
    expect(rp.remainingForMe).toBe(0);
    expect(rp.perSubject).toHaveLength(2);
    expect(rp.perSubject[0].totalPairs).toBe(1);
    expect(String(rp.perSubject[0].subjectName).trim()).not.toBe('');
    expect(rp.ratingsPerConfig).toHaveLength(2);
    for (const c of rp.ratingsPerConfig) {
      expect(c.ratings).toBe(2);
      expect('plan' in c && 'write' in c).toBe(true);
    }
    expect(rp.minRatingsForConfidence).toBe(20);
    expect(rp.confident).toBe(false);

    const board = await call('GET', `/v1/staff/kb/evals/leaderboard?setId=${setId}`, null, 200);
    expect(board.entries).toHaveLength(2);
    let ratings = 0;
    for (const e of board.entries) {
      ratings += e.ratings;
      expect(e.smallSample).toBe(true);
      expect(e.costPerValidPage).not.toBeNull();
    }
    expect(ratings).toBe(4);

    await call('GET', '/v1/staff/kb/costs/summary', null, 200);
    const weekly = await call('GET', '/v1/staff/kb/costs?groupBy=week,stage', null, 200);
    expect(JSON.stringify(weekly)).toContain('EVAL');

    const promoted = await a.t.request('POST', `/v1/staff/kb/evals/${evalId}/promote`, { headers: staff, body: { configKey: 'glm-5.3@low|glm-5.3@medium' } });
    expect(promoted.status, promoted.text).toBe(200);
    expect(promoted.text).toContain('medium');
    expect((await call('GET', '/v1/staff/kb/evals', null, 200)).length).toBeGreaterThan(0);
  });
});
