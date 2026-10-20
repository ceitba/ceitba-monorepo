// Port of apps/api/src/test/java/org/ceitba/api/service/kb/llm/SyncLlmExecutorConcurrencyTest.java
// KB_SYNC_CONCURRENCY requests really are in flight at once (promises instead of virtual threads).
import { describe, expect, test } from 'bun:test';
import { FakeSyncChatClient } from '../../../src/features/kb/logic/external/fakeLlm';
import { readTree } from '../../../src/features/kb/logic/jsonNode';
import { kbLlmProperties } from '../../../src/features/kb/logic/llm/kbLlmProperties';
import { SyncLlmExecutor, type LlmLine } from '../../../src/features/kb/logic/llm/syncLlmExecutor';

describe('SyncLlmExecutorConcurrencyTest', () => {
  test('fansOutUpToTheConfiguredConcurrency', async () => {
    const client = new FakeSyncChatClient();
    let inFlight = 0;
    let peak = 0;
    client.respond(async () => {
      const n = ++inFlight;
      peak = Math.max(peak, n);
      await Bun.sleep(300);
      inFlight--;
      return { markdown: 'ok' };
    });
    const exec = new SyncLlmExecutor(client, kbLlmProperties(null, 'k', 'sync', 4, true));
    const lines: LlmLine[] = [];
    for (let i = 0; i < 8; i++) {
      lines.push({
        customId: 'c' + i,
        params: readTree(`{"model":"glm-5.3","max_tokens":100,"system":"s",
           "tools":[{"name":"submit_page","input_schema":{"type":"object"}}],
           "messages":[{"role":"user","content":"x"}]}`),
      });
    }
    const latencies: number[] = [];
    const t0 = performance.now();
    await exec.run(lines, (o) => latencies.push(o.latencyMs), () => false);
    const wallMs = performance.now() - t0;
    expect(peak).toBe(4);
    expect(latencies).toHaveLength(8);
    for (const ms of latencies) expect(ms).toBeGreaterThanOrEqual(290);
    expect(wallMs).toBeLessThan(1500); // 2 waves of 300 ms, not 8 x 300
  });
});
