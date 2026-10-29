// Port of apps/api/src/main/java/org/ceitba/api/service/kb/admin/KbEndpointService.java.
//
// Staff-managed custom OpenAI-compatible endpoints (own GPU server). The API
// key is encrypted at rest (KbSecretCipher) and never returned or logged.
// Discovery and the URL/name validators are logic/admin/kbEndpointService.ts.

import type { Deps } from '../../deps';
import type { Db } from '../../db/client';
import { ExternalApiError, KbEndpointInUseError, ResourceAlreadyExistsError, ResourceNotFoundError, ValidationError } from '../../http/errors';
import { baseUrl, KbEndpointService as DiscoverLogic, NAME } from '../kb/logic/admin/kbEndpointService';
import type { KbEffectiveSettings } from '../kb/logic/admin/kbSettings';
import { lowerRoot, equalsIgnoreCase } from '../kb/logic/javaString';
import { asBoolean, asInt, asText, canConvertToInt, elements, hasNonNull, isBoolean, isTextual, nodeToString, path, type Node } from '../kb/logic/jsonNode';
import type { KbEndpointRegistry } from '../kb/logic/llm/kbEndpointRegistry';
import { prefixOf } from '../kb/logic/llm/kbEndpointRegistry';
import type { KbSecretCipher } from '../kb/logic/llm/kbSecretCipher';
import { KbLlmEndpoint } from '../kb/logic/types';
import { item, type DiscoverResult, type Item, type Stats, type TestResult } from '../kb/logic/web/kbEndpointDtos';
import { ACTIVE } from '../kb-pipeline/engine';
import { isLlmApiError, modelStore } from './catalog';
import * as repo from './repo';
import { kbTx } from './tx';
import { nowOdt } from './values';
import { javaTrim } from '../../lib/javaCompat';

interface Settings { effective(): Promise<KbEffectiveSettings> }

export class KbEndpointService {
  constructor(
    private readonly deps: Deps,
    private readonly settings: Settings,
    private readonly cipher: KbSecretCipher,
    private readonly registry: () => KbEndpointRegistry,
  ) {}

  list(): Promise<Item[]> {
    return kbTx(this.deps.db, async (tx) => {
      const out: Item[] = [];
      for (const e of await repo.allEndpoints(tx)) out.push(await this.view(tx, e));
      return out;
    });
  }

  create(userId: string, body: Node): Promise<Item> {
    return kbTx(this.deps.db, async (tx) => {
      const name = lowerRoot(javaTrim(asText(path(body, 'name'), '')!));
      if (!NAME.test(name)) throw new ValidationError('name', name, "required: lowercase letters, digits and '-' (max 47 chars)");
      if ((await repo.endpointByName(tx, name)) != null) throw new ResourceAlreadyExistsError('KbLlmEndpoint', name);
      const e = new KbLlmEndpoint(name, baseUrl(asText(path(body, 'baseUrl'), '')), userId, nowOdt(this.deps));
      this.apply(e, body);
      await repo.insertEndpoint(tx, e);
      return this.view(tx, e);
    });
  }

  update(userId: string, id: string, body: Node): Promise<Item> {
    return kbTx(this.deps.db, async (tx) => {
      const e = await this.get(tx, id);
      if (hasNonNull(body, 'name') && !equalsIgnoreCase(javaTrim(asText(path(body, 'name'))), e.name)) {
        throw new ValidationError('name', asText(path(body, 'name')),
          'cannot be renamed (model ids custom:<name>:<slug> depend on it); create a new endpoint');
      }
      if (hasNonNull(body, 'baseUrl')) e.baseUrl = baseUrl(asText(path(body, 'baseUrl')));
      this.apply(e, body);
      e.touch(userId, nowOdt(this.deps));
      await repo.updateEndpoint(tx, e);
      return this.view(tx, e);
    });
  }

  private apply(e: KbLlmEndpoint, body: Node): void {
    if (hasNonNull(body, 'maxConcurrency')) {
      const v = path(body, 'maxConcurrency');
      if (!canConvertToInt(v) || asInt(v) < 1 || asInt(v) > 64) throw new ValidationError('maxConcurrency', nodeToString(v), 'must be between 1 and 64');
      e.maxConcurrency = asInt(v);
    }
    if (hasNonNull(body, 'timeoutSec')) {
      const v = path(body, 'timeoutSec');
      if (!canConvertToInt(v) || asInt(v) < 5 || asInt(v) > 3600) throw new ValidationError('timeoutSec', nodeToString(v), 'must be between 5 and 3600');
      e.timeoutSec = asInt(v);
    }
    if (hasNonNull(body, 'enabled')) {
      if (!isBoolean(path(body, 'enabled'))) throw new ValidationError('enabled', nodeToString(path(body, 'enabled')), 'must be a boolean');
      e.enabled = asBoolean(path(body, 'enabled'));
    }
    // apiKey: absent/null = keep, "" = remove, else replace (encrypted).
    if (hasNonNull(body, 'apiKey')) {
      if (!isTextual(path(body, 'apiKey'))) throw new ValidationError('apiKey', '(hidden)', 'must be a string');
      const key = javaTrim(asText(path(body, 'apiKey')));
      e.apiKeyEncrypted = key === '' ? null : this.cipher.encrypt(key);
    }
  }

  delete(id: string): Promise<void> {
    return kbTx(this.deps.db, async (tx) => {
      const e = await this.get(tx, id);
      const prefix = prefixOf(e.name);
      const s = await this.settings.effective();
      const used: string[] = [];
      for (const m of [s.modelDigest, s.modelPlan, s.modelWrite, s.modelRetry]) if (m != null && m.startsWith(prefix)) used.push(m);
      if (s.subjectOverrides != null) {
        for (const o of elements(s.subjectOverrides)) {
          for (const f of ['modelWrite', 'modelPlan']) {
            if (asText(path(o, f), '')!.startsWith(prefix)) used.push(asText(path(o, f)));
          }
        }
      }
      if (used.length) throw new KbEndpointInUseError(`A model of this endpoint is used by the pipeline settings (${used[0]})`);
      if ((await repo.countActiveRunRequestsWithModelPrefix(tx, prefix, ACTIVE)) > 0) {
        throw new KbEndpointInUseError('A model of this endpoint is used by an active run or eval');
      }
      await repo.deleteModelsWithPrefix(tx, prefix);
      await repo.deleteEndpoint(tx, e.id);
    });
  }

  /** GET {baseUrl}/models with latency. Never throws for an unreachable server. */
  async test(id: string): Promise<TestResult> {
    const e = await kbTx(this.deps.db, (tx) => this.get(tx, id));
    if (e.hasKey() && !this.cipher.readable(e.apiKeyEncrypted)) {
      return { ok: false, latencyMs: 0, models: [], error: 'The stored token cannot be decrypted (AUTH_JWT_SECRET or KB_SECRETS_KEY changed): re-enter the token' };
    }
    const t = performance.now();
    try {
      const ids = await this.registry().client(e).listModels();
      return { ok: true, latencyMs: Math.trunc(performance.now() - t), models: ids, error: null };
    } catch (ex) {
      if (isLlmApiError(ex)) return { ok: false, latencyMs: Math.trunc(performance.now() - t), models: [], error: (ex as Error).message };
      return { ok: false, latencyMs: Math.trunc(performance.now() - t), models: [], error: ex instanceof Error ? ex.constructor.name : 'Error' };
    }
  }

  /** Adds the endpoint's models to the catalog as custom:<name>:<slug> (disabled, price 0); existing ones are untouched. */
  discover(id: string): Promise<DiscoverResult> {
    const logic = new DiscoverLogic(
      { findById: (x) => kbTx(this.deps.db, (tx) => repo.endpointById(tx, x)), findByName: (n) => kbTx(this.deps.db, (tx) => repo.endpointByName(tx, n)) },
      modelStore(this.deps),
      this.cipher,
      this.registry(),
      () => nowOdt(this.deps),
      (fn) => kbTx(this.deps.db, () => Promise.resolve(fn())),
      (msg) => this.deps.log.info(msg),
    );
    return logic.discover(id);
  }

  stats(id: string, minutes: number): Promise<Stats> {
    if (minutes < 1 || minutes > 10080) throw new ValidationError('minutes', String(minutes), 'must be between 1 and 10080');
    return kbTx(this.deps.db, async (tx) => {
      const e = await this.get(tx, id);
      const now = nowOdt(this.deps);
      const since = now.plusMinutes(-minutes);
      const row = await repo.endpointStats(tx, prefixOf(e.name), since);
      const p50 = row.p50 == null ? null : Math.round(row.p50);
      const p95 = row.p95 == null ? null : Math.round(row.p95);
      const latencySec = row.latencyMs / 1000.0;
      // Failed calls leave no usage row: they come from the in-memory log (since the last restart).
      const failed = this.registry().errorsSince(id, since.toEpochMilli());
      const tps = latencySec > 0 ? Math.round((row.outTokens / latencySec) * 10) / 10.0 : 0;
      return { windowMinutes: minutes, requests: row.calls + failed, errors: row.empty + failed, p50Ms: p50, p95Ms: p95, outputTokensPerSec: tps, inFlight: this.registry().inFlight(id) };
    });
  }

  private async get(tx: Db, id: string): Promise<KbLlmEndpoint> {
    const e = await repo.endpointById(tx, id);
    if (e == null) throw new ResourceNotFoundError('KbLlmEndpoint', id);
    return e;
  }

  private async view(tx: Db, e: KbLlmEndpoint): Promise<Item> {
    const count = await repo.countModelsWithPrefix(tx, prefixOf(e.name));
    return item(e.id, e.name, e.baseUrl, e.hasKey(), this.cipher.readable(e.apiKeyEncrypted), e.maxConcurrency, e.timeoutSec, e.enabled, count, e.createdAt, e.updatedAt);
  }
}

export { ExternalApiError };
