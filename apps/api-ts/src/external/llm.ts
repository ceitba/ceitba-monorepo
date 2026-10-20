// external/llm/*: inference for the wiki pipeline (DigitalOcean batch + sync
// chat), embeddings (OpenAI-compatible) and DO's model catalog.
//
// Selection (config/KbPipelineConfig): KB_LLM_USE_FAKE=true -> FakeLlmBatchClient /
// FakeSyncChatClient / FakeDoModelCatalog; KB_LLM_API_KEY empty -> Unconfigured*;
// embeddings: KB_EMBEDDING_USE_FAKE (default KB_LLM_USE_FAKE) -> FakeEmbeddingClient(768),
// KB_EMBEDDING_BASE_URL empty -> Unconfigured.
//
// NOT PORTED YET (kb feature agent): DoBatchClient, DoChatClient, HttpDoModelCatalog,
// OpenAiEmbeddingClient, DoQuotaTracker, DoBatchErrors, LlmOutputParser. Until
// then the real slots are the Unconfigured clients (available() false).

import type { Config } from '../config';

/** LlmApiException: a failed inference call (status 0 = no response). */
export class LlmApiError extends Error {
  constructor(readonly status: number, message: string, override readonly cause?: unknown) {
    super(message);
  }
}

// ------------------------------------------------------------------ batch

export interface FileUpload { fileId: string; uploadUrl: string }
export interface BatchInfo { id: string; status: string; raw: string; errorMessage: string | null }
export interface BatchResults { available: boolean; outputFileUrl: string | null; errorFileUrl: string | null }

export function batchFinished(b: BatchInfo): boolean {
  return ['completed', 'failed', 'cancelled', 'expired'].includes(b.status ?? '');
}

export interface LlmBatchClient {
  available(): boolean;
  createFile(fileName: string): Promise<FileUpload>;
  upload(uploadUrl: string, bytes: Uint8Array): Promise<void>;
  createBatch(fileId: string, requestId: string | null, provider: string, endpoint: string | null): Promise<BatchInfo>;
  get(batchId: string): Promise<BatchInfo>;
  results(batchId: string): Promise<BatchResults>;
  download(url: string): Promise<Uint8Array>;
  cancel(batchId: string): Promise<void>;
  probeQuota(): Promise<void>;
  findByRequestId(requestId: string): Promise<BatchInfo | null>;
}

export interface SyncChatClient {
  available(): boolean;
  /** One chat completion (JSON body in, JSON response out). */
  complete(body: Record<string, unknown>): Promise<Record<string, unknown>>;
  listModels(): Promise<string[]>;
}

export interface EmbeddingClient {
  available(): boolean;
  /** One vector per input, in input order. */
  embed(model: string, inputs: string[]): Promise<Float32Array[]>;
}

export interface DoModelCatalog {
  fetch(): Promise<Record<string, unknown>[]>;
}

// ------------------------------------------------------------ unconfigured

export class UnconfiguredLlmBatchClient implements LlmBatchClient {
  private fail(): never { throw new LlmApiError(0, 'LLM inference is not configured (KB_LLM_API_KEY)'); }
  available() { return false; }
  createFile(): Promise<FileUpload> { return this.fail(); }
  upload(): Promise<void> { return this.fail(); }
  createBatch(): Promise<BatchInfo> { return this.fail(); }
  get(): Promise<BatchInfo> { return this.fail(); }
  results(): Promise<BatchResults> { return this.fail(); }
  download(): Promise<Uint8Array> { return this.fail(); }
  cancel(): Promise<void> { return this.fail(); }
  async probeQuota() {}
  async findByRequestId() { return null; }
}

export class UnconfiguredSyncChatClient implements SyncChatClient {
  available() { return false; }
  complete(): Promise<Record<string, unknown>> { throw new LlmApiError(0, 'LLM inference is not configured (KB_LLM_API_KEY)'); }
  async listModels() { return []; }
}

export class UnconfiguredEmbeddingClient implements EmbeddingClient {
  available() { return false; }
  embed(): Promise<Float32Array[]> { throw new LlmApiError(0, 'embeddings are not configured'); }
}

// ------------------------------------------------------------------ fakes

/** FakeLlmRequest: what a fake hands to the test's responder. customId is null in sync mode. */
export interface FakeLlmRequest {
  customId: string | null;
  model: string | null;
  toolName: string | null;
  system: string;
  userText: string;
  raw: Record<string, unknown>;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : v == null ? null : String(v));

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  return arr(content).map((b) => (obj(b).text != null ? String(obj(b).text) : '')).join('');
}

export function fakeRequestFromAnthropic(customId: string, params: Json): FakeLlmRequest {
  const user = arr(params.messages).map((m) => textOf(obj(m).content)).join('');
  return {
    customId, model: str(params.model), toolName: str(obj(params.tool_choice).name),
    system: typeof params.system === 'string' ? params.system : '', userText: user, raw: params,
  };
}

export function fakeRequestFromChat(customId: string | null, body: Json): FakeLlmRequest {
  let user = '';
  let system = '';
  for (const m of arr(body.messages)) {
    const t = textOf(obj(m).content);
    if (obj(m).role === 'system') system += t; else user += t;
  }
  let tool = str(obj(obj(body.tool_choice).function).name);
  if (tool === null) {
    // json_object fallback: the tool is named in the system prompt.
    const m = /JSON schema of (\w+):/.exec(system);
    if (m) tool = m[1]!;
  }
  return { customId, model: str(body.model), toolName: tool, system, userText: user, raw: body };
}

type Responder = (r: FakeLlmRequest) => Json | null;

/** FakeSyncChatClient (kb.llm.use-fake): answers through `respond`, tool calls or JSON content. */
export class FakeSyncChatClient implements SyncChatClient {
  private receivedList: FakeLlmRequest[] = [];
  private responder: Responder = () => null;
  private toolCallsOn = true;
  private prose = false;
  private static readonly DEFAULT_MODELS = ['glm-5.3', 'glm-5.3-flash', 'anthropic-claude-haiku-4.5'];
  private modelList = FakeSyncChatClient.DEFAULT_MODELS;

  reset() { this.receivedList = []; this.responder = () => null; this.toolCallsOn = true; this.prose = false; this.modelList = FakeSyncChatClient.DEFAULT_MODELS; }
  respond(r: Responder) { this.responder = r; }
  toolCalls(on: boolean) { this.toolCallsOn = on; }
  proseUnlessJsonObject(on: boolean) { this.prose = on; }
  models(m: string[]) { this.modelList = [...m]; }
  received() { return [...this.receivedList]; }
  available() { return true; }

  async complete(body: Json): Promise<Json> {
    const req = fakeRequestFromChat(null, body);
    this.receivedList.push(req);
    let answer: Json | null;
    try { answer = this.responder(req); } catch { answer = null; }
    if (answer == null) throw new LlmApiError(400, 'fake: no scripted answer');
    const msg: Json = { role: 'assistant' };
    const jsonObject = obj(body.response_format).type === 'json_object';
    if (this.prose && !jsonObject) {
      msg.content = 'Claro, acá va mi respuesta en prosa.';
    } else if (this.toolCallsOn && req.toolName != null) {
      msg.tool_calls = [{ id: 'call_1', type: 'function', function: { name: req.toolName, arguments: JSON.stringify(answer) } }];
      msg.content = null;
    } else {
      msg.content = JSON.stringify(answer);
    }
    const prompt = Math.floor(JSON.stringify(body).length / 4);
    return {
      id: 'chatcmpl-fake', model: str(body.model) ?? '', choices: [{ message: msg }],
      usage: { prompt_tokens: prompt, completion_tokens: Math.floor(JSON.stringify(answer).length / 4), prompt_tokens_details: { cached_tokens: Math.floor(prompt / 2) } },
    };
  }

  async listModels() { return this.modelList; }
}

/** FakeLlmBatchClient (kb.llm.use-fake): batches complete at once (or stay in_progress while held). */
export class FakeLlmBatchClient implements LlmBatchClient {
  private files = new Map<string, Uint8Array>();
  private batchFile = new Map<string, string>();
  private status = new Map<string, string>();
  private submittedList: FakeLlmRequest[] = [];
  private ids = 0;
  private responder: Responder = () => null;
  private holding = false;
  private cancelledList: string[] = [];
  private requestIds = new Map<string, string>();
  private errors = new Map<string, string>();
  private createFailures: LlmApiError[] = [];
  private unsupported: (model: string) => boolean = () => false;
  private createCallCount = 0;

  reset() {
    this.files.clear(); this.batchFile.clear(); this.status.clear(); this.submittedList = []; this.cancelledList = [];
    this.responder = () => null; this.holding = false; this.requestIds.clear(); this.errors.clear();
    this.createFailures = []; this.unsupported = () => false; this.createCallCount = 0; this.ids = 0;
  }
  failNextCreate(...f: LlmApiError[]) { this.createFailures.push(...f); }
  unsupportedModels(p: (model: string) => boolean) { this.unsupported = p; }
  createCalls() { return this.createCallCount; }
  respond(r: Responder) { this.responder = r; }
  hold(on: boolean) { this.holding = on; }
  release() {
    this.holding = false;
    for (const [k, v] of this.status) if (v === 'in_progress') this.status.set(k, 'completed');
  }
  submitted() { return [...this.submittedList]; }
  batchCount() { return this.batchFile.size; }
  cancelled() { return [...this.cancelledList]; }
  available() { return true; }

  async createFile(): Promise<FileUpload> {
    const id = `file-${++this.ids}`;
    return { fileId: id, uploadUrl: `fake://upload/${id}` };
  }
  async upload(url: string, bytes: Uint8Array) { this.files.set(url.slice(url.lastIndexOf('/') + 1), bytes); }

  async createBatch(fileId: string, requestId: string | null): Promise<BatchInfo> {
    this.createCallCount++;
    const failure = this.createFailures.shift();
    if (failure) throw failure;
    if (!this.files.has(fileId)) throw new LlmApiError(404, `No uploaded file ${fileId}`);
    const id = `batch-${++this.ids}`;
    this.batchFile.set(id, fileId);
    if (requestId != null) this.requestIds.set(requestId, id);
    const lines = this.lines(fileId);
    const bad = lines.map(modelOf).find((m) => this.unsupported(m));
    if (bad !== undefined) {
      this.status.set(id, 'failed');
      this.errors.set(id, `JSONL model validation failed: 1 unsupported model(s), e.g. unsupported model "${bad}": not available on DigitalOcean`);
      return this.get(id);
    }
    this.status.set(id, this.holding ? 'in_progress' : 'completed');
    for (const l of lines) this.submittedList.push(request(l));
    return this.get(id);
  }

  async get(batchId: string): Promise<BatchInfo> {
    const s = this.status.get(batchId);
    if (s === undefined) throw new LlmApiError(404, `No batch ${batchId}`);
    const node: Json = { id: batchId, status: s };
    const error = this.errors.get(batchId) ?? null;
    if (error) {
      node.error_message = error;
      node.request_counts = { total: 0, completed: 0, failed: 0 };
    }
    return { id: batchId, status: s, raw: JSON.stringify(node), errorMessage: error };
  }

  async findByRequestId(requestId: string) {
    const id = this.requestIds.get(requestId);
    return id ? this.get(id) : null;
  }

  async results(batchId: string): Promise<BatchResults> {
    const s = (await this.get(batchId)).status;
    if (this.errors.has(batchId) || s !== 'completed') return { available: false, outputFileUrl: null, errorFileUrl: null };
    return { available: true, outputFileUrl: `fake://output/${batchId}`, errorFileUrl: null };
  }

  async download(url: string): Promise<Uint8Array> {
    const batchId = url.slice(url.lastIndexOf('/') + 1);
    let out = '';
    for (const line of this.lines(this.batchFile.get(batchId) ?? '')) {
      const req = request(line);
      let input: Json | null;
      try { input = this.responder(req); } catch { input = null; }
      const result: Json = input == null
        ? { type: 'errored', error: { type: 'fake_error', message: 'no scripted answer' } }
        : {
          type: 'succeeded',
          message: {
            role: 'assistant',
            content: [{ type: 'tool_use', name: req.toolName, input }],
            usage: { input_tokens: Math.floor(JSON.stringify(req.raw).length / 4), output_tokens: Math.floor(JSON.stringify(input).length / 4) },
          },
        };
      out += `${JSON.stringify({ custom_id: req.customId, result })}\n`;
    }
    return new TextEncoder().encode(out);
  }

  async cancel(batchId: string) {
    this.cancelledList.push(batchId);
    if (this.status.has(batchId)) this.status.set(batchId, 'cancelled');
  }
  async probeQuota() {}

  private lines(fileId: string): Json[] {
    const bytes = this.files.get(fileId);
    if (!bytes) return [];
    return new TextDecoder().decode(bytes).split('\n').filter((l) => l.trim() !== '').map((l) => {
      try { return JSON.parse(l) as Json; } catch { throw new LlmApiError(400, 'Invalid JSONL line'); }
    });
  }
}

function modelOf(line: Json): string {
  return 'body' in line ? String(obj(line.body).model ?? '') : String(obj(line.params).model ?? '');
}
function request(line: Json): FakeLlmRequest {
  const id = String(line.custom_id ?? '');
  return 'params' in line ? fakeRequestFromAnthropic(id, obj(line.params)) : fakeRequestFromChat(id, obj(line.body));
}

/** Java Arrays.hashCode(byte[]) (signed bytes). */
function javaBytesHash(bytes: Uint8Array): number {
  let h = 1;
  for (const b of bytes) h = (Math.imul(31, h) + ((b << 24) >> 24)) | 0;
  return h;
}

/** FakeEmbeddingClient: hashed bag of words (same buckets as Java), never all-zero. */
export class FakeEmbeddingClient implements EmbeddingClient {
  callCount = 0;
  constructor(private readonly dimensions = 768) {}
  available() { return true; }
  async embed(_model: string, inputs: string[]): Promise<Float32Array[]> {
    this.callCount++;
    return inputs.map((t) => this.vector(t));
  }
  calls() { return this.callCount; }
  private vector(text: string): Float32Array {
    const v = new Float32Array(this.dimensions);
    const folded = text.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
    for (const word of folded.split(/[^a-z0-9]+/)) {
      if (word.length < 3) continue;
      const h = javaBytesHash(new TextEncoder().encode(word));
      v[((h % this.dimensions) + this.dimensions) % this.dimensions]! += 1;
    }
    if (v.every((x) => x === 0)) v[0] = 1;
    return v;
  }
}

/** FakeDoModelCatalog: unreachable until items() is set. */
export class FakeDoModelCatalog implements DoModelCatalog {
  private list: Json[] | null = null;
  items(i: Json[]) { this.list = i; }
  async fetch() {
    if (this.list === null) throw new LlmApiError(0, 'fake catalog unreachable');
    return this.list;
  }
}

export class UnconfiguredDoModelCatalog implements DoModelCatalog {
  async fetch(): Promise<Json[]> { throw new LlmApiError(0, 'DO model catalog client is not ported yet'); }
}

export interface LlmClients {
  batch: LlmBatchClient;
  chat: SyncChatClient;
  catalog: DoModelCatalog;
  embeddings: EmbeddingClient;
}

export function createLlmClients(config: Config): LlmClients {
  const kb = config.kb;
  const fake = kb.llm.useFake;
  return {
    batch: fake ? new FakeLlmBatchClient() : new UnconfiguredLlmBatchClient(),
    chat: fake ? new FakeSyncChatClient() : new UnconfiguredSyncChatClient(),
    catalog: fake ? new FakeDoModelCatalog() : new UnconfiguredDoModelCatalog(),
    embeddings: kb.embeddings.useFake ? new FakeEmbeddingClient(768) : new UnconfiguredEmbeddingClient(),
  };
}
