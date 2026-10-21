// Port of apps/api/src/main/java/org/ceitba/api/service/kb/llm/KbChatPayloads.java.
//
// Wire formats of one canonical request (Anthropic Messages `params`:
// model, max_tokens, system, messages, tools[{name, description,
// input_schema}], tool_choice {type: tool, name}). The canonical form is
// what the pipeline stores (kb/runs/<runId>/<stage>.jsonl), in every mode.

import {
  asInt,
  asText,
  deepCopy,
  elements,
  hasNonNull,
  isObject,
  isTextual,
  nodeToString,
  path,
  size,
  type JsonObject,
  type JsonValue,
  type Node,
} from '../jsonNode';

export const CHAT_ENDPOINT = '/v1/chat/completions';

/** The DO batch provider of a model id (anthropic | openai), or null. */
export function batchProvider(model: string | null): 'anthropic' | 'openai' | null {
  if (model == null) return null;
  if (model.startsWith('anthropic-')) return 'anthropic';
  if (model.startsWith('openai-')) return 'openai';
  return null;
}

/**
 * The model id batch JSONL lines use when the catalog has none: DO's batch API
 * takes native provider ids (gpt-6-luna, claude-haiku-4.5) where serverless chat
 * takes the catalog id (openai-gpt-6-luna).
 */
export function defaultBatchModelId(model: string | null): string | null {
  if (model == null) return null;
  for (const prefix of ['openai-', 'anthropic-']) {
    if (model.startsWith(prefix) && model.length > prefix.length) return model.substring(prefix.length);
  }
  return model;
}

/** The other form of a batch model id (native <-> prefixed catalog id), or null without a provider prefix. */
export function otherBatchModelId(catalogId: string, tried: string | null): string | null {
  const nativeId = defaultBatchModelId(catalogId);
  if (nativeId == null || nativeId === catalogId) return null;
  return catalogId === tried ? nativeId : catalogId;
}

/**
 * Default batch rule (ADMIN doc §7): commercial OpenAI/Anthropic models only;
 * DO-hosted open-weight models have none. A batch probe overrides it in the catalog.
 */
export function batchByRule(model: string | null): boolean {
  if (model == null) return false;
  if (model.startsWith('anthropic-')) return true;
  return model.startsWith('openai-') && !model.includes('gpt-oss') && !model.includes('llama');
}

/** One batch JSONL line in the provider's format; batchModelId replaces params.model (null keeps it). */
export function batchLine(customId: string, params: JsonValue, provider: string | null, batchModelId: string | null = null): JsonObject {
  const line: JsonObject = { custom_id: customId };
  if (provider === 'openai') {
    line.method = 'POST';
    line.url = CHAT_ENDPOINT;
    const body = chatBody(params, false);
    if (batchModelId != null) body.model = batchModelId;
    // The GPT-5 family rejects max_tokens in batch bodies: max_completion_tokens
    // works for all OpenAI chat models. (ObjectNode.remove + set: appended last.)
    if (Object.prototype.hasOwnProperty.call(body, 'max_tokens')) {
      const max = body.max_tokens!;
      delete body.max_tokens;
      body.max_completion_tokens = max;
    }
    line.body = body;
  } else {
    const p = deepCopy(params);
    if (isObject(p)) {
      delete p.reasoning_effort; // not an Anthropic Messages field
      if (batchModelId != null) p.model = batchModelId;
    }
    line.params = p;
  }
  return line;
}

/**
 * OpenAI-compatible chat completion body. jsonObjectFallback: no tools,
 * response_format json_object and the tool's schema in the system prompt.
 */
export function chatBody(params: Node, jsonObjectFallback: boolean): JsonObject {
  const body: JsonObject = {};
  body.model = asText(path(params, 'model'));
  body.max_tokens = asInt(path(params, 'max_tokens'), 4096);
  if (hasNonNull(params, 'reasoning_effort')) body.reasoning_effort = asText(path(params, 'reasoning_effort'));
  const messages: JsonValue[] = [];
  body.messages = messages;
  const tool = path(path(params, 'tools'), 0);
  let system = asText(path(params, 'system'), '')!;
  if (jsonObjectFallback && isObject(tool)) {
    system +=
      '\n\nAnswer with only a JSON object (no prose, no code fences) that matches the JSON schema of ' +
      asText(path(tool, 'name'), 'the answer') +
      ':\n' +
      nodeToString(path(tool, 'input_schema'));
  }
  messages.push({ role: 'system', content: system });
  for (const m of elements(path(params, 'messages'))) {
    const content = path(m, 'content');
    let text: string;
    if (isTextual(content)) {
      text = content;
    } else {
      text = '';
      for (const b of elements(content)) if (hasNonNull(b, 'text')) text += asText(path(b, 'text'));
    }
    messages.push({ role: asText(path(m, 'role'), 'user')!, content: text });
  }
  if (jsonObjectFallback) {
    body.response_format = { type: 'json_object' };
  } else if (isObject(tool)) {
    const schema = path(tool, 'input_schema');
    body.tools = [
      {
        type: 'function',
        function: {
          name: asText(path(tool, 'name')),
          description: asText(path(tool, 'description'), '')!,
          // A MissingNode set into an ObjectNode serializes as null.
          parameters: schema === undefined ? null : schema,
        },
      },
    ];
    body.tool_choice = { type: 'function', function: { name: asText(path(tool, 'name')) } };
  }
  return body;
}

/** True when params carry at least one tool definition. */
export const hasTools = (params: Node): boolean => size(path(params, 'tools')) > 0;
