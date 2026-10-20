// Port of apps/api/src/test/java/org/ceitba/api/service/kb/pipeline/KbBatchSubmitterTest.java
// Idempotent DO batch submission and the 429 back-off (no DB: in-memory
// repositories enforcing the (run, stage, attempt, model, part) unique index).
import { beforeEach, describe, expect, test } from 'bun:test';
import { FakeLlmBatchClient, FakeSyncChatClient } from '../../../src/features/kb/logic/external/fakeLlm';
import { LlmApiError } from '../../../src/features/kb/logic/external/llmApi';
import type { JsonObject } from '../../../src/features/kb/logic/jsonNode';
import { BatchLlmExecutor } from '../../../src/features/kb/logic/llm/batchLlmExecutor';
import { KbLlmRouter } from '../../../src/features/kb/logic/llm/kbLlmRouter';
import { kbLlmProperties } from '../../../src/features/kb/logic/llm/kbLlmProperties';
import { backoffMinutes, KbBatchSubmitter, requestId, split } from '../../../src/features/kb/logic/pipeline/kbBatchSubmitter';
import { DuplicateKeyError, noTx, type KbBatchJobStore, type KbModelStore, type KbRunRequestStore, type KbRunStore } from '../../../src/features/kb/logic/ports';
import { KbBatchJob, KbModel, KbRunRequest } from '../../../src/features/kb/logic/types';
import { InMemoryRepo } from '../support/inMemoryRepo';
import { MutableClock } from '../support/mutableClock';

const MODEL = 'openai-gpt-6-luna';
const RATE_LIMIT =
  'POST /v1/batches -> 429: {"error":{"message":"Rate limit exceeded: ' +
  'batch_create_per_minute, batch_creations_per_hour.","type":"rate_limit_exceeded_error"}}';

let fake: FakeLlmBatchClient;
let clock: MutableClock;
let runId: string;
let jobs: InMemoryRepo<KbBatchJob, string>;
let requests: InMemoryRepo<KbRunRequest, string>;
let submitter: KbBatchSubmitter;

const ids = () => [...requests.rows.keys()];

describe('KbBatchSubmitterTest', () => {
  beforeEach(() => {
    fake = new FakeLlmBatchClient();
    clock = new MutableClock('2026-10-03T06:25:45Z');
    runId = crypto.randomUUID();
    jobs = new InMemoryRepo<KbBatchJob, string>((j) => j.id!).beforeSave((j) => {
      if (j.id != null) return j;
      const dup = jobs.all().some(
        (o) => o.runId === j.runId && o.stage === j.stage && o.attempt === j.attempt && o.model === j.model && o.part === j.part,
      );
      if (dup) throw new DuplicateKeyError('kb_batch_job_once_idx');
      j.id = crypto.randomUUID();
      return j;
    });
    requests = new InMemoryRepo<KbRunRequest, string>((r) => r.customId);
    requests.on('submittedIdsOfJob', (a) =>
      requests.all().filter((r) => a[0] === r.batchJobId && r.status === 'SUBMITTED').map((r) => r.customId).sort(),
    );
    requests.on('markSubmitted', (a) => {
      for (const id of a[1] as string[]) requests.rows.get(id)!.submitted(a[0] as string);
      return 0;
    });
    requests.on('failSubmittedOfJob', (a) => {
      requests.all().filter((r) => a[0] === r.batchJobId && r.status === 'SUBMITTED').forEach((r) => r.failed(a[1] as string));
      return 0;
    });
    const models = new InMemoryRepo<KbModel, string>((m) => m.id);
    const runs = new InMemoryRepo<object, string>(() => '').on('setStatusIf', () => 0);
    const router = new KbLlmRouter(fake, new FakeSyncChatClient(), kbLlmProperties(null, null, 'auto', 4, true), models.as<KbModelStore>());
    submitter = new KbBatchSubmitter(
      jobs.as<KbBatchJobStore>(),
      requests.as<KbRunRequestStore>(),
      runs.as<KbRunStore>(),
      new BatchLlmExecutor(fake),
      router,
      noTx,
      clock.now,
    );
    for (let i = 1; i <= 2; i++) {
      const params: JsonObject = { model: MODEL, max_tokens: 100, system: 's', messages: [{ role: 'user', content: 'hola' }] };
      const id = 'abcd1234-D-00000' + i;
      requests.rows.set(id, new KbRunRequest(id, runId, 'DIGEST', '93.41', `${runId}:DIGEST:93.41:f${i}`, 'f' + i, 0, MODEL, params, 10));
    }
  });

  test('theSameStageQueuedTwiceIsSubmittedOnce', async () => {
    const job = (await submitter.queueStage(runId, 'DIGEST', 1, MODEL, ids(), 'kb/runs/x/digest.jsonl'))!;
    expect(job.status).toBe('QUEUED');
    expect(job.doRequestId).toBe(`${runId}:DIGEST:1:${MODEL}`);
    expect(await submitter.submitQueued(job.id!)).toBe('SUBMITTED');

    // A second advancer (kick vs poller) reaches the same stage: the row exists, nothing is sent.
    expect(await submitter.queueStage(runId, 'DIGEST', 1, MODEL, ids(), 'kb/runs/x/digest.jsonl')).toBeNull();
    expect(await submitter.submitQueued(job.id!)).toBe('SUBMITTED');
    expect(fake.createCalls()).toBe(1);
    expect(fake.batchCount()).toBe(1);
    expect(jobs.rows.size).toBe(1);
    expect(jobs.all()[0]!.doBatchId).not.toBeNull();
    // The JSONL carries DO's batch id (native), not the catalog id.
    expect(new Set(fake.submitted().map((r) => r.model))).toEqual(new Set(['gpt-6-luna']));
  });

  test('rateLimitedCreationWaitsWithBackoffAndNeverFails', async () => {
    for (let i = 0; i < 6; i++) fake.failNextCreate(new LlmApiError(429, RATE_LIMIT));
    const job = (await submitter.queueStage(runId, 'DIGEST', 1, MODEL, ids(), 'kb/runs/x/digest.jsonl'))!;
    // batch_creations_per_hour: refused attempts count, so always a full hour.
    const expectedWaits = [60, 60, 60, 60, 60, 60];
    for (const wait of expectedWaits) {
      const start = clock.now();
      expect(await submitter.submitQueued(job.id!)).toBe('WAITING');
      const j = jobs.rows.get(job.id!)!;
      expect(j.status).toBe('QUEUED');
      expect(j.error!.startsWith('RATE_LIMITED: ')).toBe(true);
      expect(j.error).toContain('batch_creations_per_hour');
      expect(j.nextAttemptAt!.equals(start.plusMinutes(wait))).toBe(true);
      // Not due yet: DO is not called again.
      const calls = fake.createCalls();
      clock.advanceSeconds(30);
      expect(await submitter.submitQueued(job.id!)).toBe('WAITING');
      expect(fake.createCalls()).toBe(calls);
      clock.set(j.nextAttemptAt!);
    }
    expect(await submitter.submitQueued(job.id!)).toBe('SUBMITTED');
    const j = jobs.rows.get(job.id!)!;
    expect(j.status).toBe('SUBMITTED');
    expect(j.nextAttemptAt).toBeNull();
    expect(j.error).toBeNull();
    expect(fake.createCalls()).toBe(7);
  });

  test('aStageOverTheBatchCapIsSplitIntoPartsWithOwnJobsAndRequestIds', async () => {
    const many = Array.from({ length: 12 }, (_, i) => 'id' + (i + 1));
    const parts = split(many, 5);
    expect(parts.map((p) => p.length)).toEqual([5, 5, 2]);
    // Part 1 keeps the pre-split request id; later parts are distinct (unique per part).
    expect(requestId(runId, 'DIGEST', 1, MODEL, 1)).toBe(requestId(runId, 'DIGEST', 1, MODEL));
    const first = (await submitter.queue(runId, 'DIGEST', 1, MODEL, 1, ['abcd1234-D-000001'], 'kb/runs/x/digest-p1.jsonl'))!;
    const second = await submitter.queue(runId, 'DIGEST', 1, MODEL, 2, ['abcd1234-D-000002'], 'kb/runs/x/digest-p2.jsonl');
    expect(second).not.toBeNull();
    expect(second!.doRequestId).toBe(first.doRequestId + ':p2');
    expect(jobs.rows.size).toBe(2);
  });

  test('backoffIsOneFiveFifteenThenHourly', () => {
    expect([1, 2, 3, 4, 5, 9].map(backoffMinutes)).toEqual([1, 5, 15, 60, 60, 60]);
  });

  test('aCreationThatWentThroughIsAdoptedInsteadOfResubmitted', async () => {
    const job = (await submitter.queueStage(runId, 'DIGEST', 1, MODEL, ids(), 'kb/runs/x/digest.jsonl'))!;
    // First creation reached DO but the answer was lost (no response).
    fake.failNextCreate(new LlmApiError(0, 'POST /v1/batches: timeout'));
    expect(await submitter.submitQueued(job.id!)).toBe('WAITING');
    // Simulate DO having it anyway, under the same request_id.
    const file = await fake.createFile('x');
    await fake.upload(file.uploadUrl, new TextEncoder().encode('{"custom_id":"a","params":{}}\n'));
    const created = await fake.createBatch(file.fileId, job.doRequestId, 'openai', null);
    clock.advanceSeconds(60);
    const calls = fake.createCalls();
    expect(await submitter.submitQueued(job.id!)).toBe('SUBMITTED');
    expect(fake.createCalls()).toBe(calls);
    expect(jobs.rows.get(job.id!)!.doBatchId).toBe(created.id);
  });

  test('aRejectedCreationFailsTheJobAndItsRequestsWithDoMessage', async () => {
    fake.failNextCreate(new LlmApiError(400, 'POST /v1/batches -> 400: invalid completion_window'));
    const job = (await submitter.queueStage(runId, 'DIGEST', 1, MODEL, ids(), 'kb/runs/x/digest.jsonl'))!;
    expect(await submitter.submitQueued(job.id!)).toBe('FAILED');
    expect(jobs.rows.get(job.id!)!.status).toBe('FAILED');
    expect(jobs.rows.get(job.id!)!.error).toContain('invalid completion_window');
    for (const r of requests.all()) {
      expect(r.status).toBe('FAILED');
      expect(r.error).toContain('invalid completion_window');
    }
  });
});
