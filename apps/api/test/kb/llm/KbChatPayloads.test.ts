// Port of apps/api/src/test/java/org/ceitba/api/service/kb/llm/KbChatPayloadsTest.java
// Wire formats (canonical Anthropic params -> chat / batch lines) and the defensive output parser.
import { describe, expect, test } from 'bun:test';
import { fromChatCompletion, parse } from '../../../src/features/kb/logic/external/llmOutputParser';
import { asInt, asText, at, has, nodeToString, path, readTree, type JsonObject } from '../../../src/features/kb/logic/jsonNode';
import { batchLine, chatBody, defaultBatchModelId, otherBatchModelId } from '../../../src/features/kb/logic/llm/kbChatPayloads';

function params(): JsonObject {
  return readTree(`
    {"model":"glm-5.3","max_tokens":6000,"reasoning_effort":"low","system":"reglas",
     "tools":[{"name":"submit_plan","description":"d","input_schema":{"type":"object"}}],
     "tool_choice":{"type":"tool","name":"submit_plan"},
     "messages":[{"role":"user","content":[{"type":"text","text":"## Contexto"},{"type":"text","text":"## Tarea"}]}]}
    `) as JsonObject;
}

const enc = new TextEncoder();

describe('KbChatPayloadsTest', () => {
  test('chatBodyForcesTheToolAndKeepsReasoningEffort', () => {
    const body = chatBody(params(), false);
    expect(asText(at(body, 'tool_choice', 'function', 'name'))).toBe('submit_plan');
    expect(asText(path(body, 'reasoning_effort'))).toBe('low');
    expect(asText(at(body, 'messages', 0, 'content'))).toBe('reglas');
    expect(asText(at(body, 'messages', 1, 'content'))).toBe('## Contexto## Tarea');
    const fallback = chatBody(params(), true);
    expect(has(fallback, 'tools')).toBe(false);
    expect(asText(at(fallback, 'response_format', 'type'))).toBe('json_object');
    expect(asText(at(fallback, 'messages', 0, 'content'))).toContain('submit_plan');
  });

  test('anthropicBatchLinesDropReasoningEffort', () => {
    const line = batchLine('abc-P-000001', params(), 'anthropic');
    expect(has(path(line, 'params'), 'reasoning_effort')).toBe(false);
    const openai = batchLine('abc-P-000001', params(), 'openai');
    expect(asText(path(openai, 'url'))).toBe('/v1/chat/completions');
    expect(asText(at(openai, 'body', 'model'))).toBe('glm-5.3');
    // GPT-5 models reject max_tokens in batch: the limit goes as max_completion_tokens.
    expect(has(path(openai, 'body'), 'max_tokens')).toBe(false);
    expect(asInt(at(openai, 'body', 'max_completion_tokens'))).toBe(6000);
  });

  test('batchModelIdDefaultsToTheNativeProviderId', () => {
    expect(defaultBatchModelId('openai-gpt-6-luna')).toBe('gpt-6-luna');
    expect(defaultBatchModelId('anthropic-claude-haiku-4.5')).toBe('claude-haiku-4.5');
    expect(defaultBatchModelId('glm-5.3')).toBe('glm-5.3');
    // The probe's fallback: the other form of what was tried.
    expect(otherBatchModelId('openai-gpt-6-luna', 'gpt-6-luna')).toBe('openai-gpt-6-luna');
    expect(otherBatchModelId('openai-gpt-6-luna', 'openai-gpt-6-luna')).toBe('gpt-6-luna');
    expect(otherBatchModelId('glm-5.3', 'glm-5.3')).toBeNull();
  });

  test('batchLinesCarryTheBatchModelIdAndSyncKeepsTheCatalogId', () => {
    const p = params();
    p.model = 'openai-gpt-6-luna';
    const openai = batchLine('abc-P-000001', p, 'openai', 'gpt-6-luna');
    expect(asText(at(openai, 'body', 'model'))).toBe('gpt-6-luna');
    const hp = params();
    hp.model = 'anthropic-claude-haiku-4.5';
    const anthropic = batchLine('abc-P-000001', hp, 'anthropic', 'claude-haiku-4.5');
    expect(asText(at(anthropic, 'params', 'model'))).toBe('claude-haiku-4.5');
    expect(asText(path(chatBody(p, false), 'model'))).toBe('openai-gpt-6-luna');
    expect(asText(path(p, 'model'))).toBe('openai-gpt-6-luna'); // canonical params untouched
  });

  test('parserHandlesToolCallsContentJsonEmptyAndTruncated', () => {
    const ok = fromChatCompletion('x', readTree(`
      {"choices":[{"finish_reason":"tool_calls","message":{"reasoning_content":"pienso",
        "tool_calls":[{"function":{"name":"submit_plan","arguments":"{\\"operations\\":[]}"}}]}}],
       "usage":{"prompt_tokens":100,"completion_tokens":10,"prompt_tokens_details":{"cached_tokens":40}}}
      `));
    expect(ok.ok).toBe(true);
    expect(has(ok.toolInput, 'operations')).toBe(true);
    expect(ok.cachedTokens).toBe(40);
    expect(ok.path).toBe('tool');

    const content = fromChatCompletion('x', readTree(`
      {"choices":[{"finish_reason":"stop","message":{"content":"\`\`\`json\\n{\\"markdown\\":\\"hola\\"}\\n\`\`\`"}}]}
      `));
    expect(asText(path(content.toolInput, 'markdown'))).toBe('hola');
    expect(content.path).toBe('content-json');

    const empty = fromChatCompletion('x', readTree(`
      {"choices":[{"finish_reason":"tool_calls","message":{"tool_calls":[{"function":{"name":"submit_plan","arguments":""}}]}}]}
      `));
    expect(empty.ok).toBe(false);
    expect(empty.error!.startsWith('EMPTY_TOOL')).toBe(true);

    const cut = fromChatCompletion('x', readTree(`
      {"choices":[{"finish_reason":"length","message":{"content":""}}]}
      `));
    expect(cut.ok).toBe(false);
    expect(cut.error!.startsWith('TRUNCATED')).toBe(true);
  });

  test('parserReadsAnthropicBatchResults', () => {
    const jsonl = `{"custom_id":"a","result":{"type":"succeeded","message":{"stop_reason":"tool_use","content":[{"type":"tool_use","name":"submit_page","input":{"markdown":"x"}}],"usage":{"input_tokens":10,"output_tokens":5,"cache_read_input_tokens":3}}}}
{"custom_id":"b","result":{"type":"errored","error":{"type":"invalid_request_error","message":"bad"}}}
`;
    const out = parse(enc.encode(jsonl));
    expect(out.get('a')!.ok).toBe(true);
    expect(out.get('a')!.cachedTokens).toBe(3);
    expect(out.get('b')!.ok).toBe(false);
  });

  test('parserDropsNulCharactersPostgresCannotStore', () => {
    const line = readTree(
      '{"custom_id":"x","response":{"status_code":200,"body":{"choices":[{"message":' +
        '{"tool_calls":[{"function":{"name":"submit_page","arguments":"{\\"markdown\\":\\"distribuci\\\\u0000n\\"}"}}]},' +
        '"finish_reason":"tool_calls"}]}}}',
    );
    const r = parse(enc.encode(nodeToString(line) + '\n')).get('x')!;
    expect(r.ok).toBe(true);
    expect(asText(path(r.toolInput, 'markdown'))).toBe('distribucin');
  });
});
