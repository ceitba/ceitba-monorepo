// Port of apps/api/src/main/java/org/ceitba/api/external/llm/LlmOutputParser.java.
//
// Parses batch output/error JSONL defensively, by custom_id. Each line may be:
//   {custom_id, result: {type: succeeded|errored, message: <Messages response>, error}}   (Anthropic batches)
//   {custom_id, response: {status_code, body: <Messages | chat.completion>}, error}       (OpenAI batches)
//   {custom_id, ...<Messages | chat.completion> fields at the top level}
// and the message an Anthropic Messages response (content[] with tool_use /
// text, usage.input_tokens/output_tokens) or an OpenAI chat completion
// (choices[0].message.tool_calls[0].function.arguments | content,
// usage.prompt_tokens/completion_tokens).
//
// Difference: Jackson's readTree ignores trailing garbage after the first JSON
// value of a line; JSON.parse rejects the line (it is skipped).
// TODO(kb-service): the streaming parse(Path, sink) variant reads a downloaded file line by line.

import { jIsBlank, jSplit, jStrip, S } from '../javaString';
import {
  asInt,
  asText,
  has,
  hasNonNull,
  isArray,
  isEmpty,
  isMissing,
  isNull,
  isObject,
  isTextual,
  nodeToString,
  path,
  size,
  type JsonObject,
  type JsonValue,
  type Node,
} from '../jsonNode';

/**
 * ok: there is a usable answer. toolInput: the first tool call's input (JSON) when
 * present, else a JSON object found in the text; text: concatenated text content.
 * cachedTokens: cached input tokens. path: tool | content-json | text (how the answer came back).
 */
export interface LlmResult {
  customId: string;
  ok: boolean;
  toolInput: JsonValue | null;
  text: string | null;
  tokensIn: number;
  tokensOut: number;
  cachedTokens: number;
  path: string | null;
  error: string | null;
}

export function llmResult(
  customId: string,
  ok: boolean,
  toolInput: JsonValue | null,
  text: string | null,
  tokensIn: number,
  tokensOut: number,
  cachedTokens: number,
  path: string | null,
  error: string | null,
): LlmResult {
  return { customId, ok, toolInput, text, tokensIn, tokensOut, cachedTokens, path, error };
}

const decoder = new TextDecoder('utf-8');

function tryParse(line: string): JsonValue | undefined {
  try {
    return JSON.parse(line) as JsonValue;
  } catch {
    return undefined;
  }
}

/** By custom_id, in file order (later lines with the same id replace earlier ones in place). */
export function parse(jsonl: Uint8Array | null): Map<string, LlmResult> {
  const out = new Map<string, LlmResult>();
  if (jsonl == null) return out;
  for (const line of jSplit(decoder.decode(jsonl), '\n')) {
    if (jIsBlank(line)) continue;
    const node = tryParse(line);
    if (node === undefined) continue;
    const r = parseLine(node);
    if (r != null) out.set(r.customId, r);
  }
  return out;
}

export function parseLine(line: Node): LlmResult | null {
  let id = textOf(line, 'custom_id');
  if (id == null) id = textOf(path(line, 'request'), 'custom_id');
  if (id == null) return null;

  let error: string | null = null;
  let message: Node = null;
  let messageSet = false;
  const result = path(line, 'result');
  if (isObject(result)) {
    const type = textOf(result, 'type');
    if (type != null && type !== 'succeeded') error = describe(path(result, 'error'), type);
    if (has(result, 'message')) {
      message = path(result, 'message');
      messageSet = true;
    }
  }
  const response = path(line, 'response');
  if (!messageSet && isObject(response)) {
    const status = asInt(path(response, 'status_code'), 200);
    if (Math.trunc(status / 100) !== 2) error = 'HTTP ' + status + ' ' + describe(path(path(response, 'body'), 'error'), '');
    message = has(response, 'body') ? path(response, 'body') : response;
    messageSet = true;
  }
  if (isObject(path(line, 'error')) || isTextual(path(line, 'error'))) {
    error = describe(path(line, 'error'), 'error');
  }
  if (!messageSet && (has(line, 'content') || has(line, 'choices'))) {
    message = line;
    messageSet = true;
  }
  if (!messageSet || isMissing(message) || isNull(message)) {
    return llmResult(id, false, null, null, 0, 0, 0, null, error == null ? 'no response' : error);
  }

  let toolInput: Node = null;
  let calledTool = false;
  let text = '';
  const content = path(message, 'content');
  if (isArray(content)) {
    for (const block of content) {
      const type = textOf(block, 'type');
      if (type === 'tool_use' && !calledTool) {
        calledTool = true;
        toolInput = path(block, 'input');
      }
      if (type === 'text' && hasNonNull(block, 'text')) text += asText(path(block, 'text'));
    }
  } else if (isTextual(content)) {
    text += content;
  }
  const choice = path(path(path(message, 'choices'), 0), 'message');
  if (isObject(choice)) {
    // reasoning_content (reasoning models) is never kept.
    const call = path(path(path(path(choice, 'tool_calls'), 0), 'function'), 'arguments');
    if (!calledTool && size(path(choice, 'tool_calls')) > 0) {
      calledTool = true;
      if (isTextual(call) && !jIsBlank(call)) {
        const parsed = tryParse(call);
        toolInput = parsed === undefined ? null : parsed; // unparseable arguments
      } else if (isObject(call)) {
        toolInput = call;
      }
    }
    if (isTextual(path(choice, 'content'))) text += path(choice, 'content') as string;
  }
  // Cut by max_tokens (reasoning models spend small budgets thinking) or
  // a tool call with empty/unparseable arguments: a failed request.
  const finish = asText(
    path(path(path(message, 'choices'), 0), 'finish_reason'),
    asText(path(message, 'stop_reason'), ''),
  )!;
  const truncated = finish === 'length' || finish === 'max_tokens';
  // toolInput === undefined is a MissingNode (tool_use without input): not an object.
  const emptyTool = calledTool && (toolInput == null || !isObject(toolInput) || isEmpty(toolInput));
  if (emptyTool) toolInput = null;
  if (toolInput === undefined) toolInput = null;
  let resultPath: string | null = toolInput != null ? 'tool' : null;
  if (toolInput == null && !calledTool && text.length > 0) {
    const obj = jsonObjectIn(text);
    if (obj != null) {
      toolInput = obj;
      resultPath = 'content-json';
    } else {
      resultPath = 'text';
    }
  }
  if (error == null && truncated) error = 'TRUNCATED: stopped at max_tokens (' + finish + ')';
  else if (error == null && emptyTool) error = 'EMPTY_TOOL: empty or unparseable tool arguments';
  const usage = path(message, 'usage');
  const tokensIn = asInt(path(usage, 'input_tokens'), asInt(path(usage, 'prompt_tokens'), 0));
  const tokensOut = asInt(path(usage, 'output_tokens'), asInt(path(usage, 'completion_tokens'), 0));
  const cached = asInt(path(usage, 'cache_read_input_tokens'), asInt(path(path(usage, 'prompt_tokens_details'), 'cached_tokens'), 0));
  const ok = error == null && (toolInput != null || (!calledTool && text.length > 0));
  return llmResult(
    id,
    ok,
    withoutNulNode(toolInput),
    text.length === 0 ? null : withoutNul(text),
    tokensIn,
    tokensOut,
    cached,
    resultPath,
    ok ? null : error == null ? 'empty response' : error,
  );
}

/**
 * Postgres text/jsonb can't hold U+0000 ("unsupported Unicode escape sequence"),
 * and models occasionally emit it: dropped.
 */
export function withoutNul(s: string): string;
export function withoutNul(s: string | null): string | null;
export function withoutNul(s: string | null): string | null {
  return s == null || !s.includes('\u0000') ? s : s.replaceAll('\u0000', '');
}

export function withoutNulNode(node: JsonValue | null): JsonValue | null {
  if (node == null) return null;
  if (typeof node === 'string') return withoutNul(node);
  if (isObject(node)) {
    const out: JsonObject = {};
    for (const [k, v] of Object.entries(node)) out[withoutNul(k)] = withoutNulNode(v);
    return out;
  }
  if (isArray(node)) return node.map((v) => withoutNulNode(v));
  return node;
}

const FENCE_OPEN = new RegExp(`^\`\`\`[a-zA-Z]*${S}*`);
const FENCE_CLOSE = new RegExp(`${S}*\`\`\`$`);

/** A JSON object answer written as text (optionally fenced). */
export function jsonObjectIn(text: string): JsonValue | null {
  let t = jStrip(text);
  if (t.startsWith('```')) t = jStrip(t.replace(FENCE_OPEN, '').replace(FENCE_CLOSE, ''));
  if (!t.startsWith('{') || !t.endsWith('}')) return null;
  const node = tryParse(t);
  return node !== undefined && isObject(node) ? node : null;
}

/** A chat completion (sync mode) read like a batch output line. */
export function fromChatCompletion(customId: string | null, body: JsonValue): LlmResult {
  const line: JsonObject = {
    custom_id: customId == null ? 'sync' : customId,
    response: { status_code: 200, body },
  };
  return parseLine(line)!;
}

function describe(error: Node, fallback: string): string {
  if (error == null || isMissing(error) || isNull(error)) return fallback;
  if (isTextual(error)) return error;
  let msg = textOf(error, 'message');
  if (msg == null) msg = textOf(path(error, 'error'), 'message');
  const type = textOf(error, 'type');
  return (type == null ? '' : type + ': ') + (msg == null ? nodeToString(error) : msg);
}

function textOf(node: Node, field: string): string | null {
  const v = path(node, field);
  return isTextual(v) ? v : null;
}
