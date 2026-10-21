// external/llm/*: inference for the wiki pipeline (DigitalOcean batch + sync
// chat), embeddings (OpenAI-compatible) and DO's model catalog.
//
// Selection (config/KbPipelineConfig): KB_LLM_USE_FAKE=true -> FakeLlmBatchClient /
// FakeSyncChatClient / FakeDoModelCatalog; KB_LLM_API_KEY empty -> Unconfigured*
// (batch/chat); otherwise DoBatchClient / DoChatClient (src/external/llm/doBatchClient.ts,
// src/features/kb/logic/external/doChatClient.ts), all sharing one DoQuotaTracker.
// The catalog is HttpDoModelCatalog unless faked (DO's public catalog needs no key).
// Embeddings: KB_EMBEDDING_USE_FAKE (default KB_LLM_USE_FAKE) -> FakeEmbeddingClient(768),
// KB_EMBEDDING_BASE_URL empty -> Unconfigured (the OpenAI-compatible client is
// src/external/llm/embedding.ts).
//
// The batch/chat types, fakes and errors are the kb logic's ports
// (src/features/kb/logic/external/*), re-exported here.

import type { Config } from '../config';
import { DoChatClient } from '../features/kb/logic/external/doChatClient';
import { DoQuotaTracker } from '../features/kb/logic/external/doQuotaTracker';
import { FakeLlmBatchClient, FakeSyncChatClient } from '../features/kb/logic/external/fakeLlm';
import { LlmApiError, type LlmBatchClient, type SyncChatClient } from '../features/kb/logic/external/llmApi';
import { UnconfiguredLlmBatchClient, UnconfiguredSyncChatClient } from '../features/kb/logic/external/unconfigured';
import { odtFromMicros } from '../features/kb/logic/odt';
import { systemNowMicros } from '../lib/time';
import { DoBatchClient } from './llm/doBatchClient';
import { HttpDoModelCatalog } from './llm/doModelCatalog';

export { DoQuotaTracker, LlmApiError, FakeLlmBatchClient, FakeSyncChatClient, UnconfiguredLlmBatchClient, UnconfiguredSyncChatClient };
export { BatchInfo, DoBatchSlotError, DoQuotaExhaustedError } from '../features/kb/logic/external/llmApi';
export type { BatchResults, FileUpload, LlmBatchClient, SyncChatClient } from '../features/kb/logic/external/llmApi';
export type { FakeLlmRequest } from '../features/kb/logic/external/fakeLlm';

export interface DoModelCatalog {
  fetch(): Promise<Record<string, unknown>[]>;
}

// ------------------------------------------------------------ embeddings

export interface EmbeddingClient {
  available(): boolean;
  /** One vector per input, in input order. */
  embed(model: string, inputs: string[]): Promise<Float32Array[]>;
}

export class UnconfiguredEmbeddingClient implements EmbeddingClient {
  available() { return false; }
  embed(): Promise<Float32Array[]> { throw new LlmApiError(0, 'embeddings are not configured'); }
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
  private list: Record<string, unknown>[] | null = null;
  items(i: Record<string, unknown>[] | null) { this.list = i; }
  async fetch() {
    if (this.list === null) throw new LlmApiError(0, 'fake catalog unreachable');
    return this.list;
  }
}

export interface LlmClients {
  batch: LlmBatchClient;
  chat: SyncChatClient;
  catalog: DoModelCatalog;
  embeddings: EmbeddingClient;
  /** The process' DoQuotaTracker, fed by the DO clients' x-ratelimit-* headers (KbPipelineConfig.doQuotaTracker). */
  quota?: DoQuotaTracker;
}

export function createLlmClients(config: Config): LlmClients {
  const kb = config.kb;
  const fake = kb.llm.useFake;
  const hasKey = kb.llm.apiKey.trim() !== '';
  const quota = new DoQuotaTracker(() => odtFromMicros(systemNowMicros()));
  return {
    batch: fake ? new FakeLlmBatchClient() : hasKey ? new DoBatchClient(kb.llm.baseUrl, kb.llm.apiKey, { quota }) : new UnconfiguredLlmBatchClient(),
    chat: fake ? new FakeSyncChatClient() : hasKey
      ? new DoChatClient(kb.llm.baseUrl, kb.llm.apiKey, { timeoutMs: kb.llm.requestTimeoutMs, quota }) : new UnconfiguredSyncChatClient(),
    catalog: fake ? new FakeDoModelCatalog() : new HttpDoModelCatalog(),
    embeddings: kb.embeddings.useFake ? new FakeEmbeddingClient(768) : new UnconfiguredEmbeddingClient(),
    quota,
  };
}
