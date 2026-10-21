// Port of apps/api/src/main/java/org/ceitba/api/external/llm/DoChatClient.java, over fetch.
//
// DigitalOcean serverless inference, OpenAI-compatible chat completions.
// A 429 tokens_per_day throws DoQuotaExhaustedError at once (no retries).
// Every response's x-ratelimit-* headers go to the DoQuotaTracker.
// 429, 5xx and I/O errors are retried up to 4 times with exponential
// back-off (honouring Retry-After). A request that times out is not retried
// here: the run engine already resends unanswered requests once.
// (Java's 20 s connect timeout has no fetch equivalent; the request timeout covers it.)

import { jIsBlank, jTrim } from '../javaString';
import { asText, elements, hasNonNull, path, type JsonValue } from '../jsonNode';
import type { DoQuotaTracker } from './doQuotaTracker';
import { DoQuotaExhaustedError, LlmApiError, type SyncChatClient } from './llmApi';

export const MAX_ATTEMPTS = 4;

export interface DoChatClientOptions {
  timeoutMs?: number;
  quota?: DoQuotaTracker | null;
  /** Injectable for tests. */
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export class DoChatClient implements SyncChatClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly quota: DoQuotaTracker | null;
  private readonly doFetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  /** "/v1" for DO (base URL is the host), "" for custom endpoints whose base URL already ends in /v1. */
  private apiPrefix = '/v1';

  constructor(baseUrl: string, private readonly apiKey: string, opts: DoChatClientOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? 5 * 60_000;
    this.quota = opts.quota ?? null;
    this.doFetch = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.random = opts.random ?? Math.random;
  }

  /**
   * A custom OpenAI-compatible server (llama.cpp, vLLM, ...): baseUrl includes /v1
   * (calls go to {baseUrl}/chat/completions and {baseUrl}/models); a blank key sends
   * no Authorization header.
   */
  static openAiCompatible(baseUrl: string, apiKey: string | null, timeoutMs: number, opts: Omit<DoChatClientOptions, 'timeoutMs' | 'quota'> = {}): DoChatClient {
    const c = new DoChatClient(baseUrl, apiKey ?? '', { ...opts, timeoutMs, quota: null });
    c.apiPrefix = '';
    return c;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { ...extra };
    if (this.apiKey != null && !jIsBlank(this.apiKey)) h.Authorization = `Bearer ${this.apiKey}`;
    return h;
  }

  available(): boolean {
    return true;
  }

  async complete(body: JsonValue): Promise<JsonValue> {
    let delay = 1000;
    for (let attempt = 1; ; attempt++) {
      let status = 0;
      let detail: string;
      let retryAfter = -1;
      try {
        const res = await this.doFetch(`${this.baseUrl}${this.apiPrefix}/chat/completions`, {
          method: 'POST',
          headers: this.headers({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        status = res.status;
        this.quota?.observe(res.headers);
        const text = await res.text();
        if (Math.trunc(status / 100) === 2) {
          try {
            return JSON.parse(text) as JsonValue;
          } catch (e) {
            // Java: a JsonProcessingException is an IOException with the 2xx status kept
            detail = e instanceof Error ? e.message : String(e);
            throw new LlmApiError(status, `chat/completions -> ${status}: ${detail}`);
          }
        }
        detail = text.length > 500 ? text.substring(0, 500) : text;
        // The daily token bucket does not refill within a retry's reach: no retries.
        if (status === 429 && DoQuotaExhaustedError.isDailyTokens(text)) {
          throw new DoQuotaExhaustedError(`chat/completions -> 429: ${detail}`);
        }
        const ra = res.headers.get('Retry-After');
        if (ra != null) {
          const t = jTrim(ra);
          retryAfter = /^[+-]?\d+$/.test(t) ? Number(t) * 1000 : -1;
        }
      } catch (e) {
        if (e instanceof LlmApiError) throw e;
        if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
          throw new LlmApiError(0, `chat/completions -> 0: timed out after ${Math.trunc(this.timeoutMs / 1000)} s`);
        }
        detail = e instanceof Error ? e.message : String(e);
      }
      const transientError = status === 0 || status === 429 || status >= 500;
      if (!transientError || attempt >= MAX_ATTEMPTS) {
        throw new LlmApiError(status, `chat/completions -> ${status}: ${detail}`);
      }
      await this.sleep(retryAfter > 0 ? Math.min(retryAfter, 60_000) : delay + Math.floor(this.random() * 250));
      delay *= 2;
    }
  }

  async listModels(): Promise<string[]> {
    let res: Response;
    let text: string;
    try {
      res = await this.doFetch(`${this.baseUrl}${this.apiPrefix}/models`, {
        method: 'GET',
        headers: this.headers(),
        signal: AbortSignal.timeout(60_000),
      });
      text = await res.text();
    } catch (e) {
      throw new LlmApiError(0, `GET /v1/models: ${e instanceof Error ? e.message : String(e)}`, e);
    }
    if (Math.trunc(res.status / 100) !== 2) throw new LlmApiError(res.status, 'GET /v1/models failed');
    let parsed: JsonValue;
    try {
      parsed = JSON.parse(text) as JsonValue;
    } catch (e) {
      throw new LlmApiError(0, `GET /v1/models: ${e instanceof Error ? e.message : String(e)}`, e);
    }
    const out: string[] = [];
    for (const m of elements(path(parsed, 'data'))) {
      if (hasNonNull(m, 'id')) out.push(asText(path(m, 'id')));
    }
    return out;
  }
}
