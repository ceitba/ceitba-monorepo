// Ports of apps/api/src/main/java/org/ceitba/api/external/llm/{UnconfiguredLlmBatchClient,
// UnconfiguredSyncChatClient}.java: no KB_LLM_API_KEY. The pipeline can preview, baseline and
// dry-run, but cannot submit (services answer 503 KB_LLM_UNCONFIGURED first).

import type { JsonValue } from '../jsonNode';
import { LlmApiError, type BatchInfo, type BatchResults, type FileUpload, type LlmBatchClient, type SyncChatClient } from './llmApi';

const batchUnavailable = () => new LlmApiError(0, 'Batch inference is not configured (KB_LLM_API_KEY)');
const syncUnavailable = () => new LlmApiError(0, 'Inference is not configured (KB_LLM_API_KEY)');

export class UnconfiguredLlmBatchClient implements LlmBatchClient {
  available(): boolean {
    return false;
  }
  async createFile(_fileName: string): Promise<FileUpload> {
    throw batchUnavailable();
  }
  async upload(_url: string, _bytes: Uint8Array): Promise<void> {
    throw batchUnavailable();
  }
  async createBatch(_f: string, _r: string | null, _p: string, _e: string | null): Promise<BatchInfo> {
    throw batchUnavailable();
  }
  async get(_id: string): Promise<BatchInfo> {
    throw batchUnavailable();
  }
  async results(_id: string): Promise<BatchResults> {
    throw batchUnavailable();
  }
  async download(_url: string): Promise<Uint8Array> {
    throw batchUnavailable();
  }
  async cancel(_id: string): Promise<void> {
    throw batchUnavailable();
  }
}

export class UnconfiguredSyncChatClient implements SyncChatClient {
  available(): boolean {
    return false;
  }
  async complete(_body: JsonValue): Promise<JsonValue> {
    throw syncUnavailable();
  }
  async listModels(): Promise<string[]> {
    throw syncUnavailable();
  }
}
