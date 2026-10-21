// Port of apps/api/src/main/java/org/ceitba/api/external/llm/DoBatchClient.java, over fetch.
//
// DigitalOcean serverless inference, batch API (https://inference.do-ai.run).
// Bearer = a DO model access key. Anthropic requests: provider "anthropic", no
// `endpoint`. Responses are read defensively (field names vary between
// providers/versions: id|batch_id, file_id|id, upload_url|url) by the pure readers
// in src/features/kb/logic/external/doBatchClient.ts. Every response's
// x-ratelimit-* headers go to the DoQuotaTracker. Errors are
// LlmApiError(status, "<METHOD> <path> -> <status>: <body cut at 500>...").
// Java's 20 s connect timeout has no fetch equivalent; each call's own timeout
// (60 s API calls, 5 min uploads/downloads) covers connecting too.

import { batchList, info, jsonlFileName, resultsOf } from '../../features/kb/logic/external/doBatchClient';
import type { DoQuotaTracker } from '../../features/kb/logic/external/doQuotaTracker';
import { BatchInfo, LlmApiError, type BatchResults, type FileUpload, type LlmBatchClient } from '../../features/kb/logic/external/llmApi';
import { isTextual, path, type JsonObject, type JsonValue } from '../../features/kb/logic/jsonNode';

const API_TIMEOUT_MS = 60_000;
const TRANSFER_TIMEOUT_MS = 5 * 60_000;

function abbreviate(s: string): string {
  return s.length <= 500 ? s : s.substring(0, 500) + '...';
}

function text(node: JsonValue, ...names: string[]): string | null {
  for (const n of names) {
    const v = path(node, n);
    if (isTextual(v) && v.trim() !== '') return v;
  }
  const data = path(node, 'data');
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) return text(data, ...names);
  return null;
}

function ioMessage(e: unknown): string {
  if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) return 'request timed out';
  return e instanceof Error ? e.message : String(e);
}

export interface DoBatchClientOptions {
  quota?: DoQuotaTracker | null;
  /** Injectable for tests. */
  fetch?: typeof fetch;
}

export class DoBatchClient implements LlmBatchClient {
  private readonly baseUrl: string;
  private readonly quota: DoQuotaTracker | null;
  private readonly doFetch: typeof fetch;

  constructor(baseUrl: string, private readonly apiKey: string, opts: DoBatchClientOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.quota = opts.quota ?? null;
    this.doFetch = opts.fetch ?? fetch;
  }

  available(): boolean {
    return true;
  }

  async createFile(fileName: string): Promise<FileUpload> {
    const node = await this.call('POST', '/v1/batches/files', { file_name: jsonlFileName(fileName) });
    const fileId = text(node, 'file_id', 'id');
    const url = text(node, 'upload_url', 'url');
    if (fileId == null || url == null) throw new LlmApiError(0, 'Unexpected createFile response: ' + JSON.stringify(node));
    return { fileId, uploadUrl: url };
  }

  /** PUT of the raw bytes to the presigned URL, no extra headers. */
  async upload(uploadUrl: string, bytes: Uint8Array): Promise<void> {
    const res = await this.send('PUT', uploadUrl, { body: bytes as unknown as BodyInit, timeoutMs: TRANSFER_TIMEOUT_MS });
    if (Math.trunc(res.status / 100) !== 2) {
      throw new LlmApiError(res.status, 'Upload failed: ' + abbreviate(await res.text()));
    }
  }

  async createBatch(fileId: string, requestId: string | null, provider: string, endpoint: string | null): Promise<BatchInfo> {
    const body: JsonObject = { file_id: fileId, provider, completion_window: '24h', request_id: requestId };
    if (endpoint != null) body.endpoint = endpoint;
    return info(await this.call('POST', '/v1/batches', body));
  }

  /**
   * "Free" quota probe: a creation with a nonexistent file_id answers 404 with the
   * batch rate-limit headers. Never throws. (The pipeline does not call it: DO
   * counts the creation.)
   */
  async probeQuota(): Promise<void> {
    try {
      await this.createBatch('00000000-0000-0000-0000-000000000000', 'quota-probe', 'openai', '/v1/chat/completions');
    } catch (e) {
      if (!(e instanceof LlmApiError)) throw e;
      // 404 (headers already observed)
    }
  }

  async get(batchId: string): Promise<BatchInfo> {
    return info(await this.call('GET', '/v1/batches/' + batchId, null));
  }

  async results(batchId: string): Promise<BatchResults> {
    return resultsOf(await this.call('GET', `/v1/batches/${batchId}/results`, null));
  }

  async download(url: string): Promise<Uint8Array> {
    const res = await this.send('GET', url, { timeoutMs: TRANSFER_TIMEOUT_MS });
    if (Math.trunc(res.status / 100) !== 2) throw new LlmApiError(res.status, 'Download failed');
    return new Uint8Array(await res.arrayBuffer());
  }

  async cancel(batchId: string): Promise<void> {
    await this.call('POST', `/v1/batches/${batchId}/cancel`, {});
  }

  async findByRequestId(requestId: string | null): Promise<BatchInfo | null> {
    if (requestId == null) return null;
    const node = await this.call('GET', '/v1/batches', null);
    for (const item of batchList(node)) {
      if (requestId === text(item, 'request_id')) return info(item);
    }
    return null;
  }

  private async call(method: string, p: string, body: JsonValue | null): Promise<JsonValue> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.apiKey}`, Accept: 'application/json' };
    let payload: string | undefined;
    if (body != null) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await this.send(method, this.baseUrl + p, { headers, body: payload, timeoutMs: API_TIMEOUT_MS, path: p });
    this.quota?.observe(res.headers);
    let t: string;
    try {
      t = await res.text();
    } catch (e) {
      throw new LlmApiError(0, `${method} ${p}: ${ioMessage(e)}`, e);
    }
    if (Math.trunc(res.status / 100) !== 2) {
      throw new LlmApiError(res.status, `${method} ${p} -> ${res.status}: ${abbreviate(t)}`);
    }
    if (t.trim() === '') return {};
    try {
      return JSON.parse(t) as JsonValue;
    } catch (e) {
      throw new LlmApiError(0, `${method} ${p}: ${ioMessage(e)}`, e);
    }
  }

  private async send(method: string, url: string, o: { headers?: Record<string, string>; body?: BodyInit; timeoutMs: number; path?: string }): Promise<Response> {
    try {
      return await this.doFetch(url, { method, headers: o.headers, body: o.body, redirect: 'follow', signal: AbortSignal.timeout(o.timeoutMs) });
    } catch (e) {
      let p = o.path;
      if (p == null) {
        try {
          p = new URL(url).pathname;
        } catch {
          p = url;
        }
      }
      throw new LlmApiError(0, `${method} ${p}: ${ioMessage(e)}`, e);
    }
  }
}
