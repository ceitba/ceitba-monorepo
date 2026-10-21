// Ports of apps/api/src/main/java/org/ceitba/api/external/llm/{LlmApiException, DoQuotaExhaustedException,
// DoBatchSlotException, LlmBatchClient, SyncChatClient}.java.
//
// The clients are async here (Java's are blocking): every call returns a Promise.

import type { JsonValue } from '../jsonNode';
import type { Odt } from '../odt';

/** A failed call to the inference API (status 0 = no response). */
export class LlmApiError extends Error {
  constructor(readonly status: number, message: string, override readonly cause?: unknown) {
    super(message);
    this.name = 'LlmApiException';
  }
}

/**
 * DO answered 429 "tokens_per_day": the daily sync token quota is spent.
 * Retrying within seconds is pointless, so callers pause the work instead of failing it.
 */
export class DoQuotaExhaustedError extends LlmApiError {
  constructor(message: string) {
    super(429, message);
    this.name = 'DoQuotaExhaustedException';
  }

  /** Whether a 429 body names the daily token quota. */
  static isDailyTokens(body: string | null): boolean {
    if (body == null) return false;
    const b = body.toLowerCase();
    return b.includes('tokens_per_day') || b.includes('tokens per day');
  }
}

/**
 * Raised before calling DO: the last quota snapshot says no batch creation is
 * left this hour. Classified as RATE_LIMITED (status 429), with `retryAt`.
 */
export class DoBatchSlotError extends LlmApiError {
  constructor(message: string, readonly retryAt: Odt) {
    super(429, message + ' (rate_limit_exceeded)');
    this.name = 'DoBatchSlotException';
  }
}

export interface FileUpload {
  fileId: string;
  uploadUrl: string;
}

/**
 * status: validating | queued | in_progress | completed | failed | cancelling | cancelled | expired
 * (lowercase, as DO reports it). errorMessage: DO's error_message, null when none.
 */
export class BatchInfo {
  constructor(
    readonly id: string | null,
    readonly status: string | null,
    readonly raw: string,
    readonly errorMessage: string | null = null,
  ) {}

  finished(): boolean {
    switch (this.status ?? '') {
      case 'completed':
      case 'failed':
      case 'cancelled':
      case 'expired':
        return true;
      default:
        return false;
    }
  }
}

export interface BatchResults {
  available: boolean;
  outputFileUrl: string | null;
  errorFileUrl: string | null;
}

/**
 * Batch inference (DigitalOcean serverless inference; commercial providers
 * anthropic and openai only). Every call rejects with LlmApiError on failure.
 */
export interface LlmBatchClient {
  available(): boolean;
  /** POST /v1/batches/files {file_name} -> where to PUT the JSONL. */
  createFile(fileName: string): Promise<FileUpload>;
  /** PUT of the raw bytes to the upload URL (no extra headers). */
  upload(uploadUrl: string, bytes: Uint8Array): Promise<void>;
  /** POST /v1/batches {file_id, provider, completion_window: 24h, request_id[, endpoint]}. */
  createBatch(fileId: string, requestId: string | null, provider: string, endpoint: string | null): Promise<BatchInfo>;
  /** GET /v1/batches/{id}. */
  get(batchId: string): Promise<BatchInfo>;
  /** GET /v1/batches/{id}/results. */
  results(batchId: string): Promise<BatchResults>;
  /** Downloads an output/error file URL (signed; no auth header). */
  download(url: string): Promise<Uint8Array>;
  /** POST /v1/batches/{id}/cancel. */
  cancel(batchId: string): Promise<void>;
  /** Refreshes the quota snapshot for free (DoBatchClient); a no-op elsewhere. */
  probeQuota?(): Promise<void>;
  /** The batch created with this request_id, if DO lists one. */
  findByRequestId?(requestId: string | null): Promise<BatchInfo | null>;
}

/**
 * Synchronous OpenAI-compatible chat completions (POST /v1/chat/completions).
 * complete() retries 429/5xx/I-O with back-off; rejects with LlmApiError when it finally fails.
 */
export interface SyncChatClient {
  available(): boolean;
  complete(body: JsonValue): Promise<JsonValue>;
  /** GET /v1/models: the model ids the key can use. */
  listModels(): Promise<string[]>;
}
