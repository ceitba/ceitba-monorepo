// Ports of apps/api/src/main/java/org/ceitba/api/service/kb/admin/KbEffectiveSettings.java,
// apps/api/src/main/java/org/ceitba/api/config/KbPipelineProperties.java (normalization) and the
// pure part of apps/api/src/main/java/org/ceitba/api/service/kb/admin/KbSettingsService.java
// (FIELDS, cron6, checkTypes, applied, merge, values).
//
// Runtime pipeline settings (docs/SUBJECT-WIKI-ADMIN.md §1): env defaults
// overridden by the single kb_pipeline_settings row.
// KbSettingsService itself (effective/get/update/preview/proposed/history/restore,
// validate, checkModel, response, impact) is kb-admin/settings.ts; the pure pieces below
// are what it calls.

import { ValidationError } from '../../../../http/errors';
import { Dec, dec } from '../decimal';
import { jIsBlank, jSplit, jTrim, lowerRoot } from '../javaString';
import {
  asBoolean,
  asLong,
  canConvertToInt,
  asInt,
  decimalValue,
  deepCopy,
  has,
  hasNonNull,
  isBoolean,
  isIntegralNumber,
  isNumber,
  isObject,
  isTextual,
  nodeEquals,
  nodeToString,
  path,
  type JsonObject,
  type JsonValue,
  type Node,
} from '../jsonNode';
import type { KbLlmProperties } from '../llm/kbLlmProperties';

// ---- KbPipelineProperties ------------------------------------------------------

export const DEFAULT_TOKEN_BUDGET_MAX = 50_000_000;
export const DEFAULT_MAX_REQUESTS = 5000;
export const MIN_COST_BUDGET_USD = dec('0.10');
export const MAX_COST_BUDGET_USD = dec('100');
export const DEFAULT_COST_BUDGET_USD = dec('5.00');

export interface KbPipelineProperties {
  enabled: boolean;
  cron: string;
  pollIntervalMs: number;
  modelDigest: string;
  modelPlan: string;
  modelWrite: string;
  modelRetry: string;
  runTokenBudget: number;
  retryRejected: boolean;
  background: boolean;
  runTokenBudgetMax: number;
  maxRequestsPerStage: number;
  batchMaxRequests: number;
  digestMaxMissingRatio: number;
  runCostBudgetUsd: Dec;
}

export interface KbPipelinePropertiesInput {
  enabled?: boolean;
  cron?: string | null;
  pollIntervalMs?: number | null;
  modelDigest?: string | null;
  modelPlan?: string | null;
  modelWrite?: string | null;
  modelRetry?: string | null;
  runTokenBudget?: number | null;
  retryRejected?: boolean | null;
  background?: boolean | null;
  runTokenBudgetMax?: number | null;
  maxRequestsPerStage?: number | null;
  batchMaxRequests?: number | null;
  digestMaxMissingRatio?: number | null;
  runCostBudgetUsd?: Dec | null;
}

const blank = (s: string | null | undefined): s is null | undefined => s == null || jIsBlank(s);

/** The record's compact constructor: defaults and clamps (fed from config.kb.pipeline by kb-pipeline/settings.ts). */
export function kbPipelineProperties(i: KbPipelinePropertiesInput = {}): KbPipelineProperties {
  const modelWrite = blank(i.modelWrite) ? 'glm-5.3' : jTrim(i.modelWrite);
  const runTokenBudgetMax = i.runTokenBudgetMax == null || i.runTokenBudgetMax <= 0 ? DEFAULT_TOKEN_BUDGET_MAX : i.runTokenBudgetMax;
  return {
    enabled: i.enabled ?? false,
    cron: blank(i.cron) ? '0 0 3 * * SUN' : jTrim(i.cron),
    pollIntervalMs: i.pollIntervalMs == null || i.pollIntervalMs === 0 ? 10 * 60_000 : i.pollIntervalMs,
    modelDigest: blank(i.modelDigest) ? 'glm-5.3-flash' : jTrim(i.modelDigest),
    modelPlan: blank(i.modelPlan) ? 'glm-5.3' : jTrim(i.modelPlan),
    modelWrite,
    modelRetry: blank(i.modelRetry) ? modelWrite : jTrim(i.modelRetry),
    runTokenBudgetMax,
    runTokenBudget: Math.min(runTokenBudgetMax, i.runTokenBudget == null || i.runTokenBudget <= 0 ? 3_000_000 : i.runTokenBudget),
    maxRequestsPerStage: i.maxRequestsPerStage == null || i.maxRequestsPerStage <= 0 ? DEFAULT_MAX_REQUESTS : i.maxRequestsPerStage,
    batchMaxRequests: i.batchMaxRequests == null || i.batchMaxRequests <= 0 ? DEFAULT_MAX_REQUESTS : i.batchMaxRequests,
    digestMaxMissingRatio:
      i.digestMaxMissingRatio == null || i.digestMaxMissingRatio < 0 || i.digestMaxMissingRatio > 1 ? 0.2 : i.digestMaxMissingRatio,
    runCostBudgetUsd: i.runCostBudgetUsd == null ? DEFAULT_COST_BUDGET_USD : i.runCostBudgetUsd.max(MIN_COST_BUDGET_USD).min(MAX_COST_BUDGET_USD),
    retryRejected: i.retryRejected == null || i.retryRejected,
    background: i.background == null || i.background,
  };
}

// ---- KbEffectiveSettings ---------------------------------------------------------

/** Keys: digest, plan, write, retry (ADMIN doc §8). */
export const DEFAULT_EFFORT: Record<string, string> = { digest: 'low', plan: 'low', write: 'medium', retry: 'medium' };
export const DEFAULT_MAX_TOKENS: Record<string, number> = { digest: 4000, plan: 6000, write: 12000, retry: 12000 };

/**
 * The pipeline settings in force. runCostBudgetUsd: estimated US$ a run may take on;
 * runTokenBudget is the secondary hard cap. subjectOverrides:
 * {"<subjectId>": {modelWrite?, modelPlan?, paused?}}.
 */
export class KbEffectiveSettings {
  constructor(
    readonly modelDigest: string,
    readonly modelPlan: string,
    readonly modelWrite: string,
    readonly modelRetry: string,
    readonly executionMode: string,
    readonly enabled: boolean,
    readonly cron: string,
    readonly runTokenBudget: number,
    readonly runCostBudgetUsd: Dec,
    readonly weeklyCostLimitUsd: Dec | null,
    readonly retryRejected: boolean,
    readonly subjectOverrides: JsonValue,
    readonly reasoningEffortNode: JsonValue,
    readonly maxTokensNode: JsonValue,
    readonly autoRefreshPrices: boolean,
  ) {}

  /** reasoning_effort for a stage (any case): low | medium | high, or null = the model's default. */
  reasoningEffort(stage: string): string | null {
    const key = lowerRoot(stage);
    const v = path(this.reasoningEffortNode, key);
    if (v === null) return null;
    return isTextual(v) ? v : (DEFAULT_EFFORT[key] ?? null);
  }

  maxTokens(stage: string): number {
    const key = lowerRoot(stage);
    const v = path(this.maxTokensNode, key);
    return canConvertToInt(v) ? asInt(v) : (DEFAULT_MAX_TOKENS[key] ?? 8000);
  }

  planModelFor(subjectId: string): string {
    const o = path(path(this.subjectOverrides, subjectId), 'modelPlan');
    return isTextual(o) ? o : this.modelPlan;
  }

  writeModelFor(subjectId: string): string {
    const o = path(path(this.subjectOverrides, subjectId), 'modelWrite');
    return isTextual(o) ? o : this.modelWrite;
  }

  /** A subject-level write override also drives its retries. */
  retryModelFor(subjectId: string): string {
    const o = path(path(this.subjectOverrides, subjectId), 'modelWrite');
    return isTextual(o) ? o : this.modelRetry;
  }

  paused(subjectId: string): boolean {
    return asBoolean(path(path(this.subjectOverrides, subjectId), 'paused'), false);
  }
}

// ---- KbSettingsService (pure part) -----------------------------------------------

export const FIELDS = [
  'modelDigest', 'modelPlan', 'modelWrite', 'modelRetry', 'executionMode', 'enabled', 'cron', 'runTokenBudget',
  'runCostBudgetUsd', 'weeklyCostLimitUsd', 'retryRejected', 'subjectOverrides', 'reasoningEffort', 'maxTokens',
  'autoRefreshPrices',
] as const;
export const STAGES = ['digest', 'plan', 'write', 'retry'] as const;

/**
 * Cron is Spring's 6 fields (seconds first); a standard 5-field expression is
 * accepted and stored with "0 " in front.
 */
export function cron6(cron: string | null): string | null {
  if (cron == null) return null;
  const parts = jSplit(jTrim(cron), /[ \t\n\x0B\f\r]+/);
  return parts.length === 5 ? '0 ' + parts.join(' ') : parts.join(' ');
}

/** Each settings field present (and not null) must have its JSON type: "25" or "yes" is refused, not read as 0/false. */
export function checkTypes(s: Node): void {
  for (const f of FIELDS) {
    const v = path(s, f);
    if (v === undefined || v === null) continue;
    switch (f) {
      case 'enabled':
      case 'retryRejected':
      case 'autoRefreshPrices':
        if (!isBoolean(v)) throw new ValidationError(f, nodeText(v), 'must be true or false');
        break;
      case 'runTokenBudget':
        if (!isIntegralNumber(v)) throw new ValidationError(f, nodeText(v), 'must be a whole number');
        break;
      case 'runCostBudgetUsd':
        if (!isNumber(v)) throw new ValidationError(f, nodeText(v), 'must be a number (US$)');
        break;
      case 'weeklyCostLimitUsd':
        if (!isNumber(v)) throw new ValidationError(f, nodeText(v), 'must be a number (US$) or null');
        break;
      case 'subjectOverrides':
      case 'reasoningEffort':
      case 'maxTokens':
        if (!isObject(v)) throw new ValidationError(f, nodeText(v), 'must be an object');
        break;
      default:
        if (!isTextual(v)) throw new ValidationError(f, nodeText(v), 'must be text');
    }
  }
}

/** String.valueOf(JsonNode) in a ValidationException message: the node's JSON text. */
function nodeText(v: JsonValue): string {
  return nodeToString(v);
}

function text(s: Node, f: string, fallback: string): string {
  const v = path(s, f);
  return hasNonNull(s, f) && isTextual(v) && !jIsBlank(v) ? jTrim(v) : fallback;
}

/** The settings logic that needs only the env defaults (KbSettingsService's merge/applied/values). */
export class KbSettingsLogic {
  constructor(
    private readonly env: KbPipelineProperties,
    private readonly llmEnv: KbLlmProperties,
  ) {}

  merge(s: Node): KbEffectiveSettings {
    const env = this.env;
    const write = text(s, 'modelWrite', env.modelWrite);
    return new KbEffectiveSettings(
      text(s, 'modelDigest', env.modelDigest),
      text(s, 'modelPlan', env.modelPlan),
      write,
      text(s, 'modelRetry', has(s, 'modelWrite') && !has(s, 'modelRetry') ? write : env.modelRetry),
      text(s, 'executionMode', this.llmEnv.executionMode),
      has(s, 'enabled') ? asBoolean(path(s, 'enabled')) : env.enabled,
      cron6(text(s, 'cron', env.cron))!,
      // Clamped on use too: a value saved before the ceiling existed can never exceed it.
      Math.min(env.runTokenBudgetMax, has(s, 'runTokenBudget') ? asLong(path(s, 'runTokenBudget')) : env.runTokenBudget),
      hasNonNull(s, 'runCostBudgetUsd') ? decimalValue(path(s, 'runCostBudgetUsd')) : env.runCostBudgetUsd,
      hasNonNull(s, 'weeklyCostLimitUsd') ? decimalValue(path(s, 'weeklyCostLimitUsd')) : null,
      has(s, 'retryRejected') ? asBoolean(path(s, 'retryRejected')) : env.retryRejected,
      has(s, 'subjectOverrides') ? path(s, 'subjectOverrides')! : {},
      perStage(path(s, 'reasoningEffort'), true),
      perStage(path(s, 'maxTokens'), false),
      !has(s, 'autoRefreshPrices') || asBoolean(path(s, 'autoRefreshPrices'), true),
    );
  }

  /**
   * `stored` with the settings fields of `body` applied (null removes), then every
   * override from `body` that changes no effective value dropped, so resending a
   * default never pins it in the database.
   */
  applied(stored: JsonObject, body: Node): JsonObject {
    const next = deepCopy(stored);
    for (const f of FIELDS) {
      if (!has(body, f)) continue;
      if (path(body, f) === null) delete next[f];
      else next[f] = path(body, f)!;
    }
    normalizeCron(next);
    for (const f of FIELDS) {
      if (!hasNonNull(body, f) || !has(next, f)) continue;
      const without = deepCopy(next);
      delete without[f];
      if (nodeEquals(values(this.merge(next)), values(this.merge(without)))) delete next[f];
    }
    return next;
  }
}

function normalizeCron(settings: JsonObject): void {
  if (isTextual(settings.cron)) settings.cron = cron6(settings.cron);
}

/** Defaults overlaid with the stored per-stage values. */
function perStage(stored: Node, effort: boolean): JsonObject {
  const out: JsonObject = {};
  for (const st of STAGES) {
    if (has(stored, st)) out[st] = path(stored, st)!;
    else if (effort) out[st] = DEFAULT_EFFORT[st]!;
    else out[st] = DEFAULT_MAX_TOKENS[st]!;
  }
  return out;
}

/** Every field's effective value (KbSettingsService.values). */
export function values(e: KbEffectiveSettings): JsonObject {
  return {
    modelDigest: e.modelDigest,
    modelPlan: e.modelPlan,
    modelWrite: e.modelWrite,
    modelRetry: e.modelRetry,
    executionMode: e.executionMode,
    enabled: e.enabled,
    cron: e.cron,
    runTokenBudget: e.runTokenBudget,
    runCostBudgetUsd: e.runCostBudgetUsd,
    weeklyCostLimitUsd: e.weeklyCostLimitUsd,
    retryRejected: e.retryRejected,
    subjectOverrides: e.subjectOverrides,
    reasoningEffort: e.reasoningEffortNode,
    maxTokens: e.maxTokensNode,
    autoRefreshPrices: e.autoRefreshPrices,
  };
}
