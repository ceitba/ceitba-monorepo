// Port of apps/api/src/main/java/org/ceitba/api/service/kb/admin/KbSettingsService.java.
//
// Runtime pipeline settings (docs/SUBJECT-WIKI-ADMIN.md §1): env defaults
// overridden by the single kb_pipeline_settings row, every change kept in
// kb_pipeline_settings_history. Read at each stage submission. The pure parts
// (FIELDS, cron6, checkTypes, applied, merge, values) are logic/admin/kbSettings.ts.

import type { Deps } from '../../deps';
import type { Db } from '../../db/client';
import { ResourceNotFoundError, ValidationError } from '../../http/errors';
import { Dec } from '../kb/logic/decimal';
import {
  checkTypes, KbSettingsLogic, MAX_COST_BUDGET_USD, MIN_COST_BUDGET_USD, FIELDS, STAGES, values,
  type KbEffectiveSettings, type KbPipelineProperties,
} from '../kb/logic/admin/kbSettings';
import { batchProvider } from '../kb/logic/llm/kbChatPayloads';
import {
  asInt, asLong, asText, canConvertToInt, deepCopy, fields, has, hasNonNull, isNull, isObject, isTextual, nodeEquals, nodeToString,
  path, type JsonObject, type JsonValue, type Node,
} from '../kb/logic/jsonNode';
import { lowerRoot } from '../kb/logic/javaString';
import type { Odt } from '../kb/logic/odt';
import { llmProperties, pipelineProperties } from '../kb-pipeline/settings';
import { SpringCron } from './cron';
import type { KbForecastService, Weekly } from './forecast';
import * as repo from './repo';
import { kbTx } from './tx';
import { nowOdt } from './values';

/** web/kb/admin/KbSettingsResponse.CostImpact. */
export interface CostImpact { previous: Weekly; projected: Weekly }

/** web/kb/admin/KbSettingsResponse. */
export interface KbSettingsResponse {
  settings: JsonValue;
  source: JsonObject;
  updatedAt: Odt | null;
  updatedBy: string | null;
  updatedByName: string | null;
  costImpact: CostImpact | null;
}

/** KbSettingsService.KbSettingsPreview. */
export interface KbSettingsPreview { costImpact: CostImpact; errors: string[] }

/** web/kb/admin/KbSettingsHistoryResponse. */
export interface KbSettingsHistoryResponse {
  id: string;
  settings: JsonValue;
  changedBy: string | null;
  changedByName: string | null;
  changedAt: Odt;
  note: string | null;
}

interface SavedRow { updatedAt: Odt; updatedBy: string | null }

const MODEL_FIELDS = ['modelDigest', 'modelPlan', 'modelWrite', 'modelRetry'];

/** String.valueOf(value) of a ValidationException argument: a JsonNode prints as JSON. */
const nodeText = (v: Node): string => (v === undefined ? '' : nodeToString(v));

export class KbSettingsService {
  readonly env: KbPipelineProperties;
  private readonly logic: KbSettingsLogic;

  constructor(private readonly deps: Deps, private readonly forecast: () => KbForecastService) {
    this.env = pipelineProperties(deps.config);
    this.logic = new KbSettingsLogic(this.env, llmProperties(deps.config));
  }

  // Hard caps from the environment (never STAFF-settable).
  maxRequestsPerStage(): number {
    return this.env.maxRequestsPerStage;
  }

  digestMaxMissingRatio(): number {
    return this.env.digestMaxMissingRatio;
  }

  batchMaxRequests(): number {
    return this.env.batchMaxRequests;
  }

  /** @Transactional(readOnly = true) */
  effective(): Promise<KbEffectiveSettings> {
    return kbTx(this.deps.db, async (tx) => this.merge(await this.stored(tx)));
  }

  merge(s: Node): KbEffectiveSettings {
    return this.logic.merge(s);
  }

  async get(): Promise<KbSettingsResponse> {
    return kbTx(this.deps.db, async (tx) => {
      const row = await repo.settingsRow(tx);
      return this.response(tx, row == null ? {} : (row.settings as JsonObject), row, null);
    });
  }

  /**
   * Applies the given fields (null = back to the env default; absent = unchanged),
   * validates them and records a history entry. Anything that is not a settings
   * field is ignored, and a value that changes nothing effective is stored as "use env".
   */
  update(userId: string, body: Node): Promise<KbSettingsResponse> {
    return kbTx(this.deps.db, async (tx) => {
      const before = this.merge(await this.stored(tx));
      checkTypes(body);
      const next = this.logic.applied(await this.stored(tx), body);
      await this.validate(tx, next, body, before);
      const note = isTextual(path(body, 'note')) ? (path(body, 'note') as string) : null;
      const row = await this.save(tx, next, userId, note);
      const after = this.merge(next);
      return this.response(tx, next, row, await this.impact(before, after));
    });
  }

  /** Same body as update(): the cost impact and validation errors, nothing saved. */
  preview(body: Node): Promise<KbSettingsPreview> {
    return kbTx(this.deps.db, async (tx) => {
      const before = this.merge(await this.stored(tx));
      const errors: string[] = [];
      let next = await this.stored(tx);
      try {
        checkTypes(body);
        next = this.logic.applied(next, body);
        await this.validate(tx, next, body, before);
      } catch (e) {
        if (!(e instanceof ValidationError)) throw e;
        errors.push(e.message);
      }
      return { costImpact: await this.impact(before, this.merge(next)), errors };
    });
  }

  /** The settings `body` would produce (no validation, nothing saved). */
  proposed(body: Node | null): Promise<KbEffectiveSettings> {
    return kbTx(this.deps.db, async (tx) => {
      const stored = await this.stored(tx);
      return this.merge(body == null ? stored : this.logic.applied(stored, body));
    });
  }

  history(limit: number): Promise<KbSettingsHistoryResponse[]> {
    return kbTx(this.deps.db, async (tx) => {
      const list = await repo.historyPage(tx, Math.max(1, Math.min(limit, 200)));
      const names = await repo.userNames(tx, list.map((h) => h.changedBy));
      return list.map((h) => ({
        id: h.id, settings: h.settings, changedBy: h.changedBy,
        changedByName: h.changedBy == null ? null : (names.get(h.changedBy) ?? null), changedAt: h.changedAt, note: h.note,
      }));
    });
  }

  restore(userId: string, historyId: string): Promise<KbSettingsResponse> {
    return kbTx(this.deps.db, async (tx) => {
      const h = await repo.historyById(tx, historyId);
      if (h == null) throw new ResourceNotFoundError('KbSettingsHistory', historyId);
      const before = this.merge(await this.stored(tx));
      const next = deepCopy(h.settings) as JsonObject;
      await this.validate(tx, next, {}, before);
      const row = await this.save(tx, next, userId, 'restored from ' + historyId);
      return this.response(tx, next, row, await this.impact(before, this.merge(next)));
    });
  }

  // ---- internals ---------------------------------------------------------------

  private async impact(before: KbEffectiveSettings, after: KbEffectiveSettings): Promise<CostImpact> {
    const previous = (await this.forecast().forecast(before)).weekly;
    const projected = (await this.forecast().forecast(after)).weekly;
    return { previous, projected };
  }

  private async stored(tx: Db): Promise<JsonObject> {
    const row = await repo.settingsRow(tx);
    return row == null ? {} : (deepCopy(row.settings) as JsonObject);
  }

  private async save(tx: Db, settings: JsonObject, userId: string | null, note: string | null): Promise<SavedRow> {
    const now = nowOdt(this.deps);
    if ((await repo.settingsRow(tx)) == null) await repo.insertSettingsRow(tx, settings, userId, now);
    else await repo.updateSettingsRow(tx, settings, userId, now);
    await repo.insertHistory(tx, deepCopy(settings), userId, now, note);
    return { updatedAt: now, updatedBy: userId };
  }

  /** Every model field that changes must name an enabled catalog model with a successful probe; batch mode needs batch support everywhere. */
  private async validate(tx: Db, next: JsonObject, body: Node, before: KbEffectiveSettings): Promise<void> {
    checkTypes(next);
    const merged = this.merge(next);
    const chosen = new Map<string, string>([
      ['modelDigest', merged.modelDigest], ['modelPlan', merged.modelPlan], ['modelWrite', merged.modelWrite], ['modelRetry', merged.modelRetry],
    ]);
    const previous: Record<string, string> = {
      modelDigest: before.modelDigest, modelPlan: before.modelPlan, modelWrite: before.modelWrite, modelRetry: before.modelRetry,
    };
    for (const f of MODEL_FIELDS) {
      if (has(next, f) && !isTextual(next[f])) throw new ValidationError(f, nodeText(next[f]), 'must be a model id');
    }
    for (const [k, v] of chosen) {
      if (v === previous[k]) continue;
      await this.checkModel(tx, k, v, merged.executionMode);
    }
    const overrides = merged.subjectOverrides;
    if (!isObject(overrides)) throw new ValidationError('subjectOverrides', nodeText(overrides), 'must be an object');
    for (const [key, value] of fields(overrides)) {
      if (!isObject(value)) throw new ValidationError('subjectOverrides', key, 'must be an object');
      for (const f of ['modelWrite', 'modelPlan']) {
        const v = path(value, f);
        if (v === undefined || isNull(v)) continue;
        const prev = path(path(before.subjectOverrides, key), f);
        if (!nodeEquals(v, prev)) await this.checkModel(tx, `subjectOverrides.${key}.${f}`, asText(v), merged.executionMode);
        chosen.set(`subjectOverrides.${key}.${f}`, asText(v));
      }
    }
    const mode = merged.executionMode;
    if (!['auto', 'batch', 'sync'].includes(mode)) throw new ValidationError('executionMode', mode, 'must be auto, batch or sync');
    if (mode === 'batch') {
      const noBatch: string[] = [];
      for (const v of chosen.values()) {
        const m = await repo.modelById(tx, v);
        const supported = m != null ? m.isBatchSupported() : batchProvider(v) != null;
        if (!supported) noBatch.push(v);
      }
      if (noBatch.length) throw new ValidationError('executionMode', mode, `these models have no batch support: [${noBatch.join(', ')}]`);
    }
    for (const st of STAGES) {
      const e = path(merged.reasoningEffortNode, st);
      if (!isNull(e) && !(isTextual(e) && ['low', 'medium', 'high'].includes(e))) {
        throw new ValidationError(`reasoningEffort.${st}`, nodeText(e), 'must be low, medium, high or null');
      }
      const t = path(merged.maxTokensNode, st);
      if (!canConvertToInt(t) || asInt(t) < 256 || asInt(t) > 32000) {
        throw new ValidationError(`maxTokens.${st}`, nodeText(t), 'must be between 256 and 32000');
      }
    }
    if (!SpringCron.isValidExpression(merged.cron)) {
      throw new ValidationError('cron', merged.cron, 'not a valid cron expression (Spring 6 fields with seconds, or standard 5 fields)');
    }
    if (merged.runTokenBudget <= 0) throw new ValidationError('runTokenBudget', String(merged.runTokenBudget), 'must be positive');
    if (body != null && hasNonNull(body, 'runTokenBudget') && asLong(path(body, 'runTokenBudget')) > this.env.runTokenBudgetMax) {
      throw new ValidationError('runTokenBudget', nodeText(path(body, 'runTokenBudget')),
        `must be at most ${this.env.runTokenBudgetMax} (KB_RUN_TOKEN_BUDGET_MAX)`);
    }
    if (merged.runCostBudgetUsd.compareTo(MIN_COST_BUDGET_USD) < 0 || merged.runCostBudgetUsd.compareTo(MAX_COST_BUDGET_USD) > 0) {
      throw new ValidationError('runCostBudgetUsd', merged.runCostBudgetUsd.toString(),
        `must be between ${MIN_COST_BUDGET_USD.toString()} and ${MAX_COST_BUDGET_USD.toString()} (US$)`);
    }
    if (merged.weeklyCostLimitUsd != null && merged.weeklyCostLimitUsd.compareTo(Dec.ZERO) < 0) {
      throw new ValidationError('weeklyCostLimitUsd', merged.weeklyCostLimitUsd.toString(), 'must be >= 0');
    }
  }

  private async checkModel(tx: Db, field: string, id: string, executionMode: string): Promise<void> {
    const m = await repo.modelById(tx, id);
    if (m == null) throw new ValidationError(field, id, 'not in the model catalog');
    if (!m.enabled) throw new ValidationError(field, id, 'is disabled in the catalog');
    const mode = m.modeFor(executionMode);
    if (!m.selectableIn(mode)) throw new ValidationError(field, id, `has no successful ${lowerRoot(mode)} probe yet`);
  }

  private async response(tx: Db, stored: JsonObject, row: SavedRow | null, impact: CostImpact | null): Promise<KbSettingsResponse> {
    const vals = values(this.merge(stored));
    const source: JsonObject = {};
    for (const f of FIELDS) {
      const db = has(stored, f) || (f === 'modelRetry' && has(stored, 'modelWrite'));
      source[f] = db ? 'db' : 'env';
    }
    const by = row?.updatedBy ?? null;
    const name = by == null ? null : ((await repo.userNames(tx, [by])).get(by) ?? null);
    return { settings: vals, source, updatedAt: row?.updatedAt ?? null, updatedBy: by, updatedByName: name, costImpact: impact };
  }
}
