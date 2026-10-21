// Ports of apps/api/src/main/java/org/ceitba/api/external/llm/{FakeLlmRequest, FakeSyncChatClient,
// FakeLlmBatchClient}.java: in-memory inference (kb.llm.use-fake=true) for tests and offline dev.

import { jIsBlank } from '../javaString';
import { asText, elements, has, hasNonNull, isTextual, nodeToString, path, type JsonObject, type JsonValue, type Node } from '../jsonNode';
import { BatchInfo, LlmApiError, type BatchResults, type FileUpload, type LlmBatchClient, type SyncChatClient } from './llmApi';
import { javaSplit } from '../../../../lib/javaCompat';

/**
 * What the fakes hand to a responder: the forced tool, the system prompt and the
 * user text, whatever the wire format. customId is null in sync mode.
 */
export interface FakeLlmRequest {
  customId: string | null;
  model: string | null;
  toolName: string | null;
  system: string;
  userText: string;
  raw: JsonValue;
}

function contentText(c: Node): string {
  let s = '';
  if (isTextual(c)) s += c;
  for (const b of elements(c)) if (hasNonNull(b, 'text')) s += asText(path(b, 'text'));
  return s;
}

/** Anthropic Messages params (batch lines). */
export function fromAnthropic(customId: string | null, params: JsonValue): FakeLlmRequest {
  let sb = '';
  for (const m of elements(path(params, 'messages'))) sb += contentText(path(m, 'content'));
  return {
    customId,
    model: asText(path(params, 'model'), null),
    toolName: asText(path(path(params, 'tool_choice'), 'name'), null),
    system: asText(path(params, 'system'), '')!,
    userText: sb,
    raw: params,
  };
}

/** OpenAI chat completion bodies (sync mode, openai batch lines). */
export function fromChat(customId: string | null, body: JsonValue): FakeLlmRequest {
  let sb = '';
  let system = '';
  for (const m of elements(path(body, 'messages'))) {
    const t = contentText(path(m, 'content'));
    if (asText(path(m, 'role')) === 'system') system += t;
    else sb += t;
  }
  let tool = asText(path(path(path(body, 'tool_choice'), 'function'), 'name'), null);
  if (tool == null) {
    // json_object fallback: the tool is named in the system prompt.
    const m = /JSON schema of (\w+):/.exec(system);
    if (m) tool = m[1]!;
  }
  return { customId, model: asText(path(body, 'model'), null), toolName: tool, system, userText: sb, raw: body };
}

export type Responder = (r: FakeLlmRequest) => JsonValue | null | Promise<JsonValue | null>;

const DEFAULT_MODELS = ['glm-5.3', 'glm-5.3-flash', 'anthropic-claude-haiku-4.5'];

/**
 * In-memory chat completions. The responder returns the structured answer (or null
 * for a failed request). With toolCalls(false) the answer comes back as JSON in the
 * message content; with proseUnlessJsonObject(true) only a json_object request gets JSON.
 */
export class FakeSyncChatClient implements SyncChatClient {
  private readonly receivedList: FakeLlmRequest[] = [];
  private responder: Responder = () => null;
  private toolCallsOn = true;
  private prose = false;
  private modelList: string[] = DEFAULT_MODELS;

  reset(): void {
    this.receivedList.length = 0;
    this.responder = () => null;
    this.toolCallsOn = true;
    this.prose = false;
    this.modelList = DEFAULT_MODELS;
  }

  respond(responder: Responder): void {
    this.responder = responder;
  }

  toolCalls(on: boolean): void {
    this.toolCallsOn = on;
  }

  proseUnlessJsonObject(on: boolean): void {
    this.prose = on;
  }

  models(models: string[]): void {
    this.modelList = [...models];
  }

  received(): FakeLlmRequest[] {
    return [...this.receivedList];
  }

  available(): boolean {
    return true;
  }

  async complete(body: JsonValue): Promise<JsonValue> {
    const req = fromChat(null, body);
    this.receivedList.push(req);
    let answer: JsonValue | null;
    try {
      answer = await this.responder(req);
    } catch {
      answer = null;
    }
    if (answer == null) throw new LlmApiError(400, 'fake: no scripted answer');
    const msg: JsonObject = { role: 'assistant' };
    const out: JsonObject = { id: 'chatcmpl-fake', model: asText(path(body, 'model')), choices: [{ message: msg }] };
    const jsonObject = asText(path(path(body, 'response_format'), 'type'), '') === 'json_object';
    if (this.prose && !jsonObject) {
      msg.content = 'Claro, acá va mi respuesta en prosa.';
    } else if (this.toolCallsOn && req.toolName != null) {
      msg.tool_calls = [{ id: 'call_1', type: 'function', function: { name: req.toolName, arguments: nodeToString(answer) } }];
      msg.content = null;
    } else {
      msg.content = nodeToString(answer);
    }
    const prompt = Math.trunc(nodeToString(body).length / 4);
    out.usage = {
      prompt_tokens: prompt,
      completion_tokens: Math.trunc(nodeToString(answer).length / 4),
      prompt_tokens_details: { cached_tokens: Math.trunc(prompt / 2) },
    };
    return out;
  }

  async listModels(): Promise<string[]> {
    return this.modelList;
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * In-memory batch inference. Batches complete immediately (or stay in_progress
 * while hold() is on) and answer every request through `responder`, which
 * returns the tool input (or null for a failed request). Outputs use the
 * Anthropic batch result shape.
 */
export class FakeLlmBatchClient implements LlmBatchClient {
  private readonly files = new Map<string, Uint8Array>();
  private readonly batchFile = new Map<string, string>();
  private readonly status = new Map<string, string>();
  private readonly submittedList: FakeLlmRequest[] = [];
  private ids = 0;
  private responder: Responder = () => null;
  private holding = false;
  private readonly cancelledList: string[] = [];
  private readonly requestIds = new Map<string, string>();
  private readonly errors = new Map<string, string>();
  private readonly createFailures: LlmApiError[] = [];
  private unsupportedModel: (batchModelId: string) => boolean = () => false;
  private createCallCount = 0;

  reset(): void {
    this.files.clear();
    this.batchFile.clear();
    this.status.clear();
    this.submittedList.length = 0;
    this.cancelledList.length = 0;
    this.responder = () => null;
    this.holding = false;
    this.requestIds.clear();
    this.errors.clear();
    this.createFailures.length = 0;
    this.unsupportedModel = () => false;
    this.createCallCount = 0;
    this.ids = 0;
  }

  /** The next createBatch calls throw these, in order (e.g. a 429). */
  failNextCreate(...failures: LlmApiError[]): void {
    this.createFailures.push(...failures);
  }

  /** Batches whose JSONL uses a model id matching this fail at validation, like DO. */
  unsupportedModels(batchModelId: (id: string) => boolean): void {
    this.unsupportedModel = batchModelId;
  }

  /** createBatch calls (including the ones that failed). */
  createCalls(): number {
    return this.createCallCount;
  }

  respond(responder: Responder): void {
    this.responder = responder;
  }

  /** New batches stay in_progress until release(). */
  hold(on: boolean): void {
    this.holding = on;
  }

  release(): void {
    this.holding = false;
    for (const [k, v] of this.status) if (v === 'in_progress') this.status.set(k, 'completed');
  }

  submitted(): FakeLlmRequest[] {
    return [...this.submittedList];
  }

  batchCount(): number {
    return this.batchFile.size;
  }

  available(): boolean {
    return true;
  }

  async createFile(_fileName: string): Promise<FileUpload> {
    const id = `file-${++this.ids}`;
    return { fileId: id, uploadUrl: `fake://upload/${id}` };
  }

  async upload(uploadUrl: string, bytes: Uint8Array): Promise<void> {
    this.files.set(uploadUrl.substring(uploadUrl.lastIndexOf('/') + 1), bytes);
  }

  async createBatch(fileId: string, requestId: string | null, _provider: string, _endpoint: string | null): Promise<BatchInfo> {
    this.createCallCount++;
    const failure = this.createFailures.shift();
    if (failure !== undefined) throw failure;
    if (!this.files.has(fileId)) throw new LlmApiError(404, `No uploaded file ${fileId}`);
    const id = `batch-${++this.ids}`;
    this.batchFile.set(id, fileId);
    if (requestId != null) this.requestIds.set(requestId, id);
    const unsupported = this.lines(fileId).map(modelOf).find((m) => this.unsupportedModel(m)) ?? null;
    if (unsupported != null) {
      this.status.set(id, 'failed');
      this.errors.set(
        id,
        `JSONL model validation failed: 1 unsupported model(s), e.g. unsupported model "${unsupported}": not available on DigitalOcean`,
      );
      return this.get(id);
    }
    this.status.set(id, this.holding ? 'in_progress' : 'completed');
    for (const line of this.lines(fileId)) this.submittedList.push(request(line));
    return this.get(id);
  }

  async get(batchId: string): Promise<BatchInfo> {
    return this.getSync(batchId);
  }

  private getSync(batchId: string): BatchInfo {
    const s = this.status.get(batchId);
    if (s === undefined) throw new LlmApiError(404, `No batch ${batchId}`);
    const node: JsonObject = { id: batchId, status: s };
    const error = this.errors.get(batchId) ?? null;
    if (error != null) {
      node.error_message = error;
      node.request_counts = { total: 0, completed: 0, failed: 0 };
    }
    return new BatchInfo(batchId, s, nodeToString(node), error);
  }

  async findByRequestId(requestId: string | null): Promise<BatchInfo | null> {
    const id = requestId == null ? undefined : this.requestIds.get(requestId);
    return id === undefined ? null : this.getSync(id);
  }

  async results(batchId: string): Promise<BatchResults> {
    const s = this.getSync(batchId).status;
    if (this.errors.has(batchId)) return { available: false, outputFileUrl: null, errorFileUrl: null };
    if (s !== 'completed') return { available: false, outputFileUrl: null, errorFileUrl: null };
    return { available: true, outputFileUrl: `fake://output/${batchId}`, errorFileUrl: null };
  }

  async download(url: string): Promise<Uint8Array> {
    const batchId = url.substring(url.lastIndexOf('/') + 1);
    let sb = '';
    for (const line of this.lines(this.batchFile.get(batchId) ?? null)) {
      const req = request(line);
      let input: JsonValue | null;
      try {
        input = await this.responder(req);
      } catch {
        input = null;
      }
      const result: JsonObject = {};
      const out: JsonObject = { custom_id: req.customId, result };
      if (input == null) {
        result.type = 'errored';
        result.error = { type: 'fake_error', message: 'no scripted answer' };
      } else {
        result.type = 'succeeded';
        result.message = {
          role: 'assistant',
          content: [{ type: 'tool_use', name: req.toolName, input }],
          usage: {
            input_tokens: Math.trunc(nodeToString(req.raw).length / 4),
            output_tokens: Math.trunc(nodeToString(input).length / 4),
          },
        };
      }
      sb += nodeToString(out) + '\n';
    }
    return encoder.encode(sb);
  }

  async cancel(batchId: string): Promise<void> {
    this.cancelledList.push(batchId);
    if (this.status.has(batchId)) this.status.set(batchId, 'cancelled');
  }

  /** Batch ids cancel() was called for. */
  cancelled(): string[] {
    return [...this.cancelledList];
  }

  private lines(fileId: string | null): JsonValue[] {
    const out: JsonValue[] = [];
    const bytes = fileId == null ? undefined : this.files.get(fileId);
    if (bytes === undefined) return out;
    for (const l of javaSplit(decoder.decode(bytes), /\n/)) {
      if (jIsBlank(l)) continue;
      try {
        out.push(JSON.parse(l) as JsonValue);
      } catch {
        throw new LlmApiError(400, 'Invalid JSONL line');
      }
    }
    return out;
  }
}

/** The model id of a batch line (OpenAI body.model / Anthropic params.model). */
function modelOf(line: JsonValue): string {
  return has(line, 'body') ? asText(path(path(line, 'body'), 'model')) : asText(path(path(line, 'params'), 'model'));
}

/** Anthropic lines {custom_id, params} or OpenAI lines {custom_id, body}. */
function request(line: JsonValue): FakeLlmRequest {
  const id = asText(path(line, 'custom_id'));
  return has(line, 'params') ? fromAnthropic(id, path(line, 'params')!) : fromChat(id, path(line, 'body') ?? null);
}
