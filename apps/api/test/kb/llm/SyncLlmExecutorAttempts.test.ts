// Port of apps/api/src/test/java/org/ceitba/api/service/kb/llm/SyncLlmExecutorAttemptsTest.java
// Each HTTP call is an attempt (own usage, latency, reasoning tokens);
// max_tokens is doubled at most once; a stop condition abandons queued requests.
import { describe, expect, test } from 'bun:test';
import type { SyncChatClient } from '../../../src/features/kb/logic/external/llmApi';
import { asInt, path, readTree, type JsonObject, type JsonValue } from '../../../src/features/kb/logic/jsonNode';
import { kbLlmProperties } from '../../../src/features/kb/logic/llm/kbLlmProperties';
import { SyncLlmExecutor, type LlmLine } from '../../../src/features/kb/logic/llm/syncLlmExecutor';

function params(maxTokens: number): JsonValue {
  return readTree(`{"model":"glm-5.3-flash","max_tokens":${maxTokens},"system":"s",
     "tools":[{"name":"submit_digest","input_schema":{"type":"object"}}],
     "messages":[{"role":"user","content":"x"}]}`);
}

// Answers with finish_reason=length `cuts` times, then a valid tool call.
function client(cuts: number, maxTokensSeen: number[]): SyncChatClient {
  let calls = 0;
  return {
    available: () => true,
    listModels: async () => [],
    complete: async (body) => {
      maxTokensSeen.push(asInt(path(body, 'max_tokens')));
      const cut = ++calls <= cuts;
      const msg: JsonObject = {};
      if (!cut) {
        msg.tool_calls = [{ function: { name: 'submit_digest', arguments: '{"topics":[{"name":"a","summary":"b"}]}' } }];
      }
      return {
        choices: [{ finish_reason: cut ? 'length' : 'tool_calls', message: msg }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: cut ? 4000 : 500,
          completion_tokens_details: { reasoning_tokens: cut ? 3900 : 200 },
        },
      };
    },
  };
}

describe('SyncLlmExecutorAttemptsTest', () => {
  test('truncatedAnswerIsRetriedOnceWithDoubleMaxTokensAndEachAttemptTracked', async () => {
    const seen: number[] = [];
    const exec = new SyncLlmExecutor(client(1, seen), kbLlmProperties(null, 'k', 'sync', 4, false));
    const o = await exec.runTracked({ customId: 'c1', params: params(4000) });
    expect(o.result.ok).toBe(true);
    expect(o.result.path).toBe('tool+retry');
    expect(seen).toEqual([4000, 8000]);
    expect(o.attempts).toHaveLength(2);
    expect(o.attempts[0]!.tokensOut).toBe(4000);
    expect(o.attempts[0]!.reasoningTokens).toBe(3900);
    expect(o.attempts[1]!.tokensOut).toBe(500);
    expect(o.latencyMs).toBeGreaterThanOrEqual(0);
  });

  test('neverDoublesTwice', async () => {
    const seen: number[] = [];
    const exec = new SyncLlmExecutor(client(5, seen), kbLlmProperties(null, 'k', 'sync', 4, false));
    const o = await exec.runTracked({ customId: 'c1', params: params(4000) });
    expect(o.result.ok).toBe(false);
    expect(o.result.error!.startsWith('TRUNCATED')).toBe(true);
    expect(seen).toEqual([4000, 8000]);
  });

  test('stopAbandonsQueuedRequests', async () => {
    const seen: number[] = [];
    const exec = new SyncLlmExecutor(client(0, seen), kbLlmProperties(null, 'k', 'sync', 1, false));
    const lines: LlmLine[] = [];
    for (let i = 0; i < 6; i++) lines.push({ customId: 'c' + i, params: params(4000) });
    let done = 0;
    await exec.run(lines, () => done++, () => done >= 2);
    expect(done).toBe(2);
    expect(seen).toHaveLength(2);
  });
});
