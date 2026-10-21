// Port of apps/api/src/main/java/org/ceitba/api/service/kb/llm/SyncLlmExecutor.java.
//
// SYNC mode: OpenAI-compatible chat completions, KB_SYNC_CONCURRENCY at a
// time; each result is handed to `onResult` as soon as it arrives (the
// engine persists it, so a restart never redoes it). Structured output via
// tools + tool_choice; when no tool call comes back, a JSON object in the
// content is accepted (path content-json); otherwise, unless the answer is
// a page file (starts with ---), it is asked again with response_format
// json_object and the schema in the prompt (path json_object).
//
// Java runs each request on a virtual thread under a Semaphore; here each is a
// promise under the same (FIFO) semaphore, so at most `syncConcurrency` (or a
// custom endpoint's max_concurrency) are in flight, and the lines are pulled
// one at a time only once a slot is free.

import { DoQuotaExhaustedError, LlmApiError, type SyncChatClient } from '../external/llmApi';
import type { DoQuotaTracker } from '../external/doQuotaTracker';
import { fromChatCompletion, llmResult, type LlmResult } from '../external/llmOutputParser';
import { jStrip } from '../javaString';
import { asInt, asLong, asText, at, canConvertToInt, deepCopy, nodeToString, path, size, type JsonObject, type JsonValue } from '../jsonNode';
import { Semaphore } from '../semaphore';
import { chatBody } from './kbChatPayloads';
import { isCustom, type KbEndpointRegistry, type Target } from './kbEndpointRegistry';
import type { KbLlmProperties } from './kbLlmProperties';

/** One request in canonical form (service/kb/llm/LlmLine). */
export interface LlmLine {
  customId: string;
  params: JsonValue;
}

/** One HTTP call of a request: its own usage and latency. */
export interface Attempt {
  tokensIn: number;
  tokensOut: number;
  cachedTokens: number;
  reasoningTokens: number | null;
  latencyMs: number;
}

/** A request's final result plus every HTTP call it took, in order. */
export interface Outcome {
  result: LlmResult;
  attempts: Attempt[];
  latencyMs: number;
}

export const MAX_TOKENS_CAP = 32_000;

const modelOf = (line: LlmLine): string => asText(path(line.params, 'model'), '')!;

/** Rough tokens of a request (prompt at ~4 chars/token plus max_tokens). */
export function estimateTokens(line: LlmLine): number {
  return Math.trunc(nodeToString(line.params).length / 4) + asLong(path(line.params, 'max_tokens'), 4096);
}

const elapsedMs = (t0: number): number => Math.trunc(performance.now() - t0);

const startsWithRetryable = (e: string | null): boolean =>
  e != null && (e.startsWith('TRUNCATED') || e.startsWith('EMPTY_TOOL'));

export type LineSource = Iterable<LlmLine> | AsyncIterable<LlmLine>;

export class SyncLlmExecutor {
  constructor(
    private readonly client: SyncChatClient,
    private readonly props: KbLlmProperties,
    private readonly quota: DoQuotaTracker | null = null,
    private readonly endpoints: KbEndpointRegistry | null = null, // null = no custom endpoints (tests)
    private readonly warn: (msg: string) => void = () => {},
  ) {}

  concurrency(): number {
    return this.props.syncConcurrency;
  }

  /**
   * The custom endpoint of a line's model, or null (DigitalOcean). A model whose
   * endpoint cannot be resolved also returns null: the call then fails with the
   * resolution error as that request's error.
   */
  private async customTarget(line: LlmLine): Promise<Target | null> {
    if (this.endpoints == null || !isCustom(modelOf(line))) return null;
    try {
      return await this.endpoints.resolve(modelOf(line));
    } catch (e) {
      if (e instanceof LlmApiError) return null;
      throw e;
    }
  }

  /** run(lines, Consumer<LlmResult>): results only, never stops early. */
  async runResults(lines: LineSource, onResult: (r: LlmResult) => unknown): Promise<void> {
    await this.run(lines, (o) => onResult(o.result), () => false);
  }

  /**
   * True when the pool stopped because DO's daily token quota ran out: the
   * requests not started stay unanswered, never failed. stop: checked before each
   * request starts; once true, the remaining requests are abandoned (in-flight
   * ones still report their answers).
   */
  async run(lines: LineSource, onResult: (o: Outcome) => unknown, stop: () => boolean): Promise<boolean> {
    let quotaPaused = false;
    const permits = new Semaphore(this.props.syncConcurrency);
    let stopped = false;
    const tasks: Promise<void>[] = [];
    const it = iterate(lines);
    while (true) {
      // Java checks hasNext() before acquiring; an exhausted source ends the loop the same way.
      const nextLine = await it.peek();
      if (nextLine === undefined) break;
      await permits.acquire();
      if (stopped || stop()) {
        stopped = true;
        permits.release();
        break;
      }
      const line = (await it.next())!;
      // A custom model is bounded by its endpoint's own max_concurrency,
      // not by KB_SYNC_CONCURRENCY (which only paces DigitalOcean).
      const target = await this.customTarget(line);
      let held: Semaphore;
      if (target != null) {
        permits.release();
        await target.semaphore.acquire();
        held = target.semaphore;
        if (stopped || stop()) {
          stopped = true;
          held.release();
          break;
        }
      } else {
        held = permits;
      }
      tasks.push(
        (async () => {
          try {
            if (stopped || stop()) {
              stopped = true;
              return;
            }
            if (target == null && this.quota != null && this.quota.dailyTokensShort(estimateTokens(line))) {
              quotaPaused = true;
              stopped = true;
              return;
            }
            await onResult(await this.runTracked(line));
          } catch (e) {
            if (e instanceof DoQuotaExhaustedError) {
              this.warn('KB pipeline: DO daily token quota exhausted; pausing sync requests');
              quotaPaused = true;
              stopped = true;
            } else {
              this.warn(`KB pipeline: sync request ${line.customId} failed: ${e instanceof Error ? e.message : String(e)}`);
            }
          } finally {
            held.release();
          }
        })(),
      );
    }
    await Promise.all(tasks);
    return quotaPaused;
  }

  async runOne(line: LlmLine): Promise<LlmResult> {
    const target = await this.customTarget(line);
    if (target != null) await target.semaphore.acquire();
    try {
      return (await this.runTracked(line)).result;
    } catch (e) {
      if (e instanceof DoQuotaExhaustedError) {
        return llmResult(line.customId, false, null, null, 0, 0, 0, null, 'HTTP 429: ' + e.message);
      }
      throw e;
    } finally {
      if (target != null) target.semaphore.release();
    }
  }

  /**
   * Empty/unparseable tool arguments or a cut at max_tokens: retried once
   * (never more) with double max_tokens (cap 32k), then failed (path gets "+retry").
   */
  async runTracked(line: LlmLine): Promise<Outcome> {
    const started = performance.now();
    const attempts: Attempt[] = [];
    const first = await this.attempt(line, attempts);
    let result = first;
    if (!first.ok && startsWithRetryable(first.error)) {
      const params = deepCopy(line.params) as JsonObject;
      params.max_tokens = Math.min(MAX_TOKENS_CAP, asInt(path(params, 'max_tokens'), 4096) * 2);
      const second = await this.attempt({ customId: line.customId, params }, attempts);
      result = llmResult(
        line.customId,
        second.ok,
        second.toolInput,
        second.text,
        first.tokensIn + second.tokensIn,
        first.tokensOut + second.tokensOut,
        first.cachedTokens + second.cachedTokens,
        (second.path == null ? 'none' : second.path) + '+retry',
        second.ok ? null : second.error,
      );
    }
    return { result, attempts: [...attempts], latencyMs: elapsedMs(started) };
  }

  private async call(body: JsonObject, attempts: Attempt[]): Promise<JsonValue> {
    const t = performance.now();
    let res: JsonValue;
    const model = asText(path(body, 'model'), '')!;
    if (this.endpoints != null && isCustom(model)) {
      const target = await this.endpoints.resolve(model); // LlmApiError when gone/disabled/unreadable key
      body.model = target.rawModel;
      res = await target.complete(body);
    } else {
      res = await this.client.complete(body);
    }
    const u = path(res, 'usage');
    const reasoning = at(u, 'completion_tokens_details', 'reasoning_tokens');
    attempts.push({
      tokensIn: asInt(path(u, 'prompt_tokens'), asInt(path(u, 'input_tokens'), 0)),
      tokensOut: asInt(path(u, 'completion_tokens'), asInt(path(u, 'output_tokens'), 0)),
      cachedTokens: asInt(path(u, 'cache_read_input_tokens'), asInt(at(u, 'prompt_tokens_details', 'cached_tokens'), 0)),
      reasoningTokens: canConvertToInt(reasoning) ? asInt(reasoning) : null,
      latencyMs: elapsedMs(t),
    });
    return res;
  }

  private async attempt(line: LlmLine, attempts: Attempt[]): Promise<LlmResult> {
    const custom = this.endpoints != null && isCustom(modelOf(line));
    const hasToolDef = size(path(line.params, 'tools')) > 0;
    try {
      if (custom && hasToolDef && (await this.endpoints!.toolsOff(modelOf(line)))) {
        // The probe said no tool calling (llama.cpp without --jinja): go straight to json_object.
        const r = fromChatCompletion(line.customId, await this.call(chatBody(line.params, true), attempts));
        if (r.toolInput != null) {
          return llmResult(line.customId, true, r.toolInput, r.text, r.tokensIn, r.tokensOut, r.cachedTokens, 'json_object', null);
        }
        return r;
      }
      const first = fromChatCompletion(line.customId, await this.call(chatBody(line.params, false), attempts));
      if (startsWithRetryable(first.error)) return first;
      const hasTool = size(path(line.params, 'tools')) > 0;
      if (!hasTool || first.toolInput != null) return first;
      if (first.text != null && jStrip(first.text).startsWith('---')) return first;
      let second: LlmResult;
      try {
        second = fromChatCompletion(line.customId, await this.call(chatBody(line.params, true), attempts));
      } catch (e) {
        if (e instanceof DoQuotaExhaustedError) throw e;
        if (!(e instanceof LlmApiError)) throw e;
        // The fallback failed: keep the first answer, with its (paid) tokens.
        this.warn(`KB pipeline: json_object fallback of ${line.customId} failed: HTTP ${e.status}`);
        return llmResult(line.customId, first.ok, null, first.text, first.tokensIn, first.tokensOut, first.cachedTokens, 'text', first.error);
      }
      const usageIn = first.tokensIn + second.tokensIn;
      const usageOut = first.tokensOut + second.tokensOut;
      const cached = first.cachedTokens + second.cachedTokens;
      if (second.toolInput != null) {
        return llmResult(line.customId, true, second.toolInput, second.text, usageIn, usageOut, cached, 'json_object', null);
      }
      return llmResult(line.customId, first.ok, null, first.text, usageIn, usageOut, cached, 'text', first.error);
    } catch (e) {
      if (e instanceof DoQuotaExhaustedError) throw e; // run() pauses the pool; runOne() reports it
      if (!(e instanceof LlmApiError)) throw e;
      if (custom && hasToolDef && e.status >= 400 && e.status < 600 && attempts.length === 0) {
        // A server without tool support (llama.cpp needs --jinja) refuses the request: json_object instead.
        try {
          const r = fromChatCompletion(line.customId, await this.call(chatBody(line.params, true), attempts));
          if (r.toolInput != null) {
            return llmResult(line.customId, true, r.toolInput, r.text, r.tokensIn, r.tokensOut, r.cachedTokens, 'json_object', null);
          }
          return r;
        } catch (e2) {
          if (!(e2 instanceof LlmApiError)) throw e2;
          return llmResult(line.customId, false, null, null, 0, 0, 0, null, `HTTP ${e2.status}: ${e2.message}`);
        }
      }
      return llmResult(line.customId, false, null, null, 0, 0, 0, null, `HTTP ${e.status}: ${e.message}`);
    }
  }
}

/** A pull iterator over a sync or async source with one-element lookahead (Iterator.hasNext()). */
function iterate(src: LineSource): { peek(): Promise<LlmLine | undefined>; next(): Promise<LlmLine | undefined> } {
  const asyncIt: AsyncIterator<LlmLine> | null = Symbol.asyncIterator in (src as object)
    ? (src as AsyncIterable<LlmLine>)[Symbol.asyncIterator]()
    : null;
  const syncIt: Iterator<LlmLine> | null = asyncIt == null ? (src as Iterable<LlmLine>)[Symbol.iterator]() : null;
  let buffered: { value: LlmLine | undefined } | null = null;
  const pull = async (): Promise<LlmLine | undefined> => {
    const r = asyncIt != null ? await asyncIt.next() : syncIt!.next();
    return r.done ? undefined : r.value;
  };
  return {
    async peek() {
      if (buffered == null) buffered = { value: await pull() };
      return buffered.value;
    },
    async next() {
      if (buffered != null) {
        const v = buffered.value;
        buffered = null;
        return v;
      }
      return pull();
    },
  };
}
