// Port of apps/api/src/test/java/org/ceitba/api/web/kb/pipeline/SyncPipelineIT.java (in process,
// see contract/IN-PROCESS.md): the KbPipelineAcceptanceIT tests against the sync executor
// (GLM models, chat completions, KB_EXECUTION_MODE=sync), plus its own six.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { odtFromMicros } from '../../src/features/kb/logic/odt';
import { MAX_RESUMES } from '../../src/features/kb-pipeline/engine';
import { inTx } from '../../src/features/kb-pipeline/db/session';
import { runs } from '../../src/features/kb-pipeline/db/repo';
import { systemNowMicros } from '../../src/lib/time';
import { acceptanceTests } from './acceptance';
import { Acceptance, CONT, FIN } from './support';

const a = new Acceptance({ KB_EXECUTION_MODE: 'sync' });

beforeAll(() => a.start(), 60_000);
afterAll(() => a.close());

describe('SyncPipelineIT', () => {
  beforeEach(() => a.seed());

  acceptanceTests(a, 'SYNC');

  // Models that ignore tool_choice: the json_object fallback still yields pages.
  test('jsonObjectFallback', async () => {
    a.fakeSync().proseUnlessJsonObject(true);
    const run = await a.run();
    expect(run.status, JSON.stringify(run)).toBe('SUCCEEDED');
    expect(await a.publishedSlugs(FIN)).toEqual(['conceptos-centrales']);
  });

  // Every HTTP call is a usage row with its attempt number and latency; the run's
  // progress is complete.
  test('usageRowsCarryAttemptAndLatency', async () => {
    const run = await a.run();
    expect(await a.count(a.sql`SELECT count(*) AS n FROM wiki.kb_llm_usage WHERE latency_ms IS NULL`)).toBe(0);
    expect((await a.sql`SELECT DISTINCT attempt FROM wiki.kb_llm_usage`).map((r) => Number(r.attempt))).toEqual([1]);
    expect(await a.count(a.sql`SELECT count(*) AS n FROM wiki.kb_run_request WHERE status = 'DONE'
      AND (completed_at IS NULL OR latency_ms IS NULL)`)).toBe(0);
    const p = a.json(await a.kb().pipeline.progress(run.id));
    expect(p.overall.percent).toBe(100.0);
    expect(p.stages[0].mode).toBe('sync');
    expect(run.progress.current).toBe('Terminado');
    // Stage transitions were logged into stage_log.
    const [log] = await a.sql`SELECT stage_log::text AS l FROM wiki.kb_run WHERE id = ${run.id}::uuid`;
    expect(String(log!.l)).toContain('DIGEST');
    expect(String(log!.l)).toContain('finishedAt');
  });

  // One advancer per run: a second lease is refused until released or expired.
  test('runLeaseGuardsDoubleAdvancement', async () => {
    const id = (await a.run()).id as string;
    const db = a.t.deps.db;
    const now = odtFromMicros(systemNowMicros());
    const takeA = () => inTx(db, () => runs.takeLease(id, 'a', now.plusMinutes(3), now));
    const takeB = () => inTx(db, () => runs.takeLease(id, 'b', now.plusMinutes(3), now));
    expect(await takeA()).toBe(1);
    expect(await takeB()).toBe(0);
    expect(await takeA()).toBe(1); // renewal by the holder
    await inTx(db, () => runs.releaseLease(id, 'a'));
    expect(await takeB()).toBe(1);
    // An expired lease can be taken over.
    const later = now.plusMinutes(10);
    expect(await inTx(db, () => runs.takeLease(id, 'c', later.plusMinutes(3), later))).toBe(1);
    await inTx(db, () => runs.releaseLease(id, 'c'));
    expect(await a.kb().engine.advance(id)).toBe(true); // free again: advances (nothing to do)
  });

  // Reasoning effort reaches the wire for GLM (supportsReasoningEffort).
  test('reasoningEffortIsSent', async () => {
    await a.run();
    const received = a.fakeSync().received();
    expect(received.length).toBeGreaterThan(0);
    for (const r of received) expect(['low', 'medium']).toContain((r.raw as Record<string, unknown>).reasoning_effort as string);
  });

  // Hard cap on requests per stage (default 5000), whatever the token budget: 6000 tiny
  // files in two subjects build one subject's DIGEST requests only, the other is
  // deferred to the next run. Dry, so nothing is sent.
  test('requestCapDefersSubjectsThatDoNotFit', async () => {
    for (const subject of [FIN, CONT]) {
      await a.sql`INSERT INTO wiki.drive_file (id, source_id, drive_id, name, mime_type, kind, owned_by_sharer,
          subject_id, effective_subject_id, publication, text_content, content_fingerprint)
        SELECT gen_random_uuid(), ${a.source}, 'bulk-' || ${subject} || i, 'f' || i || '.pdf', 'application/pdf', 'PDF', true,
          ${subject}, ${subject}, 'PUBLISHED', repeat('x ', 110) || ${subject} || i, 'bulk-fp-' || ${subject} || i
        FROM generate_series(1, 3000) i`;
    }
    const started = await a.kb().pipeline.trigger('MANUAL', true);
    await a.kb().engine.advanceActive();
    const id = started.id;
    const n = await a.count(a.sql`SELECT count(*) AS n FROM wiki.kb_run_request WHERE run_id = ${id}::uuid AND stage = 'DIGEST'`);
    expect(n).toBeGreaterThanOrEqual(3000);
    expect(n).toBeLessThanOrEqual(5000);
    const statuses = (await a.sql`SELECT status FROM wiki.kb_run_subject WHERE run_id = ${id}::uuid`).map((r) => r.status);
    expect(statuses.filter((s) => s === 'DEFERRED')).toHaveLength(1);
    expect(a.llmRequests()).toHaveLength(0);
  }, 120_000);

  // A RUNNING run resumed by more than 3 startups inside the window without finishing a
  // stage is failed instead of resumed into another crash.
  test('resumeLoopGuardFailsTheRunAfterRepeatedRestarts', async () => {
    const started = await a.kb().pipeline.trigger('MANUAL', false);
    const id = started.id;
    for (let i = 1; i <= MAX_RESUMES; i++) expect(await a.kb().engine.registerResume(id), `resume ${i}`).toBe(true);
    expect(await a.kb().engine.registerResume(id)).toBe(false);
    const run = await a.get(id);
    expect(run.status).toBe('FAILED');
    expect(run.error).toContain('detenida tras reinicios repetidos');
    expect(await a.kb().engine.activeRunIds()).not.toContain(id);
  });
});
