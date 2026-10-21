// external/llm/OpenAiEmbeddingClient + EmbeddingUnreachableException, and the
// selection KbPipelineConfig.embeddingClient makes (fake / unconfigured / OpenAI).
//
// OpenAI-compatible POST {baseUrl}/embeddings: the self-hosted llama.cpp server
// (ceitba-embeddings in docker-compose.yml), or TEI, vLLM or a hosted API. A
// blank key sends no Authorization header. The body is only model, input and
// encoding_format. 429, 5xx and connection errors are retried (up to 4 attempts,
// exponential back-off from 1 s plus up to 250 ms jitter, Retry-After honoured,
// capped at 60 s). A timeout is not retried. No HTTP answer in the end (timeout,
// refused, reset) throws EmbeddingUnreachableError.
//
// Deviation: java.net.http has a separate 20 s connect timeout; fetch has one
// signal, so the request timeout covers connecting too.

import type { Config } from '../../config';
import {
  FakeEmbeddingClient, LlmApiError, UnconfiguredEmbeddingClient, type EmbeddingClient,
} from '../llm';
import { javaTrim } from '../../lib/javaCompat';

/** EmbeddingUnreachableException: the server gave no HTTP answer. */
export class EmbeddingUnreachableError extends LlmApiError {
  constructor(message: string) {
    super(0, message);
  }
}

export const MAX_ATTEMPTS = 4;

export interface OpenAiEmbeddingOptions {
  /** Thread.sleep (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
  fetch?: typeof fetch;
}

export class OpenAiEmbeddingClient implements EmbeddingClient {
  private readonly baseUrl: string;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly fetchFn: typeof fetch;

  constructor(baseUrl: string, private readonly apiKey: string | null, private readonly timeoutMs: number, o: OpenAiEmbeddingOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.fetchFn = o.fetch ?? fetch;
  }

  available(): boolean {
    return true;
  }

  async embed(model: string, inputs: string[]): Promise<Float32Array[]> {
    if (inputs.length === 0) return [];
    const body = JSON.stringify({ model, input: inputs, encoding_format: 'float' });
    let delay = 1000;
    for (let attempt = 1; ; attempt++) {
      let status = 0;
      let detail: string;
      let retryAfter = -1;
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (this.apiKey != null && javaTrim(this.apiKey) !== '') headers.Authorization = `Bearer ${this.apiKey}`;
        const res = await this.fetchFn(`${this.baseUrl}/embeddings`, {
          method: 'POST', headers, body, signal: AbortSignal.timeout(this.timeoutMs),
        });
        status = res.status;
        const text = await res.text();
        if (Math.floor(status / 100) === 2) return parse(text, inputs.length);   // never retried
        detail = text.length > 500 ? text.substring(0, 500) : text;
        const ra = res.headers.get('Retry-After');
        if (ra != null) {
          const t = javaTrim(ra);
          retryAfter = /^[+-]?\d+$/.test(t) ? Number(t) * 1000 : -1;
        }
      } catch (e) {
        if (e instanceof LlmApiError) throw e;
        const name = (e as { name?: string })?.name;
        if (name === 'TimeoutError' || name === 'AbortError') {
          throw new EmbeddingUnreachableError(`embeddings -> 0: timed out after ${Math.floor(this.timeoutMs / 1000)} s`);
        }
        status = 0;
        detail = (e as Error)?.message ?? String(e);
      }
      const transientError = status === 0 || status === 429 || status >= 500;
      if (!transientError || attempt >= MAX_ATTEMPTS) {
        if (status === 0) throw new EmbeddingUnreachableError(`embeddings -> 0: ${detail}`);
        throw new LlmApiError(status, `embeddings -> ${status}: ${detail}`);
      }
      await this.sleep(retryAfter > 0 ? Math.min(retryAfter, 60_000) : delay + Math.floor(Math.random() * 250));
      delay *= 2;
    }
  }
}

/** Jackson asInt(-1) / asDouble() of a JSON value. */
function asInt(v: unknown, def: number): number {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : def;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const t = v.trim();
    return /^[+-]?\d+$/.test(t) ? Number(t) : def;
  }
  return def;
}
function asDouble(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const n = Number(v.trim());
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

/** data[] carries an index per vector; order by it, not by position. */
function parse(body: string, expected: number): Float32Array[] {
  let root: unknown;
  try {
    root = JSON.parse(body);
  } catch (e) {
    throw new LlmApiError(0, `embeddings: malformed response: ${(e as Error).message}`, e);
  }
  const dataNode = root && typeof root === 'object' && !Array.isArray(root) ? (root as Record<string, unknown>).data : undefined;
  const items: unknown[] = Array.isArray(dataNode) ? dataNode
    : dataNode && typeof dataNode === 'object' ? Object.values(dataNode as object) : [];
  const out: (Float32Array | null)[] = new Array(expected).fill(null);
  for (const item of items) {
    const o = item && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : {};
    const index = asInt(o.index, -1);
    const e = o.embedding;
    if (index < 0 || index >= expected || !Array.isArray(e)) throw new LlmApiError(0, 'embeddings: malformed response item');
    const v = new Float32Array(e.length);
    for (let i = 0; i < v.length; i++) v[i] = asDouble(e[i]);
    out[index] = v;
  }
  if (out.includes(null)) throw new LlmApiError(0, `embeddings: ${items.length} vectors for ${expected} inputs`);
  return out as Float32Array[];
}

/** kb.embeddings.base-url as KbEmbeddingProperties normalizes it (trim, trailing slashes dropped). */
export function embeddingBaseUrl(config: Config): string {
  return javaTrim(config.kb.embeddings.baseUrl ?? '').replace(/\/+$/, '');
}

/** KbPipelineConfig.embeddingClient: fake when use-fake, unconfigured without a base URL, else OpenAI. */
export function createEmbeddingClient(config: Config): EmbeddingClient {
  const e = config.kb.embeddings;
  if (e.useFake) return new FakeEmbeddingClient(768);
  const base = embeddingBaseUrl(config);
  if (base === '') return new UnconfiguredEmbeddingClient();
  const timeout = e.requestTimeoutMs > 0 ? e.requestTimeoutMs : 120_000;
  return new OpenAiEmbeddingClient(base, e.apiKey, timeout);
}
