// TS-only checks of behaviour the Java ITs do not exercise but docs/SUBJECT-WIKI-PIPELINE.md
// specifies (no Java counterpart): the weekly schedule tick (KbPipelineService.schedulerTick),
// cancel (KbRunEngine.cancel), the weekly cost limit and approve-cost, and the payload
// retention (KbRunRetentionService.purgeExpired).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { MutableClock } from '../../src/infra/clock';
import { Acceptance, FIN } from './support';

const clock = new MutableClock();
const a = new Acceptance({
  KB_EXECUTION_MODE: 'batch',
  KB_MODEL_DIGEST: 'anthropic-claude-haiku-4.5',
  KB_MODEL_PLAN: 'anthropic-claude-haiku-4.5',
  KB_MODEL_WRITE: 'anthropic-claude-haiku-4.5',
}, { clock });

beforeAll(() => a.start(), 60_000);
afterAll(() => a.close());

async function settings(json: string): Promise<void> {
  await a.sql.unsafe(`INSERT INTO wiki.kb_pipeline_settings (id, settings, updated_at) VALUES (1, '${json}'::jsonb, now())
    ON CONFLICT (id) DO UPDATE SET settings = EXCLUDED.settings`);
}

describe('KbPipeline engine extras', () => {
  beforeEach(async () => {
    clock.set(new Date());
    await a.seed();
  });

  test('schedulerTickFiresOnceAtTheWeeklyTime', async () => {
    await settings('{"enabled": true, "cron": "0 0 3 * * SUN"}');
    const scheduled = async () => Number((await a.sql`SELECT count(*) AS n FROM wiki.kb_run WHERE trigger = 'SCHEDULED'`)[0]!.n);
    clock.set('2026-10-25T05:59:30Z'); // Sunday 02:59:30 ART
    await a.kb().pipeline.schedulerTick();
    expect(await scheduled()).toBe(0);
    clock.set('2026-10-25T06:00:30Z'); // 03:00:30: the cron fired since the last check
    await a.kb().pipeline.schedulerTick();
    expect(await scheduled()).toBe(1);
    clock.set('2026-10-25T06:01:30Z');
    await a.kb().pipeline.schedulerTick();
    expect(await scheduled()).toBe(1);
  });

  test('cancelStopsOpenBatchesJobsAndSubjects', async () => {
    a.fakeBatch().hold(true);
    const run = await a.run();
    expect(run.status).toBe('WAITING');
    const cancelled = a.json(await a.kb().pipeline.cancel(run.id));
    expect(cancelled.status).toBe('CANCELLED');
    expect(a.fakeBatch().cancelled().length).toBeGreaterThan(0);
    const jobs = (await a.sql`SELECT DISTINCT status FROM wiki.kb_batch_job WHERE run_id = ${run.id}::uuid`).map((r) => r.status);
    expect(jobs).toEqual(['CANCELLED']);
    const subjects = (await a.sql`SELECT DISTINCT status FROM wiki.kb_run_subject WHERE run_id = ${run.id}::uuid`).map((r) => r.status);
    expect(subjects).toEqual(['CANCELLED']);
    await expect(a.kb().pipeline.cancel(run.id)).rejects.toMatchObject({ code: 'KB_RUN_NOT_ACTIVE' });
  });

  test('weeklyCostLimitBlocksUntilApproved', async () => {
    await settings('{"weeklyCostLimitUsd": 0.000001}');
    const run = await a.run();
    expect(run.status).toBe('BLOCKED_BY_COST_LIMIT');
    // The stored double 0.000001 is read back as BigDecimal.valueOf(1.0E-6) = 0.0000010, as in Java.
    expect(run.error).toContain('exceeds the weekly limit US$0.0000010; approve with approve-cost');
    expect(a.llmRequests()).toHaveLength(0);
    const approved = a.json(await a.kb().pipeline.approveCost(run.id));
    expect(approved.status).toBe('RUNNING');
    expect(approved.costApproved).toBe(true);
    await a.kb().engine.advanceActive();
    expect((await a.get(run.id)).status).toBe('SUCCEEDED');
    expect(await a.publishedSlugs(FIN)).toEqual(['conceptos-centrales']);
    await expect(a.kb().pipeline.approveCost(run.id)).rejects.toMatchObject({ code: 'KB_RUN_NOT_BLOCKED' });
  });

  test('retentionDeletesThePayloadsOfOldFinishedJobs', async () => {
    const run = await a.run();
    expect(run.status).toBe('SUCCEEDED');
    expect(a.payloadKeys(run.id).length).toBeGreaterThan(0);
    expect(await a.kb().retention.purgeExpired()).toBe(0); // too recent
    await a.sql`UPDATE wiki.kb_batch_job SET created_at = now() - interval '31 days' WHERE run_id = ${run.id}::uuid`;
    const jobs = Number((await a.sql`SELECT count(*) AS n FROM wiki.kb_batch_job WHERE run_id = ${run.id}::uuid`)[0]!.n);
    expect(await a.kb().retention.purgeExpired()).toBe(jobs);
    expect(a.payloadKeys(run.id)).toEqual([]);
    const left = Number((await a.sql`SELECT count(*) AS n FROM wiki.kb_batch_job WHERE run_id = ${run.id}::uuid
      AND (payload_key IS NOT NULL OR output_key IS NOT NULL)`)[0]!.n);
    expect(left).toBe(0);
  });
});
