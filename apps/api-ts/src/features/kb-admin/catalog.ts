// Port of apps/api/src/main/java/org/ceitba/api/service/kb/admin/KbModelCatalogService.java:
// list, create, update (with kb_model_price_history rows), sync with DO's public catalog
// (or the inference /v1/models fallback), and the view (KbModelResponse). Probes and the
// pending-probe poller are logic/admin/kbModelCatalogService.ts, wired here with the
// pipeline's executors.

import type { Deps } from '../../deps';
import type { Db } from '../../db/client';
import { ResourceAlreadyExistsError, ResourceNotFoundError, ValidationError } from '../../http/errors';
import { Dec } from '../kb/logic/decimal';
import { KbCatalogItem } from '../kb/logic/admin/kbCatalogItem';
import { KbModelCatalogService as ProbeLogic, provider } from '../kb/logic/admin/kbModelCatalogService';
import type { KbEffectiveSettings } from '../kb/logic/admin/kbSettings';
import { jTrim, lowerRoot } from '../kb/logic/javaString';
import {
  asBoolean, asInt, asText, decimalValue, has, hasNonNull, isNull, isNumber, JDouble, nodeToString, path, type JsonValue, type Node,
} from '../kb/logic/jsonNode';
import { batchByRule, batchProvider, defaultBatchModelId } from '../kb/logic/llm/kbChatPayloads';
import { isCustom, SAFE_ID } from '../kb/logic/llm/kbEndpointRegistry';
import { effective } from '../kb/logic/llm/kbPricing';
import type { Odt } from '../kb/logic/odt';
import type { KbModelStore } from '../kb/logic/ports';
import { KbPipelineError } from '../kb/logic/pipeline/kbPipelineError';
import { KbModel } from '../kb/logic/types';
import * as repo from './repo';
import { kbTx } from './tx';
import { nowOdt } from './values';

const TOOL_CALLING = ['unknown', 'yes', 'no'];

export interface Price { inputPerM: Dec | null; outputPerM: Dec | null; cacheReadPerM: Dec | null }

/** web/kb/admin/KbModelResponse (record component order). */
export interface KbModelResponse {
  id: string;
  displayName: string;
  provider: string;
  batchSupported: boolean;
  batchSource: string;
  batchVerifiedAt: Odt | null;
  batchDiscountVerified: boolean;
  toolCalling: string;
  supportsReasoningEffort: boolean;
  enabled: boolean;
  inputPerM: Dec | null;
  outputPerM: Dec | null;
  cacheReadPerM: Dec | null;
  batchDiscount: Dec;
  effectivePrices: { batch: Price | null; sync: Price };
  contextWindow: number | null;
  maxOutputTokens: number | null;
  notes: string | null;
  pricesUpdatedAt: Odt | null;
  priceSource: string | null;
  lastProbe: JsonValue | null;
  selectable: boolean;
  emptyToolCallRate: JDouble | null;
  batchModelId: string | null;
  effectiveBatchModelId: string | null;
  remoteModelId: string | null;
}

export interface Change { field: string; old: string | null; new: string | null }
export interface Updated { id: string; changes: Change[] }

/** web/kb/admin/KbModelSyncResponse. */
export interface KbModelSyncResponse {
  updated: Updated[];
  added: string[];
  unchanged: number;
  notInCatalog: string[];
  source: string;
  fetchedAt: Odt;
}

/** What the probes need from the pipeline (kbPipeline(deps)); null while it is not wired. */
export type ProbeFactory = () => ProbeLogic;

interface Settings { effective(): Promise<KbEffectiveSettings> }

/** KbModelRepository over the kb transaction (joins the caller's). */
export function modelStore(deps: Deps): KbModelStore {
  return {
    findById: (id) => kbTx(deps.db, (tx) => repo.modelById(tx, id)),
    findAll: () => kbTx(deps.db, (tx) => repo.allModels(tx)),
    save: (m) => kbTx(deps.db, async (tx) => {
      if (await repo.modelExists(tx, m.id)) await repo.updateModel(tx, m);
      else await repo.insertModel(tx, m, nowOdt(deps));
      return m;
    }),
  };
}

/** BigDecimal.stripTrailingZeros().toPlainString(), or toString(). */
function str(v: Dec | number | string | null): string | null {
  if (v == null) return null;
  if (v instanceof Dec) return v.stripTrailingZeros().toPlainString();
  return String(v);
}

function change(out: Change[], field: string, old: Dec | number | string | null, now: Dec | number | string | null): void {
  const o = str(old);
  const n = str(now);
  if (o === n) return;
  out.push({ field, old: o, new: n });
}

function price(b: Node, field: string, current: Dec | null): Dec | null {
  if (!has(b, field)) return current;
  const v0 = path(b, field);
  if (isNull(v0)) return null;
  if (!isNumber(v0)) throw new ValidationError(field, nodeToString(v0), 'must be a number');
  const v = decimalValue(v0);
  if (v.signum() < 0) throw new ValidationError(field, v.toString(), 'must be >= 0');
  return v;
}

export class KbModelCatalogService {
  constructor(
    private readonly deps: Deps,
    private readonly settings: Settings,
    private readonly probes: ProbeFactory,
  ) {}

  list(): Promise<KbModelResponse[]> {
    return kbTx(this.deps.db, async (tx) => {
      const rates = new Map<string, number>();
      for (const r of await repo.emptyToolCallStats(tx)) {
        if (r.total > 0) rates.set(r.model, Math.round((r.empty / r.total) * 10000) / 10000);
      }
      const mode = (await this.settings.effective()).executionMode;
      return (await repo.allModels(tx)).map((m) => view(m, mode, rates.has(m.id) ? rates.get(m.id)! : null));
    });
  }

  update(id: string, body: Node): Promise<KbModelResponse> {
    return kbTx(this.deps.db, async (tx) => {
      const m = await repo.modelById(tx, id);
      if (m == null) throw new ResourceNotFoundError('KbModel', id);
      await this.apply(tx, m, body);
      await repo.updateModel(tx, m);
      return view(m, (await this.settings.effective()).executionMode, null);
    });
  }

  async create(body: Node): Promise<KbModelResponse> {
    const id = jTrim(asText(path(body, 'id'), '')!);
    if (id === '' || id.length > 128) throw new ValidationError('id', id, 'required (max 128 chars)');
    if (!SAFE_ID.test(id)) throw new ValidationError('id', id, 'only letters, digits and . _ : - (it goes in URL paths)');
    if (isCustom(id)) throw new ValidationError('id', id, "custom:* ids are created by discovering an endpoint's models");
    return kbTx(this.deps.db, async (tx) => {
      if (await repo.modelExists(tx, id)) throw new ResourceAlreadyExistsError('KbModel', id);
      const m = new KbModel(id, asText(path(body, 'displayName'), id)!, provider(id), batchByRule(id), true);
      m.supportsReasoningEffort = id.startsWith('glm');
      // Java persists the price-history rows of apply() before the model (flush order): a
      // create with prices violates kb_model_price_history_model_fkey (409), here too.
      await this.apply(tx, m, body);
      await repo.insertModel(tx, m, nowOdt(this.deps));
      return view(m, (await this.settings.effective()).executionMode, null);
    });
  }

  /**
   * POST /models/sync (ADMIN doc §2): prices, context and names from DO's public catalog
   * onto matching models (history per change), missing serverless chat models added
   * disabled. Capabilities are hints only: probes win. Never touches batchDiscount,
   * batchSupported, enabled or past costs. Without the catalog: ids from /v1/models only.
   */
  async sync(historySource = 'do-catalog'): Promise<KbModelSyncResponse> {
    let items: Record<string, unknown>[];
    try {
      items = await this.deps.llm.catalog.fetch();
    } catch (e) {
      if (!isLlmApiError(e)) throw e;
      this.deps.log.warn(`KB catalog: DO model catalog unavailable (${(e as Error).message}); falling back to /v1/models`);
      return this.syncIds();
    }
    const now = nowOdt(this.deps);
    const parsed = items.map((i) => KbCatalogItem.of(i as JsonValue)).filter((c) => c.id != null && c.id.length <= 128);
    return kbTx(this.deps.db, async (tx) => {
      const existing = new Map<string, KbModel>();
      for (const m of await repo.allModels(tx)) existing.set(m.id, m);
      const updated: Updated[] = [];
      const added: string[] = [];
      let unchanged = 0;
      const seen = new Set<string>();
      const perToken: string[] = [];
      const perMillion: string[] = [];
      for (const c of parsed) {
        const id = c.id!;
        if (seen.has(id)) continue;
        seen.add(id);
        if (c.perTokenFields.length > 0) perToken.push(id);
        else if (c.inputPerM != null) perMillion.push(id);
        let m = existing.get(id);
        if (m == null) {
          if (!c.serverlessChat() || c.inputPerM == null) continue;
          if (!SAFE_ID.test(id)) {
            this.deps.log.warn(`KB catalog: skipping DO model id with characters that break the /models/{id} routes: ${id}`);
            continue;
          }
          m = new KbModel(id, c.name ?? id, c.creator ?? provider(id), batchByRule(id), false);
          m.setPrices(c.inputPerM, c.outputPerM, c.cacheReadPerM, null, now);
          m.contextWindow = c.contextWindow;
          m.maxOutputTokens = c.maxOutputTokens;
          m.priceSource = 'do-catalog';
          if (c.has('reasoning')) m.supportsReasoningEffort = true;
          if (c.has('tool_calling')) m.toolCalling = 'yes';
          await repo.insertModel(tx, m, now);
          added.push(id);
          continue;
        }
        const changes = await this.applyCatalog(tx, m, c, now, historySource);
        await repo.updateModel(tx, m);
        if (changes.length === 0) unchanged++;
        else updated.push({ id: m.id, changes });
      }
      const notInCatalog = [...existing.keys()].filter((id) => !seen.has(id));
      this.deps.log.info(`KB catalog: synced from DO catalog: ${updated.length} updated, ${added.length} added, ${unchanged} unchanged, `
        + `${notInCatalog.length} not in catalog; prices given per token (converted x1e6) for ${perToken.length} models, already per million for `
        + `${perMillion.length}${perMillion.length ? ' [' + perMillion.join(', ') + ']' : ''}`);
      return { updated, added, unchanged, notInCatalog, source: 'do-catalog', fetchedAt: now };
    });
  }

  /** Applies one catalog item to an existing model; returns the changes (each also written to kb_model_price_history). */
  private async applyCatalog(tx: Db, m: KbModel, c: KbCatalogItem, now: Odt, source: string): Promise<Change[]> {
    const changes: Change[] = [];
    const input = c.inputPerM ?? m.inputPerM;
    const output = c.outputPerM ?? m.outputPerM;
    const cache = c.cacheReadPerM ?? m.cacheReadPerM;
    change(changes, 'inputPerM', m.inputPerM, input);
    change(changes, 'outputPerM', m.outputPerM, output);
    change(changes, 'cacheReadPerM', m.cacheReadPerM, cache);
    const pricesChanged = changes.length > 0;
    if (c.contextWindow != null) change(changes, 'contextWindow', m.contextWindow, c.contextWindow);
    if (c.maxOutputTokens != null) change(changes, 'maxOutputTokens', m.maxOutputTokens, c.maxOutputTokens);
    if (c.name != null && !m.displayNameManual) change(changes, 'displayName', m.displayName, c.name);
    if (c.creator != null) change(changes, 'provider', m.provider, c.creator);
    if (pricesChanged || m.priceSource == null) m.setPrices(input, output, cache, m.batchDiscount, now);
    if (c.contextWindow != null) m.contextWindow = c.contextWindow;
    if (c.maxOutputTokens != null) m.maxOutputTokens = c.maxOutputTokens;
    if (c.name != null && !m.displayNameManual) m.displayName = c.name;
    if (c.creator != null) m.provider = c.creator;
    m.priceSource = 'do-catalog';
    // Hints, never over a probe's verdict.
    if (c.has('reasoning') && !m.supportsReasoningEffort && m.lastProbe == null) {
      m.supportsReasoningEffort = true;
      changes.push({ field: 'supportsReasoningEffort', old: 'false', new: 'true' });
    }
    if (c.has('tool_calling') && m.toolCalling === 'unknown') {
      m.toolCalling = 'yes';
      changes.push({ field: 'toolCalling', old: 'unknown', new: 'yes' });
    }
    for (const ch of changes) await repo.insertPriceHistory(tx, m.id, ch.field, ch.old, ch.new, now, source);
    return changes;
  }

  /** Fallback: ids from the inference /v1/models (no prices), added disabled. */
  private async syncIds(): Promise<KbModelSyncResponse> {
    const chat = this.deps.llm.chat;
    if (!chat.available()) {
      throw new KbPipelineError('LLM_UNCONFIGURED', "Neither DO's model catalog nor inference (KB_LLM_API_KEY) is available");
    }
    const ids = await chat.listModels();
    const now = nowOdt(this.deps);
    return kbTx(this.deps.db, async (tx) => {
      const known = new Set((await repo.allModels(tx)).map((m) => m.id));
      const added: string[] = [];
      for (const id of ids) {
        if (known.has(id) || id.length > 128) continue;
        if (!SAFE_ID.test(id)) {
          this.deps.log.warn(`KB catalog: skipping DO model id with characters that break the /models/{id} routes: ${id}`);
          continue;
        }
        const m = new KbModel(id, id, provider(id), batchByRule(id), false);
        m.supportsReasoningEffort = id.startsWith('glm');
        await repo.insertModel(tx, m, now);
        added.push(id);
      }
      const listed = new Set(ids);
      const notListed = [...known].filter((id) => !listed.has(id)).sort();
      return { updated: [], added, unchanged: known.size - notListed.length, notInCatalog: notListed, source: 'inference-models', fetchedAt: now };
    });
  }

  /** One tiny structured-output request through the model's mode (or the given one: batch | sync). */
  async probe(id: string, mode: string | null): Promise<KbModelResponse> {
    const m = await this.probes().probe(id, mode);
    return view(m, (await this.settings.effective()).executionMode, null);
  }

  /** Finishes BATCH probes whose batch is done, and resubmits refused creations once due (KbPipelineJob). */
  refreshPendingProbes(): Promise<void> {
    return this.probes().refreshPendingProbes();
  }

  private async apply(tx: Db, m: KbModel, b: Node): Promise<void> {
    if (hasNonNull(b, 'displayName')) {
      m.displayName = asText(path(b, 'displayName'));
      m.displayNameManual = true; // a catalog sync keeps it
    }
    if (hasNonNull(b, 'provider')) m.provider = asText(path(b, 'provider'));
    if (hasNonNull(b, 'batchSupported')) m.setBatchSupported(asBoolean(path(b, 'batchSupported')));
    if (has(b, 'batchModelId')) {
      const v = isNull(path(b, 'batchModelId')) ? null : jTrim(asText(path(b, 'batchModelId')));
      if (v != null && v.length > 128) throw new ValidationError('batchModelId', v, 'max 128 chars');
      m.setBatchModelId(v); // null/blank = the default (catalog id without its provider prefix)
    }
    if (hasNonNull(b, 'batchDiscountVerified')) m.batchDiscountVerified = asBoolean(path(b, 'batchDiscountVerified'));
    if (hasNonNull(b, 'enabled')) m.enabled = asBoolean(path(b, 'enabled'));
    if (hasNonNull(b, 'supportsReasoningEffort')) m.supportsReasoningEffort = asBoolean(path(b, 'supportsReasoningEffort'));
    if (hasNonNull(b, 'toolCalling')) {
      const t = lowerRoot(asText(path(b, 'toolCalling')));
      if (!TOOL_CALLING.includes(t)) throw new ValidationError('toolCalling', t, 'must be unknown, yes or no');
      m.toolCalling = t;
    }
    if (has(b, 'contextWindow')) m.contextWindow = isNull(path(b, 'contextWindow')) ? null : asInt(path(b, 'contextWindow'));
    if (has(b, 'notes')) m.notes = isNull(path(b, 'notes')) ? null : asText(path(b, 'notes'));
    const prices = has(b, 'inputPerM') || has(b, 'outputPerM') || has(b, 'cacheReadPerM') || has(b, 'batchDiscount');
    if (prices) {
      const input = price(b, 'inputPerM', m.inputPerM);
      const output = price(b, 'outputPerM', m.outputPerM);
      const cache = price(b, 'cacheReadPerM', m.cacheReadPerM);
      const discount = price(b, 'batchDiscount', m.batchDiscount);
      if (discount != null && (discount.signum() < 0 || discount.compareTo(Dec.ONE) > 0)) {
        throw new ValidationError('batchDiscount', discount.toString(), 'must be between 0 and 1');
      }
      const now = nowOdt(this.deps);
      const changes: Change[] = [];
      change(changes, 'inputPerM', m.inputPerM, input);
      change(changes, 'outputPerM', m.outputPerM, output);
      change(changes, 'cacheReadPerM', m.cacheReadPerM, cache);
      change(changes, 'batchDiscount', m.batchDiscount, discount);
      for (const ch of changes) await repo.insertPriceHistory(tx, m.id, ch.field, ch.old, ch.new, now, 'manual');
      m.setPrices(input, output, cache, discount, now);
      if (has(b, 'inputPerM') || has(b, 'outputPerM') || has(b, 'cacheReadPerM')) m.priceSource = 'manual';
    }
  }
}

/** KbModelCatalogService.view: the catalog item with effective prices for an execution mode. */
export function view(m: KbModel, executionMode: string, emptyToolCallRate: number | null): KbModelResponse {
  const sync = effective(m, 'SYNC')!;
  const batch = m.isBatchSupported() ? effective(m, 'BATCH') : null;
  return {
    id: m.id,
    displayName: m.displayName,
    provider: m.provider,
    batchSupported: m.isBatchSupported(),
    batchSource: m.batchSource,
    batchVerifiedAt: m.batchVerifiedAt,
    batchDiscountVerified: m.batchDiscountVerified,
    toolCalling: m.toolCalling,
    supportsReasoningEffort: m.supportsReasoningEffort,
    enabled: m.enabled,
    inputPerM: m.inputPerM,
    outputPerM: m.outputPerM,
    cacheReadPerM: m.cacheReadPerM,
    batchDiscount: m.batchDiscount,
    effectivePrices: {
      batch: batch == null ? null : { inputPerM: batch.inputPerM, outputPerM: batch.outputPerM, cacheReadPerM: batch.cacheReadPerM },
      sync: { inputPerM: sync.inputPerM, outputPerM: sync.outputPerM, cacheReadPerM: sync.cacheReadPerM },
    },
    contextWindow: m.contextWindow,
    maxOutputTokens: m.maxOutputTokens,
    notes: m.notes,
    pricesUpdatedAt: m.pricesUpdatedAt,
    priceSource: m.priceSource,
    lastProbe: m.lastProbe,
    selectable: m.selectableIn(m.modeFor(executionMode)),
    emptyToolCallRate: emptyToolCallRate == null ? null : new JDouble(emptyToolCallRate),
    batchModelId: m.getBatchModelId(),
    effectiveBatchModelId: batchProvider(m.id) == null ? null : (m.getBatchModelId() ?? defaultBatchModelId(m.id)),
    remoteModelId: m.remoteModelId,
  };
}

/** LlmApiException from either client module (src/external/llm.ts or the kb logic's llmApi.ts). */
export function isLlmApiError(e: unknown): boolean {
  return e instanceof Error && typeof (e as { status?: unknown }).status === 'number'
    && (e.name === 'LlmApiException' || e.constructor.name === 'LlmApiError' || e.constructor.name.endsWith('LlmApiError'));
}
