// Port of apps/api/src/test/java/org/ceitba/api/external/llm/DoQuotaTrackerTest.java
import { describe, expect, test } from 'bun:test';
import { DoQuotaTracker } from '../../../src/features/kb/logic/external/doQuotaTracker';
import { FakeSyncChatClient } from '../../../src/features/kb/logic/external/fakeLlm';
import { DoBatchSlotError, DoQuotaExhaustedError, type LlmBatchClient, type SyncChatClient } from '../../../src/features/kb/logic/external/llmApi';
import { readTree } from '../../../src/features/kb/logic/jsonNode';
import { BatchLlmExecutor } from '../../../src/features/kb/logic/llm/batchLlmExecutor';
import { kbLlmProperties } from '../../../src/features/kb/logic/llm/kbLlmProperties';
import { SyncLlmExecutor } from '../../../src/features/kb/logic/llm/syncLlmExecutor';
import { Odt } from '../../../src/features/kb/logic/odt';

const NOW = Odt.parse('2026-10-04T12:00:00Z');
const clock = () => NOW;

function tracker(): DoQuotaTracker {
  const t = new DoQuotaTracker(clock);
  t.observe({
    'x-ratelimit-limit-batch-creations-per-hour': ['5'],
    'x-ratelimit-remaining-batch-creations-per-hour': ['0'],
    'x-ratelimit-limit-tokens-per-day': ['45000000'],
    'x-ratelimit-remaining-tokens-per-day': ['1000'],
    'x-ratelimit-reset-tokens-per-day': ['0'],
    'Retry-After': ['30'],
  });
  return t;
}

describe('DoQuotaTrackerTest', () => {
  test('parsesLimitAndRemainingPairsByHeaderSuffix', () => {
    const t = tracker();
    const c = t.counter('batch-creations-per-hour')!;
    expect(c.limit).toBe(5);
    expect(c.remaining).toBe(0);
    expect(t.counter('tokens-per-day')!.remaining).toBe(1000);
    expect(t.counter('tokens-per-day')!.observedAt).not.toBeNull();
    expect(t.lastRetryAfterSeconds()).toBe(30);
    expect(t.counter('tokens-per-minute')).toBeNull();
  });

  test('batchCreationIsSkippedWithoutCallingDoWhenNoneIsLeft', async () => {
    const neverCalled = new Proxy({} as LlmBatchClient, {
      get(_t, name) {
        if (name === 'then') return undefined;
        return () => {
          throw new Error('DO called: ' + String(name));
        };
      },
    });
    const exec = new BatchLlmExecutor(neverCalled, tracker());
    const lines = [{ customId: 'c1', params: {} }];
    let err: unknown;
    try {
      await exec.submit('n', 'openai-gpt-5', 'gpt-5', lines, 'rid');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(DoBatchSlotError);
    // No reset header: a full hour, not a 10-minute re-probe (refused attempts count).
    expect((err as DoBatchSlotError).retryAt.isEqual(NOW.plusMinutes(60))).toBe(true);
    expect((err as DoBatchSlotError).message).toContain('0/5 esta hora');
  });

  test('zeroBatchQuotaWaitsForDosResetTimeAndNeverProbesMeanwhile', async () => {
    const t = new DoQuotaTracker(clock);
    let probes = 0;
    t.bindProbe(() => probes++);
    const reset = NOW.plusMinutes(8).epochSecond;
    t.observe({
      'x-ratelimit-limit-batch-creations-per-hour': ['5'],
      'x-ratelimit-remaining-batch-creations-per-hour': ['0'],
      'x-ratelimit-reset-batch-creations-per-hour': [String(reset)],
    });
    const wait = t.batchCreationWait()!;
    expect(wait.until.isEqual(Odt.ofEpoch(reset, 0).plusSeconds(30))).toBe(true);
    await t.refreshBatchQuota();
    expect(probes).toBe(0);
  });

  test('dailyTokenQuotaPausesTheSyncPoolInsteadOfFailingRequests', async () => {
    const client: SyncChatClient = {
      available: () => true,
      complete: async () => {
        throw new DoQuotaExhaustedError('429 tokens_per_day');
      },
      listModels: async () => [],
    };
    const exec = new SyncLlmExecutor(client, kbLlmProperties(null, 'k', 'sync', 2, false), new DoQuotaTracker(clock));
    const line = { customId: 'c1', params: readTree('{"model":"m","max_tokens":100,"messages":[]}') };
    let answers = 0;
    expect(await exec.run([line], () => answers++, () => false)).toBe(true);
    expect(answers).toBe(0);
    // a snapshot with fewer daily tokens than the request needs pauses before calling DO
    const quiet = new FakeSyncChatClient();
    const exec2 = new SyncLlmExecutor(quiet, kbLlmProperties(null, 'k', 'sync', 2, false), tracker());
    const big = { customId: 'c2', params: readTree('{"model":"m","max_tokens":5000,"messages":[]}') };
    expect(await exec2.run([big], () => answers++, () => false)).toBe(true);
    expect(answers).toBe(0);
  });
});
