// Port of apps/api/src/test/java/org/ceitba/api/web/kb/pipeline/BatchPipelineIT.java (in process,
// see contract/IN-PROCESS.md): the KbPipelineAcceptanceIT tests against the batch executor
// (anthropic model, KB_EXECUTION_MODE=batch), plus its own two.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { acceptanceTests } from './acceptance';
import { Acceptance, FIN } from './support';

const a = new Acceptance({
  KB_EXECUTION_MODE: 'batch',
  KB_MODEL_DIGEST: 'anthropic-claude-haiku-4.5',
  KB_MODEL_PLAN: 'anthropic-claude-haiku-4.5',
  KB_MODEL_WRITE: 'anthropic-claude-haiku-4.5',
  // Two requests per batch file: the 3 DIGEST requests become two batch jobs.
  KB_BATCH_MAX_REQUESTS: '2',
});

beforeAll(() => a.start(), 60_000);
afterAll(() => a.close());

describe('BatchPipelineIT', () => {
  beforeEach(() => a.seed());

  acceptanceTests(a, 'BATCH');

  // A restart while batches are in flight: the run waits, then resumes from the
  // stored state without resubmitting anything.
  test('waitsForBatchesAndResumes', async () => {
    a.fakeBatch().hold(true);
    const run = await a.run();
    expect(run.status).toBe('WAITING');
    const submitted = a.fakeBatch().submitted().length;
    await a.kb().engine.advanceActive(); // still in progress: nothing new
    expect(a.fakeBatch().submitted()).toHaveLength(submitted);
    a.fakeBatch().hold(false);
    a.fakeBatch().release();
    for (let i = 0; i < 6; i++) await a.kb().engine.advanceActive();
    const done = await a.get(run.id);
    expect(done.status, JSON.stringify(done)).toBe('SUCCEEDED');
    expect(await a.publishedSlugs(FIN)).toEqual(['conceptos-centrales']);
  });

  // A stage over KB_BATCH_MAX_REQUESTS is split into several batch jobs (one DO batch
  // each, distinct request ids) and the run still completes.
  test('stageOverTheBatchCapIsSplitIntoSeveralBatches', async () => {
    const run = await a.run();
    const id = run.id;
    expect(run.status, JSON.stringify(run)).toBe('SUCCEEDED');
    const parts = (await a.sql`SELECT part FROM wiki.kb_batch_job WHERE run_id = ${id}::uuid AND stage = 'DIGEST' ORDER BY part`)
      .map((r) => Number(r.part));
    expect(parts).toEqual([1, 2]);
    expect((await a.sql`SELECT request_count FROM wiki.kb_batch_job WHERE run_id = ${id}::uuid AND stage = 'DIGEST' ORDER BY part`)
      .map((r) => Number(r.request_count))).toEqual([2, 1]);
    expect(await a.sql`SELECT DISTINCT do_request_id FROM wiki.kb_batch_job WHERE run_id = ${id}::uuid AND stage = 'DIGEST'`)
      .toHaveLength(2);
  });
});
