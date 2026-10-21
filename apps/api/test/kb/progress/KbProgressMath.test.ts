// Port of apps/api/src/test/java/org/ceitba/api/service/kb/progress/KbProgressMathTest.java
import { describe, expect, test } from 'bun:test';
import { Odt } from '../../../src/features/kb/logic/odt';
import { compute, Job, Row, Run, type KbProgressResponse, type Stage } from '../../../src/features/kb/logic/progress/kbProgressMath';

const T0 = Odt.parse('2026-10-03T02:33:36Z');

function run(isEval: boolean, stage: string, status: string, expectedPlan: number): Run {
  return new Run(isEval, stage, status, false, T0, null, {}, expectedPlan, 0, 0, 0, null);
}

function done(stage: string, i: number, latencyMs: number | null): Row {
  return new Row(stage, 'DONE', false, 5000, 'glm-5.3-flash', T0, T0.plusSeconds(16 * (i + 1)), latencyMs, 't' + i, '93.39');
}

function submitted(stage: string, i: number): Row {
  return new Row(stage, 'SUBMITTED', false, 5000, 'glm-5.3-flash', T0, null, null, 't' + i, '93.39');
}

function stage(p: KbProgressResponse, s: string): Stage {
  const st = p.stages.find((x) => x.stage === s);
  if (!st) throw new Error('no stage ' + s);
  return st;
}

describe('KbProgressMathTest', () => {
  test('syncDigestWithEtaFromLatencies', () => {
    const rows: Row[] = [];
    for (let i = 0; i < 7; i++) rows.push(done('DIGEST', i, 16_000));
    for (let i = 7; i < 11; i++) rows.push(submitted('DIGEST', i));
    const jobs = [new Job('DIGEST', 'SYNC', 'SUBMITTED', null, null, null, null, T0, null, null)];
    const now = T0.plusSeconds(120);
    const p = compute(run(true, 'DIGEST', 'RUNNING', 6), rows, jobs, 4, now);

    const digest = stage(p, 'DIGEST');
    expect(digest.status).toBe('running');
    expect(digest.total).toBe(11);
    expect(digest.done).toBe(7);
    expect(digest.inFlight).toBe(4); // capped at the concurrency
    expect(digest.mode).toBe('sync');
    expect(stage(p, 'PLAN').status).toBe('pending');
    expect(stage(p, 'PLAN').total).toBe(6);
    expect(stage(p, 'WRITE').total).toBeNull(); // por determinar
    expect(stage(p, 'PUBLISH').status).toBe('skipped'); // evals never publish
    expect(p.current).toBe('Generando resúmenes de archivos (7/11) con glm-5.3-flash');
    // remaining: 4 digest + 6 plan + 24 write (6 x 4) + 4 retry (15%) = 38; x 16 s / 4 in flight
    expect(p.etaSec).toBe(152);
    expect(p.overall.percent).toBeGreaterThanOrEqual(1.0);
    expect(p.overall.percent).toBeLessThanOrEqual(50.0);
    expect(p.lastActivityAt!.equals(T0.plusSeconds(112))).toBe(true);
    expect(p.stalled).toBe(false);
  });

  test('etaFallsBackToCompletionGapsWithoutLatencies', () => {
    const rows: Row[] = [];
    for (let i = 0; i < 3; i++) rows.push(done('PLAN', i, null)); // 16 s apart
    rows.push(submitted('PLAN', 3));
    const p = compute(run(false, 'PLAN', 'RUNNING', 4), rows, [], 4, T0.plusSeconds(60));
    // remaining: 1 plan + 16 write (4 x 4) + 3 retry = 20, x 16 s gap
    expect(p.etaSec).toBe(320);
  });

  test('rateLimitedBatchCreationWaitsWithRetryTime', () => {
    const rows: Row[] = [];
    for (let i = 0; i < 3; i++) rows.push(submitted('DIGEST', i));
    const retryAt = Odt.parse('2026-10-03T06:41:00Z'); // 03:41 in Buenos Aires
    const jobs = [
      new Job('DIGEST', 'BATCH', 'QUEUED', null, null, null, null, null, null, null, retryAt, 'RATE_LIMITED: POST /v1/batches -> 429: Rate limit exceeded'),
    ];
    const p = compute(run(true, 'DIGEST', 'WAITING', 1), rows, jobs, 4, T0.plusSeconds(60));
    const digest = stage(p, 'DIGEST');
    expect(digest.status).toBe('waiting_batch');
    expect(digest.batch!.status).toBe('QUEUED');
    expect(digest.batch!.nextAttemptAt!.equals(retryAt)).toBe(true);
    expect(p.current.endsWith('DigitalOcean limitó la creación de lotes; reintento a las 03:41')).toBe(true);
  });

  test('partialRunIsFinished', () => {
    const p = compute(
      new Run(true, 'DONE', 'PARTIAL', false, T0, T0.plusSeconds(60), {}, 2, 0, 0, 0, '1 of 2 configurations failed'),
      [],
      [],
      4,
      T0.plusSeconds(120),
    );
    expect(p.current).toBe('Terminado con fallas: 1 of 2 configurations failed');
    expect(p.overall.percent).toBe(100);
  });

  test('batchStageUsesDoRequestCounts', () => {
    const rows: Row[] = [];
    for (let i = 0; i < 10; i++) rows.push(submitted('WRITE', i));
    const jobs = [new Job('WRITE', 'BATCH', 'SUBMITTED', 'in_progress', 10, 6, 1, T0.plusSeconds(10), T0.plusSeconds(3600), null)];
    const p = compute(run(false, 'WRITE', 'WAITING', 2), rows, jobs, 4, T0.plusSeconds(7200));
    const write = stage(p, 'WRITE');
    expect(write.status).toBe('waiting_batch');
    expect(write.done).toBe(6);
    expect(write.failed).toBe(1);
    expect(write.inFlight).toBe(3);
    expect(write.batch!.doStatus).toBe('in_progress');
    expect(write.batch!.requestCounts!.completed).toBe(6);
    expect(p.etaSec).toBeNull();
    expect(p.current).toContain('(7/10)');
    expect(p.current).toContain('esperando el lote');
    expect(p.stalled).toBe(false); // 2 h < 26 h for batch
    expect(stage(p, 'DIGEST').status).toBe('skipped');
    expect(stage(p, 'PLAN').status).toBe('skipped');
  });

  test('syncWithoutActivityForTenMinutesIsStalled', () => {
    const rows = [done('WRITE', 0, 20_000), submitted('WRITE', 1)];
    const p = compute(run(false, 'WRITE', 'RUNNING', 1), rows, [], 4, T0.plusSeconds(16 + 11 * 60));
    expect(p.stalled).toBe(true);
  });

  test('succeededRunIsComplete', () => {
    const rows = [done('DIGEST', 0, 1000), done('PLAN', 1, 1000), done('WRITE', 2, 1000)];
    const r = new Run(false, 'DONE', 'SUCCEEDED', false, T0, T0.plusSeconds(100), {}, 1, 1, 1, 0, null);
    const p = compute(r, rows, [], 4, T0.plusSeconds(200));
    expect(p.overall.percent).toBe(100.0);
    expect(stage(p, 'RETRY').status).toBe('skipped');
    expect(stage(p, 'WRITE').status).toBe('done');
    expect(stage(p, 'LINK').status).toBe('done');
    expect(stage(p, 'PUBLISH').status).toBe('done');
    expect(p.current).toBe('Terminado');
    expect(p.etaSec).toBeNull();
  });

  test('cancelledRunHasNothingInFlight', () => {
    const rows = [done('PLAN', 0, 1000), submitted('PLAN', 1)];
    const p = compute(run(true, 'PLAN', 'CANCELLED', 2), rows, [], 4, T0.plusSeconds(60));
    expect(stage(p, 'PLAN').inFlight).toBe(0);
    expect(stage(p, 'PLAN').status).toBe('failed');
    expect(stage(p, 'WRITE').status).toBe('skipped');
    expect(p.current).toBe('Cancelado');
    expect(p.etaSec).toBeNull();
    expect(p.stalled).toBe(false);
  });

  test('syncInFlightIsCappedAtConcurrency', () => {
    const rows: Row[] = [];
    for (let i = 0; i < 12; i++) rows.push(submitted('WRITE', i));
    const jobs = [new Job('WRITE', 'SYNC', 'SUBMITTED', null, null, null, null, T0, null, null)];
    const p = compute(run(false, 'WRITE', 'RUNNING', 1), rows, jobs, 4, T0.plusSeconds(30));
    expect(stage(p, 'WRITE').inFlight).toBe(4);
    expect(stage(p, 'WRITE').total).toBe(12);
  });
});
