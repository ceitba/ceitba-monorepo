// Port of apps/api/src/test/java/org/ceitba/api/service/kb/admin/KbBatchProbeFallbackTest.java
// Batch probe: batch model id forms (native <-> prefixed), when
// batchSupported changes, one pending probe per model, 429 retry later.
import { beforeEach, describe, expect, test } from 'bun:test';
import { KbModelCatalogService } from '../../../src/features/kb/logic/admin/kbModelCatalogService';
import { FakeLlmBatchClient, FakeSyncChatClient } from '../../../src/features/kb/logic/external/fakeLlm';
import { LlmApiError } from '../../../src/features/kb/logic/external/llmApi';
import { asBoolean, asText, hasNonNull, path, type JsonValue } from '../../../src/features/kb/logic/jsonNode';
import { BatchLlmExecutor } from '../../../src/features/kb/logic/llm/batchLlmExecutor';
import { KbLlmRouter } from '../../../src/features/kb/logic/llm/kbLlmRouter';
import { kbLlmProperties } from '../../../src/features/kb/logic/llm/kbLlmProperties';
import { KbUsageRecorder } from '../../../src/features/kb/logic/llm/kbUsageRecorder';
import { KbPayloads } from '../../../src/features/kb/logic/pipeline/kbPayloads';
import { noTx, type KbModelStore } from '../../../src/features/kb/logic/ports';
import { KbModel, type KbLlmUsage } from '../../../src/features/kb/logic/types';
import { InMemoryRepo } from '../support/inMemoryRepo';
import { MutableClock } from '../support/mutableClock';

const LUNA = 'openai-gpt-6-luna';

let fake: FakeLlmBatchClient;
let clock: MutableClock;
let models: InMemoryRepo<KbModel, string>;
let catalog: KbModelCatalogService;

const luna = () => models.rows.get(LUNA)!;
const probeIn = (mode: string): JsonValue | null => luna().probeIn(mode);

describe('KbBatchProbeFallbackTest', () => {
  beforeEach(() => {
    fake = new FakeLlmBatchClient();
    clock = new MutableClock('2026-10-03T06:30:00Z');
    models = new InMemoryRepo<KbModel, string>((m) => m.id);
    models.rows.set(LUNA, new KbModel(LUNA, 'GPT-6 Luna', 'openai', true, true));
    const modelRepo = models.as<KbModelStore>();
    const router = new KbLlmRouter(fake, new FakeSyncChatClient(), kbLlmProperties(null, null, 'auto', 4, true), modelRepo);
    const usage = new KbUsageRecorder(new InMemoryRepo<KbLlmUsage, object>(() => ({})).as(), modelRepo, router, clock.now);
    // settings and the sync executor are not needed: every probe here names its mode (batch).
    catalog = new KbModelCatalogService(modelRepo, null, router, null, new BatchLlmExecutor(fake), new KbPayloads(modelRepo), usage, noTx, clock.now);
    fake.respond(() => ({ topics: ['interés compuesto'] }));
  });

  test('nativeIdRefusedThenPrefixedIdWorksAndIsStored', async () => {
    fake.unsupportedModels((id) => id === 'gpt-6-luna');
    await catalog.probe(LUNA, 'batch');
    expect(asText(path(probeIn('batch'), 'batchModelId'))).toBe('gpt-6-luna');
    expect(asBoolean(path(probeIn('batch'), 'pending'))).toBe(true);

    await catalog.refreshPendingProbes(); // validation failed: retried with the other form
    expect(asText(path(probeIn('batch'), 'batchModelId'))).toBe(LUNA);
    expect(asBoolean(path(probeIn('batch'), 'pending'))).toBe(true);
    expect(luna().isBatchSupported()).toBe(true);

    await catalog.refreshPendingProbes();
    expect(asBoolean(path(probeIn('batch'), 'ok'))).toBe(true);
    expect(luna().getBatchModelId()).toBe(LUNA);
    expect(luna().isBatchSupported()).toBe(true);
    expect(luna().batchSource).toBe('probe');
    expect(fake.createCalls()).toBe(2);
  });

  test('nativeIdWorksFirst', async () => {
    await catalog.probe(LUNA, 'batch');
    await catalog.refreshPendingProbes();
    expect(asBoolean(path(probeIn('batch'), 'ok'))).toBe(true);
    expect(luna().getBatchModelId()).toBe('gpt-6-luna');
    expect(fake.submitted().map((r) => r.model)).toEqual(['gpt-6-luna']);
  });

  test('bothFormsUnsupportedTurnBatchOff', async () => {
    fake.unsupportedModels(() => true);
    await catalog.probe(LUNA, 'batch');
    await catalog.refreshPendingProbes();
    expect(luna().isBatchSupported()).toBe(true); // one form left to try
    await catalog.refreshPendingProbes();
    const p = probeIn('batch');
    expect(asBoolean(path(p, 'ok'))).toBe(false);
    expect(asBoolean(path(p, 'pending'), false)).toBe(false);
    expect(asBoolean(path(p, 'unsupportedModel'))).toBe(true);
    expect(asText(path(p, 'error'))).toContain('unsupported model');
    expect(luna().isBatchSupported()).toBe(false);
    expect(luna().getBatchModelId()).toBeNull();
  });

  test('otherErrorsLeaveBatchSupportedAlone', async () => {
    fake.failNextCreate(new LlmApiError(400, 'POST /v1/batches -> 400: invalid completion_window'));
    await catalog.probe(LUNA, 'batch');
    const p = probeIn('batch');
    expect(asBoolean(path(p, 'ok'))).toBe(false);
    expect(asBoolean(path(p, 'pending'), false)).toBe(false);
    expect(luna().isBatchSupported()).toBe(true);
    expect(luna().batchSource).toBe('rule');
  });

  test('rateLimitedProbeIsRetriedLaterAndOnlyOneIsPending', async () => {
    fake.failNextCreate(
      new LlmApiError(
        429,
        'POST /v1/batches -> 429: {"error":{"message":"Rate limit ' +
          'exceeded: batch_create_per_minute, batch_creations_per_hour.","type":"rate_limit_exceeded_error"}}',
      ),
    );
    await catalog.probe(LUNA, 'batch');
    const p = probeIn('batch');
    expect(asBoolean(path(p, 'pending'))).toBe(true);
    // batch_creations_per_hour: a refused attempt counts too, so a full hour.
    expect(asText(path(p, 'retryAt'))).toBe('2026-10-03T07:30Z');
    expect(asText(path(p, 'error')).startsWith('DigitalOcean limitó la creación de lotes; reintento a las 04:30')).toBe(true);
    expect(luna().isBatchSupported()).toBe(true);

    await catalog.probe(LUNA, 'batch'); // already pending: not submitted again
    await catalog.refreshPendingProbes(); // not due yet
    expect(fake.createCalls()).toBe(1);

    clock.advanceSeconds(3600);
    await catalog.refreshPendingProbes(); // due: submitted
    expect(fake.createCalls()).toBe(2);
    expect(hasNonNull(probeIn('batch'), 'batchId')).toBe(true);
    await catalog.refreshPendingProbes();
    expect(asBoolean(path(probeIn('batch'), 'ok'))).toBe(true);
  });
});
