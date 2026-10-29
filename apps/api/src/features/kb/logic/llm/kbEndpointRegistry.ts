// Port of apps/api/src/main/java/org/ceitba/api/service/kb/llm/KbEndpointRegistry.java.
//
// Resolves custom catalog ids (custom:<endpointName>:<slug>, slash-free so the
// /models/{id} routes work) to their endpoint's client. The id the endpoint
// itself knows (kb_model.remote_model_id) goes in the request body. Each
// endpoint has its own semaphore of max_concurrency (independent of
// KB_SYNC_CONCURRENCY, which only bounds DigitalOcean), an in-memory in-flight
// counter and a short log of failed calls (for /stats).
// The API key is decrypted only here, to build the client; it is never logged.
// One instance per process: kbPipeline(deps).endpoints (src/features/kb-pipeline/service.ts).

import { createHash } from 'node:crypto';
import { DoChatClient } from '../external/doChatClient';
import { LlmApiError, type SyncChatClient } from '../external/llmApi';
import { jIsBlank } from '../javaString';
import type { JsonValue } from '../jsonNode';
import type { Odt } from '../odt';
import type { KbLlmEndpointStore, KbModelReader } from '../ports';
import { Semaphore } from '../semaphore';
import type { KbLlmEndpoint } from '../types';
import type { KbSecretCipher } from './kbSecretCipher';

export const PREFIX = 'custom:';
export const ID_MAX = 128;

/** Characters a catalog id may have (it travels in URL paths). Use with a whole-string test. */
export const SAFE_ID = /^[A-Za-z0-9._:-]+$/;

export function isCustom(model: string | null | undefined): boolean {
  return model != null && model.startsWith(PREFIX) && model.indexOf(':', PREFIX.length) > PREFIX.length;
}

export function endpointName(model: string): string {
  return model.substring(PREFIX.length, model.indexOf(':', PREFIX.length));
}

/** "custom:<endpoint>:" (endpoint names never contain ':'). */
export function prefixOf(name: string): string {
  return PREFIX + name + ':';
}

/**
 * custom:<endpoint>:<slug>: every char outside [A-Za-z0-9._-] becomes '-',
 * truncated to the id column. withHash appends a short hash of the raw id.
 */
export function catalogId(name: string, rawModel: string, withHash: boolean): string {
  const prefix = prefixOf(name);
  // Java's regex replaces per code point (a surrogate pair is one '-').
  let slug = rawModel.replace(/[^A-Za-z0-9._-]/gu, '-');
  const room = ID_MAX - prefix.length - (withHash ? 7 : 0);
  if (slug.length > room) slug = slug.substring(0, room);
  return prefix + slug + (withHash ? '-' + shortHash(rawModel) : '');
}

export function shortHash(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest().subarray(0, 3).toString('hex');
}

class Counters {
  inFlight = 0;
  readonly errors: number[] = []; // epoch ms
}

interface Built {
  version: Odt;
  client: SyncChatClient;
  sem: Semaphore;
}

/** One resolved call target. */
export class Target {
  constructor(
    readonly endpointId: string,
    readonly rawModel: string,
    readonly client: SyncChatClient,
    readonly semaphore: Semaphore,
    private readonly counters: Counters,
  ) {}

  /** Wraps one HTTP call: in-flight count, failed calls remembered. */
  async complete(body: JsonValue): Promise<JsonValue> {
    this.counters.inFlight++;
    try {
      return await this.client.complete(body);
    } catch (e) {
      this.counters.errors.push(Date.now());
      while (this.counters.errors.length > 5000) this.counters.errors.shift();
      throw e;
    } finally {
      this.counters.inFlight--;
    }
  }
}

/** Builds the HTTP client of an endpoint (injectable for tests). */
export type ClientFactory = (e: KbLlmEndpoint, key: string | null) => SyncChatClient;

const defaultFactory: ClientFactory = (e, key) => DoChatClient.openAiCompatible(e.baseUrl, key, e.timeoutSec * 1000);

export class KbEndpointRegistry {
  private readonly built = new Map<string, Built>();
  private readonly counterMap = new Map<string, Counters>();

  constructor(
    private readonly endpoints: KbLlmEndpointStore,
    private readonly models: KbModelReader,
    private readonly cipher: KbSecretCipher,
    private readonly factory: ClientFactory = defaultFactory,
  ) {}

  /** Rejects with LlmApiError(0) when the endpoint is gone, disabled or its key unreadable. */
  async resolve(model: string): Promise<Target> {
    const name = endpointName(model);
    const e = await this.endpoints.findByName(name);
    if (e == null) throw new LlmApiError(0, `custom endpoint '${name}' does not exist`);
    if (!e.enabled) throw new LlmApiError(0, `custom endpoint '${name}' is disabled`);
    let b = this.built.get(e.id);
    if (b == null || !b.version.equals(e.updatedAt)) {
      b = this.build(e);
      this.built.set(e.id, b);
    }
    const m = await this.models.findById(model);
    const raw = m?.remoteModelId;
    if (raw == null || jIsBlank(raw)) {
      throw new LlmApiError(0, `custom model '${model}' is not in the catalog (discover the endpoint again)`);
    }
    return new Target(e.id, raw, b.client, b.sem, this.counters(e.id));
  }

  private build(e: KbLlmEndpoint): Built {
    let key: string | null;
    try {
      key = this.cipher.decrypt(e.apiKeyEncrypted);
    } catch (ex) {
      throw new LlmApiError(0, `custom endpoint '${e.name}': ${ex instanceof Error ? ex.message : String(ex)}`);
    }
    return { version: e.updatedAt, client: this.factory(e, key), sem: new Semaphore(Math.max(1, e.maxConcurrency)) };
  }

  /** A fresh client (test button, discovery). */
  client(e: KbLlmEndpoint): SyncChatClient {
    let key: string | null;
    try {
      key = this.cipher.decrypt(e.apiKeyEncrypted);
    } catch (ex) {
      throw new LlmApiError(0, ex instanceof Error ? ex.message : String(ex));
    }
    return this.factory(e, key);
  }

  private counters(id: string): Counters {
    let c = this.counterMap.get(id);
    if (c == null) {
      c = new Counters();
      this.counterMap.set(id, c);
    }
    return c;
  }

  inFlight(endpointId: string): number {
    return this.counters(endpointId).inFlight;
  }

  errorsSince(endpointId: string, sinceEpochMs: number): number {
    return this.counters(endpointId).errors.filter((t) => t >= sinceEpochMs).length;
  }

  /** The catalog says this model has no tool calling: use json_object directly. */
  async toolsOff(model: string): Promise<boolean> {
    const m = await this.models.findById(model);
    return m != null && m.toolCalling === 'no';
  }
}
